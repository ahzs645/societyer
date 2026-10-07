/** Deterministic agenda / meeting-package extractor (design §4.3 agenda/meetingPackage).
 * Packages are split into embedded documents (packageSplit.ts); the agenda part
 * yields numbered items with time, presenter and requested action; consent
 * agendas yield consent items received (A10) — never adopted. */
import type { IntakeExtract } from "../blocks";
import { versionMarker } from "../cluster";
import { bodyFromText } from "../minutes/extractMinutes";
import { findDates, findTimeRange, normalizeWhitespace, parseTime } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { DocClass } from "../schemas/common";
import { REQUESTED_ACTIONS } from "../schemas/classes";
import { isAgendaTable, splitPackage, type PackageSegment } from "./packageSplit";
import { at, clean, dateValue, fileLoc, firstDate, fromFile, guessAt, labelled, linesOf, loc, stripBullet, type Line } from "./toolkit";

export const DETERMINISTIC_AGENDA_ENGINE = "deterministic-agenda/1";
type RequestedAction = (typeof REQUESTED_ACTIONS)[number];

export type ClassExtractorInput = { fileId: string; fileName: string; path?: string; extract: IntakeExtract; docClass: DocClass; /** "Today" for status decisions (insurance terms, filing periods); defaults to the run date. */ asOfISO?: string; /** The organization whose records these are (run-level guess), e.g. to tell payable from receivable. */ organizationName?: string };

const ACTION_WORDS = /^(?:receive|receipt|approve|approval|adopt|none|discussion|discuss|decision|decide|information|for information|agree|bring forward|in-camera|update|ratify|vote)$/i;
const ROLE_PRESENTER = /^(?:chair|co-chair|vice[- ]chair|president|vice[- ]president|secretary|treasurer|secretariat|gm|staff|all|manager|executive director|coordinator|operations committee|board|committee|[A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){0,2})(?:\s*[,/&]\s*(?:chair|gm|all|staff|[A-Z][a-z]+))*$/;

export function requestedActionFrom(text: string): RequestedAction | undefined {
  const value = text.toLowerCase();
  if (/\bnone\b/.test(value)) return "none";
  if (/approv|adopt|agree|ratif|accept/.test(value)) return "approve";
  if (/receiv|receipt/.test(value)) return "receive";
  if (/decision|decide|vote/.test(value)) return "decide";
  if (/discuss|bring forward|in-camera/.test(value)) return "discuss";
  if (/information|update|report/.test(value)) return "information";
  return undefined;
}
function actionFromTitle(title: string): RequestedAction | undefined {
  if (/^(?:review and )?(?:adoption|approval|approve|adopt)\b|\b(?:approval|adoption) of\b/i.test(title)) return "approve";
  if (/^receipt of\b|^receive\b/i.test(title)) return "receive";
  if (/^for (?:information|discussion)\b/i.test(title)) return /discussion/i.test(title) ? "discuss" : "information";
  return undefined;
}

type ItemDraft = {
  line: Line;
  title: string;
  number?: string;
  time?: string;
  presenter?: string;
  presenterLine?: Line;
  action?: string;
  actionLine?: Line;
  depth: number;
  /** A wrapped second line of the title (its own locator; never a joined quote). */
  continuation?: Line;
};

const SKIP_LINE = /^\s*(?:date|time|location|subject|place|zoom|teams|link|toll[- ]free|access code|dial|meeting id|passcode|goals?|notes?|chair|recorder|note[- ]taker|teleconference)\s*[:#]|^\s*(?:goals?|notes?)\s*:?\s*$|^_{3,}|please notify|^\s*page \d|^\s*\d+\s*$|^\s*(?:agenda items?|formal business|business arising(?: and current)?|time\s+agenda item.*)\s*:?\s*$/i;
const STOP_LINE = /^\s*(?:notes?\s*:?|next meeting date(?: and time)?\s*:?|notice of special resolutions?\s*:?|proposed special resolution\b.*|present\s*:|members present\s*:|participants\s*:|minutes\s*:?)\s*$/i;
const NUMBERED = /^\s*(?:(\d{1,2}[:.]\d{2})\s*(?:[ap]\.?\s?m\.?)?\s+)?(?:item\s*)?(\d{1,2}(?:\.\d{1,2})*|[a-h])[.)]?\s+(?=\S)(.{2,})$/i;
const TIMED = /^\s*(\d{1,2}[:.]\d{2})\s*(?:[ap]\.?\s?m\.?)?\s+(?=[A-Z•●])(.{2,})$/i;

/** Splits "Title\tPresenter Action" / "Title Chair Approve" into parts. */
function splitTrailing(rest: string): { title: string; presenter?: string; action?: string } {
  const parts = rest.split("\t").map((part) => part.trim()).filter(Boolean);
  let title = parts[0] ?? rest.trim();
  const tail = parts.slice(1).join(" ");
  const tryTail = (text: string) => {
    const words = text.split(/\s+/);
    for (let take = Math.min(2, words.length); take >= 1; take--) {
      const action = words.slice(-take).join(" ");
      if (ACTION_WORDS.test(action)) return { action, presenter: words.slice(0, -take).join(" ").trim() || undefined };
    }
    return undefined;
  };
  if (tail) {
    const parsed = tryTail(tail);
    if (parsed) return { title, ...parsed };
    if (ROLE_PRESENTER.test(tail) && tail.length <= 40) return { title, presenter: tail };
    return { title };
  }
  // No tab: "4. May Board Minutes Chair Approve".
  const match = /^(.*?\S)\s+((?:Chair|Secretariat|Treasurer|GM|Staff|All|President|Secretary|Manager|Operations Committee)(?:\s*,\s*\w+)*)\s+(Receive|Approve|None|Discussion|Decision|Information|Agree|Discuss)$/.exec(title);
  if (match) return { title: match[1], presenter: match[2], action: match[3] };
  const actionOnly = /^(.*?\S)\s+(Receive|Approve|None|Approval)$/.exec(title);
  if (actionOnly && actionOnly[1].split(/\s+/).length >= 2) return { title: actionOnly[1], action: actionOnly[2] };
  title = title.replace(/\s+$/, "");
  return { title };
}

/** Joins wrapped lines of one table cell: a new item starts at a bullet or number. */
function joinContinuations(cellLines: Line[]): Line[] {
  const out: Line[] = [];
  for (const line of cellLines) {
    const startsItem = /^\s*(?:[•●▪◦·\-–*]|o\s|\d{1,2}(?:\.\d{1,2})*[.)]?\s)/.test(line.text);
    const previous = out[out.length - 1];
    if (previous && !startsItem && previous.cell === line.cell && previous.blockIndex === line.blockIndex) out[out.length - 1] = { ...previous, text: `${previous.text.trimEnd()} ${line.text.trim()}` };
    else out.push(line);
  }
  return out;
}

/** Items from agenda tables (Time | Agenda Item | Responsibility | Group Action), or 2-column time/bullets tables. */
function tableItems(extract: IntakeExtract, lines: Line[], blockStart: number, blockEnd: number): ItemDraft[] {
  const items: ItemDraft[] = [];
  for (const block of extract.blocks) {
    if (block.kind !== "table" || block.index < blockStart || block.index > blockEnd || (block.part && block.part !== "body")) continue;
    const blockLines = lines.filter((line) => line.blockIndex === block.index);
    if (isAgendaTable(block)) {
      const header = (block.rows?.[0]?.cells ?? []).map((cell) => cell.text.trim().toLowerCase());
      const colOf = (re: RegExp) => header.findIndex((text) => re.test(text));
      const timeCol = colOf(/^time$/), itemCol = colOf(/agenda item|^item$|^topic$/), presenterCol = colOf(/responsib|presenter|^lead$|^who$/), actionCol = colOf(/group action|requested action|^action$|purpose/);
      (block.rows ?? []).slice(1).forEach((row, rowOffset) => {
        const rowIndex = rowOffset + 1;
        const cellLines = (col: number) => col < 0 ? [] : blockLines.filter((line) => line.row === rowIndex && line.col === col);
        const titles = joinContinuations(cellLines(itemCol));
        const filled = row.cells.filter((cell) => cell.text.trim());
        if (!titles.length && filled.length === 1) return; // a section label row ("Business Arising and Current")
        const time = cellLines(timeCol)[0];
        const presenter = cellLines(presenterCol)[0];
        const action = cellLines(actionCol)[0];
        titles.forEach((line, index) => {
          const text = stripBullet(line.text);
          if (!text || SKIP_LINE.test(text)) return;
          const numbered = /^(\d{1,2}(?:\.\d{1,2})*)[.)]?\s+(.+)$/.exec(text);
          items.push({
            line,
            title: numbered ? numbered[2] : text,
            ...(numbered ? { number: numbered[1] } : {}),
            ...(time && index === 0 && parseTime(time.text) ? { time: time.text.trim() } : {}),
            ...(presenter ? { presenter: presenter.text.trim(), presenterLine: presenter } : {}),
            ...(action ? { action: action.text.trim(), actionLine: action } : {}),
            depth: /^\s*(?:o|▪|◦)\s/.test(line.text) ? 1 : 0,
          });
        });
      });
      continue;
    }
    // Two-column "time | bullet list" agendas (2012–2016 packages).
    const rows = block.rows ?? [];
    const timeFirst = rows.length >= 1 && rows.every((row) => {
      const cells = row.cells.filter((cell) => cell.text.trim());
      return !cells.length || (cells.length <= 2 && (cells.length === 1 ? /^\d{1,2}[:.]\d{2}\s*[ap]\.?m/i.test(cells[0].text.trim()) || rows.length === 1 : /^\s*\d{1,2}[:.]\d{2}/.test(cells[0].text)));
    }) && blockLines.filter((line) => line.col === 1).length >= 3;
    if (!timeFirst) continue;
    rows.forEach((_row, rowIndex) => {
      const times = blockLines.filter((line) => line.row === rowIndex && line.col === 0);
      const bullets = blockLines.filter((line) => line.row === rowIndex && line.col === 1);
      bullets.forEach((line, index) => {
        const text = stripBullet(line.text);
        if (!text || /^refreshments/i.test(text)) return;
        const time = index === 0 ? times.map((candidate) => candidate.text.trim()).find((candidate) => /\d{1,2}[:.]\d{2}/.test(candidate)) : undefined;
        items.push({ line, title: text, ...(time ? { time } : {}), depth: /^\s*(?:o|▪|◦)\s/.test(line.text) ? 1 : 0 });
      });
    });
  }
  return items;
}

/** Items from numbered paragraphs / list items (docx lists, PDF agendas). */
function lineItems(lines: Line[]): ItemDraft[] {
  const items: ItemDraft[] = [];
  let started = false;
  let stopped = false;
  let inGoals = false;
  for (const [position, line] of lines.entries()) {
    if (line.kind === "table" || stopped) continue;
    const text = line.text.trim();
    if (/^\s*goals?\s*:?\s*$/i.test(text)) {
      inGoals = true;
      continue;
    }
    if (inGoals) {
      if (line.kind === "list_item" || /^[•●▪◦·\-–*]/.test(text)) continue;
      inGoals = false;
    }
    // Wrapped continuation of the previous numbered item in the same paragraph ("…Minutes:\tSecretariat Receive" / "June 2021").
    const previous = items[items.length - 1];
    const before = lines[position - 1];
    if (previous && before === previous.line && line.blockIndex === previous.line.blockIndex && line.kind !== "list_item" && !NUMBERED.test(text) && !TIMED.test(text) && !/^[•●▪◦·\-–*]/.test(text) && text.length <= 40 && !/:\s*$/.test(previous.line.text) && !SKIP_LINE.test(text) && !STOP_LINE.test(text)) {
      previous.continuation = line;
      continue;
    }
    if (/^(?:agenda items?|formal business|business arising(?: and current)?|time\s+agenda item\b.*|agenda item\s+(?:responsibility|group action).*)\s*:?\s*$/i.test(text) || /\bagenda item\b.*\b(?:responsibility|group action)\b/i.test(text)) {
      started = true;
      continue;
    }
    if (STOP_LINE.test(text) && (started || items.length)) {
      stopped = true;
      continue;
    }
    if (SKIP_LINE.test(text)) continue;
    const timed = TIMED.exec(text);
    const numbered = NUMBERED.exec(text);
    if (line.kind === "list_item") {
      const body = stripBullet(text);
      const parsed = numbered ? splitTrailing(numbered[3]) : splitTrailing(body);
      if (!parsed.title || parsed.title.length < 2) continue;
      items.push({ line, title: parsed.title, ...(numbered && numbered[2] ? { number: numbered[2] } : {}), ...(numbered?.[1] ? { time: numbered[1] } : {}), ...(parsed.presenter ? { presenter: parsed.presenter, presenterLine: line } : {}), ...(parsed.action ? { action: parsed.action, actionLine: line } : {}), depth: Math.min(3, (line.style && /ListParagraph/i.test(line.style) && !numbered) ? 1 : 0) });
      started = true;
      continue;
    }
    if (numbered && !/^\d{1,2}[.)]?\s+[A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4}/.test(text)) {
        if (!started && items.length === 0 && !/^\s*(?:\d{1,2}[:.]\d{2}\s*(?:[ap]\.?\s?m\.?)?\s+)?(?:item\s*)?(?:1|a)[.)]?\s/i.test(text)) continue;
      const parsed = splitTrailing(numbered[3]);
      if (!parsed.title || /^\d/.test(parsed.title)) continue;
      items.push({ line, title: parsed.title, number: numbered[2], ...(numbered[1] ? { time: numbered[1] } : {}), ...(parsed.presenter ? { presenter: parsed.presenter, presenterLine: line } : {}), ...(parsed.action ? { action: parsed.action, actionLine: line } : {}), depth: /^[a-h]$/i.test(numbered[2]) || numbered[2].includes(".") ? 1 : 0 });
      started = true;
      continue;
    }
    if (timed && (started || items.length)) {
      const parsed = splitTrailing(timed[2]);
      if (/^\d/.test(parsed.title)) continue;
      items.push({ line, title: stripBullet(parsed.title), time: timed[1], ...(parsed.presenter ? { presenter: parsed.presenter, presenterLine: line } : {}), ...(parsed.action ? { action: parsed.action, actionLine: line } : {}), depth: 0 });
      continue;
    }
    if ((started || items.length) && /^[•●▪◦·\-–*]\s*\S/.test(text) && items.length) {
      const parsed = splitTrailing(stripBullet(text));
      if (parsed.title.length >= 2) items.push({ line, title: parsed.title, ...(parsed.action ? { action: parsed.action, actionLine: line } : {}), depth: 1 });
    }
  }
  return items;
}

function kindFor(fileName: string, title: string, docClass: DocClass, bodyKey?: string): "agenda" | "business_agenda" | "consent_agenda" | "package" | "agm_agenda" {
  const text = `${fileName} ${title}`;
  if (/consent agenda/i.test(text)) return "consent_agenda";
  if (/business agenda/i.test(text)) return "business_agenda";
  if (docClass === "meetingPackage" || /package|binder/i.test(text)) return "package";
  if (bodyKey === "agm" || /\bAGM\b|annual general/i.test(text)) return "agm_agenda";
  return "agenda";
}

/** Shared header facts for agenda-like documents. */
export function meetingHeader(lines: Line[], fileName: string, limit = 25) {
  const head = lines.slice(0, limit);
  const dateLabel = labelled(head, /(?:meeting\s+)?date(?:\s+issued)?/i);
  const dateFromLabel = dateLabel ? findDates(dateLabel.value)[0] : undefined;
  const dateHit = dateFromLabel ? { line: dateLabel!.line, date: dateFromLabel } : firstDate(head, { skip: /\b(?:next|previous|upcoming|issued)\b/i });
  const fileDate = findDates(fileName.replace(/\b((?:19|20)\d{2})_(\d{2})_(\d{2})/, "$1-$2-$3").replace(/_/g, " "), { allowNumericShortYear: true }).find((date) => date.precision === "day");
  const date: FieldValue<{ iso: string; precision: "day" | "month" | "year"; text: string }> = dateHit
    ? at(dateValue(dateHit.date), dateHit.line, dateHit.date.text, 0.9)
    : fileDate ? fromFile(dateValue(fileDate), fileName, 0.5, "Date from the file name; none in the document header.") : notStated("No meeting date found.");
  let startTime: FieldValue<string> | undefined;
  let endTime: FieldValue<string> | undefined;
  const timeLines = [dateHit?.line, labelled(head, /time/i)?.line, ...head.slice(0, 8)].filter(Boolean) as Line[];
  for (const line of timeLines) {
    const range = findTimeRange(line.text);
    if (range?.start) {
      startTime = at(range.start, line, range.text, range.inferredMeridiem ? 0.6 : 0.9);
      if (range.end) endTime = at(range.end, line, range.text, range.inferredMeridiem ? 0.6 : 0.9);
      break;
    }
  }
  const location = labelled(head, /location|place|venue|where/i);
  const electronic = head.find((line) => /\b(?:zoom|ms teams|microsoft teams|teams|webex|teleconference|dial-in|virtual)\b/i.test(line.text));
  return {
    date,
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(location && location.value.length < 160 ? { location: at(clean(location.value), location.line, location.value, 0.85) } : {}),
    ...(electronic ? { electronic: guessAt(true, electronic, undefined, 0.7, "Remote participation details in the header.") } : {}),
  };
}

/** Governing body from the first candidate line that names one, else the file name. */
export function bodyFields(candidates: Array<Line | undefined>, fileName: string, options: { assumeBoard?: boolean } = {}): { body: FieldValue<string>; bodyLabel?: FieldValue<string>; bodyKey?: string } {
  for (const line of candidates) {
    if (!line) continue;
    const found = bodyFromText(line.text);
    if (found) return { body: at(found.body as string, line, undefined, 0.8), bodyLabel: at(found.label, line, undefined, 0.8), bodyKey: found.body };
  }
  const fromName = bodyFromText(fileName);
  if (fromName) return { body: fromFile(fromName.body as string, fileName, 0.55), bodyLabel: fromFile(fromName.label, fileName, 0.55), bodyKey: fromName.body };
  // Same fallback as the minutes extractor: an agenda naming no body is assumed to be the board's.
  const anchor = options.assumeBoard ? candidates.find((line): line is Line => Boolean(line && /\bagenda\b/i.test(line.text))) : undefined;
  if (anchor) return { body: guessAt("board", anchor, undefined, 0.4, "No governing body named; assumed to be the board."), bodyKey: "board" };
  return { body: notStated<string>("No governing body named.") };
}

export function extractAgenda(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const segments = splitPackage(extract);
  const lines = linesOf(extract);
  const warnings: string[] = [];
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  // The agenda part: the first segment classified agenda, else the first non-cover segment.
  const agendaSegment = segments.find((segment) => segment.docClass === "agenda") ?? segments.find((segment) => segment.docClass !== "cover") ?? segments[0];
  const coverSegment = segments[0] && segments[0] !== agendaSegment && (segments[0].docClass === "cover" || segments[0].docClass === "unclassified") ? segments[0] : undefined;
  const range = agendaSegment ? { blockStart: agendaSegment.blockStart, blockEnd: agendaSegment.blockEnd } : { blockStart: 0, blockEnd: extract.blocks.length - 1 };
  const agendaLines = lines.filter((line) => line.blockIndex >= range.blockStart && line.blockIndex <= range.blockEnd);
  const titleCandidate = agendaLines.find((line) => line.blockIndex === agendaSegment?.titleBlock) ?? agendaLines[0];
  const titleLineValue = titleCandidate && !/^\s*(?:chair|notes?|date|location|subject|time|zoom)\s*:/i.test(titleCandidate.text) ? titleCandidate : undefined;
  const coverLines = coverSegment ? lines.filter((line) => line.blockIndex >= coverSegment.blockStart && line.blockIndex <= coverSegment.blockEnd) : [];
  const header = meetingHeader(agendaLines.length ? agendaLines : lines, fileName);
  const coverHeader = coverLines.length ? meetingHeader(coverLines, fileName) : undefined;
  // A package cover's meeting date wins over an agenda that kept last meeting's date (copy-paste).
  const date = coverHeader?.date.value && header.date.value && coverHeader.date.value.iso !== header.date.value.iso
    ? { ...coverHeader.date, status: "conflicting" as const, locators: [...coverHeader.date.locators, ...header.date.locators], note: `Package cover says ${coverHeader.date.value.iso}; the agenda inside says ${header.date.value.iso}.` }
    : header.date.value ? header.date : coverHeader?.date ?? header.date;
  const title = !titleLineValue ? fileName.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ") : clean(titleLineValue.text.replace(/^\s*(?:item|attachment)\s*#?\s*\d+(?:\.\d+)?(?:\s*&\s*\d+)?\s*[-–:]?\s*/i, "")) || clean(titleLineValue.text);
  const bodyInfo = bodyFields([titleLineValue, ...coverLines.slice(0, 2), ...agendaLines.slice(0, 3)], fileName, { assumeBoard: true });
  const kind = kindFor(fileName, `${title} ${coverLines.slice(0, 2).map((line) => line.text).join(" ")}`, input.docClass, bodyInfo.bodyKey);
  // Items: tables first, then numbered/list lines.
  const drafts = [...tableItems(extract, lines, range.blockStart, range.blockEnd), ...lineItems(agendaLines)].sort((a, b) => a.line.blockIndex - b.line.blockIndex || (a.line.row ?? 0) - (b.line.row ?? 0));
  const seen = new Set<string>();
  const itemDrafts = drafts.filter((item) => {
    const key = `${item.line.blockIndex}:${item.line.cell ?? ""}:${normalizeWhitespace(item.title).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return item.title.length <= 200;
  });
  const consentDoc = kind === "consent_agenda";
  const items = itemDrafts.map((item) => {
    const stated = item.action ? requestedActionFrom(item.action) : undefined;
    const inferredAction = stated ? undefined : actionFromTitle(item.title);
    return {
      ...(item.number ? { number: at(item.number, item.line, undefined, 0.85) } : {}),
      title: item.continuation ? { ...at(`${item.title} ${item.continuation.text.trim()}`, item.line, item.title, 0.85), locators: [loc(item.line, item.title), loc(item.continuation)] } : at(item.title, item.line, item.title, 0.85),
      ...(item.presenter ? { presenter: at(item.presenter, item.presenterLine ?? item.line, item.presenter, 0.75) } : {}),
      ...(item.action ? { groupAction: at(item.action, item.actionLine ?? item.line, item.action, 0.85) } : {}),
      ...(stated ? { requestedAction: at(stated, item.actionLine ?? item.line, item.action, 0.85) } : inferredAction ? { requestedAction: guessAt(inferredAction, item.line, item.title, 0.6, "Inferred from the item wording.") } : {}),
      ...(item.time ? { scheduledTime: at(item.time, item.line, item.time, 0.85) } : {}),
      ...(consentDoc ? { consent: guessAt(true, item.line, undefined, 0.75, "Listed on the consent agenda.") } : {}),
      ...(item.depth ? { depth: item.depth } : {}),
    };
  });
  // Embedded documents (everything but the agenda part itself).
  const embedded = segments.filter((segment) => segment !== agendaSegment).map((segment) => embeddedDocumentFor(segment, lines));
  // Consent-agenda receipts (A10): Receive → received; never adopted by import.
  const consentItems = consentDoc ? itemDrafts.filter((item) => item.depth === 0).map((item) => {
    const action = item.action ? requestedActionFrom(item.action) : undefined;
    const matched = matchEmbedded(`${item.title} ${item.continuation?.text ?? ""}`, segments.filter((segment) => segment !== agendaSegment));
    return {
      title: item.continuation ? { ...at(`${item.title} ${item.continuation.text.trim()}`, item.line, item.title, 0.85), locators: [loc(item.line, item.title), loc(item.continuation)] } : at(item.title, item.line, item.title, 0.85),
      ...(item.number ? { itemNumber: at(item.number, item.line, undefined, 0.8) } : {}),
      ...(item.presenter ? { presenter: at(item.presenter, item.presenterLine ?? item.line, item.presenter, 0.75) } : {}),
      outcome: action === "receive" ? at("received" as const, item.actionLine ?? item.line, item.action, 0.75, "Consent agenda group action: Receive. Recorded as received (A10), not adopted.") : inferred("pending" as const, [loc(item.line)], 0.6, "Consent item without a Receive action: outcome pending review."),
      ...(matched >= 0 ? { embeddedIndex: embedded.findIndex((entry) => entry.blockStart === segments.filter((segment) => segment !== agendaSegment)[matched].blockStart) } : {}),
    };
  }) : undefined;
  // Proposed (special) resolutions in a notice section: proposed, never carried.
  const proposedResolutions = proposedResolutionsIn(agendaLines);
  // Next meetings announced on the agenda.
  const nextMeetings = agendaLines.filter((line) => /\b(?:next|upcoming)\b.*\bmeeting\b|^\s*(?:board|operations committee|agm) meeting\s*:/i.test(stripBullet(line.text))).flatMap((line, index, all) => {
    const own = findDates(line.text)[0];
    const following = own ? undefined : lines[lines.indexOf(line) + 1];
    const date = own ?? (following ? findDates(following.text)[0] : undefined);
    if (!date) return [];
    const where = own ? line : following!;
    const time = findTimeRange(where.text)?.start ?? parseTime(where.text.replace(date.text, " "))?.time;
    const body = bodyFromText(line.text);
    void index; void all;
    return [at({ date: date.precision === "day" ? date.iso : undefined, ...(time ? { time } : {}), ...(body ? { body: body.body } : {}), text: normalizeWhitespace(where.text).slice(0, 300) }, where, undefined, 0.75)];
  });
  // References: earlier minutes presented for adoption; attachments.
  for (const segment of segments) {
    if (segment === agendaSegment || segment.docClass !== "meetingMinutes") continue;
    const titleLine = lines.find((line) => line.blockIndex === segment.titleBlock);
    if (titleLine) references.push({ kind: "prior_minutes", text: segment.title.slice(0, 300), ...(segment.date ? { date: segment.date.iso } : {}), ...(segment.bodyLabel ? { body: segment.bodyLabel } : {}), locators: [loc(titleLine)] });
  }
  for (const line of agendaLines) {
    const attachment = /\((?:see\s+)?(attachment|item|appendix|schedule)\s+([\w.]+)[^)]*\)/i.exec(line.text);
    if (attachment) references.push({ kind: "attachment", text: attachment[0], locators: [loc(line, attachment[0])] });
  }
  if (!items.length) warnings.push("No agenda items were recognised.");
  const goal = agendaLines.find((line) => /^\s*goals?\s*:?\s*$/i.test(line.text));
  if (goal) {
    const next = agendaLines[agendaLines.indexOf(goal) + 1];
    if (next) unsupported.push({ description: `Meeting goal statement: ${clean(next.text).slice(0, 200)}`, locators: [loc(next)], suggestedTarget: "meetings.purpose", category: "no_field", infoType: "meeting.goal" });
  }
  const marker = versionMarker(fileName);
  const record = {
    body: bodyInfo.body,
    ...(bodyInfo.bodyLabel ? { bodyLabel: bodyInfo.bodyLabel } : {}),
    date,
    ...(header.startTime ?? coverHeader?.startTime ? { startTime: header.startTime ?? coverHeader?.startTime } : {}),
    ...(header.endTime ?? coverHeader?.endTime ? { endTime: header.endTime ?? coverHeader?.endTime } : {}),
    ...(header.location ?? coverHeader?.location ? { location: header.location ?? coverHeader?.location } : {}),
    ...(header.electronic ? { electronic: header.electronic } : {}),
    title: titleLineValue ? at(title, titleLineValue, undefined, 0.8) : fromFile(fileName, fileName, 0.4),
    kind: inferred(kind, [fileLoc(fileName)], 0.7, "From the title and file name."),
    recordStatus: marker === "draft" ? inferred("draft" as const, [fileLoc(fileName)], 0.7) : inferred("agenda" as const, [fileLoc(fileName)], 0.7),
    items,
    ...(embedded.length ? { embeddedDocuments: embedded } : {}),
    ...(consentItems?.length ? { consentItems } : {}),
    ...(proposedResolutions.length ? { proposedResolutions } : {}),
    ...(nextMeetings.length ? { nextMeetings } : {}),
  };
  return {
    fileId: input.fileId,
    docClass: input.docClass,
    schemaVersion: `${input.docClass}/1+intake/1`,
    engine: "deterministic",
    model: DETERMINISTIC_AGENDA_ENGINE,
    record,
    unsupported,
    references,
    warnings,
  };
}

export function embeddedDocumentFor(segment: PackageSegment, lines: Line[]) {
  const titleLine = lines.find((line) => line.blockIndex === segment.titleBlock && segment.title.startsWith(line.text.trim().slice(0, 20))) ?? lines.find((line) => line.blockIndex === segment.titleBlock);
  const dateLine = segment.date ? lines.find((line) => line.blockIndex === segment.date!.blockIndex && line.text.includes(segment.date!.text)) : undefined;
  return {
    docClass: segment.docClass === "cover" ? "meetingPackage" : segment.docClass,
    ...(titleLine ? { title: at(clean(titleLine.text), titleLine, undefined, 0.8) } : {}),
    blockStart: segment.blockStart,
    blockEnd: segment.blockEnd,
    ...(segment.date && dateLine ? { date: at({ iso: segment.date.iso, precision: segment.date.precision, text: segment.date.text }, dateLine, segment.date.text, 0.8) } : {}),
    ...(segment.bodyLabel ? { bodyLabel: segment.bodyLabel } : {}),
    ...(segment.itemRef ? { itemRef: segment.itemRef } : {}),
    classConfidence: segment.confidence,
  };
}

/** Consent item title ↔ embedded part: same body and month ("Operations Committee Minutes: June 2021"). */
function matchEmbedded(title: string, segments: PackageSegment[]): number {
  const body = bodyFromText(title)?.label;
  const month = findDates(title, { allowMonthPrecision: true })[0];
  return segments.findIndex((segment) => {
    if (segment.docClass !== "meetingMinutes" && !/minutes/i.test(title)) return segment.title.toLowerCase().includes(title.toLowerCase().slice(0, 20));
    if (body && segment.bodyLabel && body !== segment.bodyLabel) return false;
    if (month && segment.date) return segment.date.iso.startsWith(month.iso.slice(0, month.precision === "day" ? 7 : month.iso.length));
    return false;
  });
}

export function proposedResolutionsIn(lines: Line[]): Array<FieldValue<{ text: string; kind: "special" | "ordinary" | "unknown" }>> {
  const out: Array<FieldValue<{ text: string; kind: "special" | "ordinary" | "unknown" }>> = [];
  let special = false;
  let inNotice = false;
  for (const line of lines) {
    const text = line.text.trim();
    if (/notice of (?:special )?resolution|proposed (?:special )?resolution|special resolution/i.test(text)) {
      inNotice = true;
      special = /special/i.test(text);
    }
    const resolved = /^(?:be it\s+)?(?:resolved|it is resolved)\b|^resolved as an? (?:special|ordinary) resolution/i.exec(text);
    if (resolved || (inNotice && /^that\s+\w/i.test(text))) {
      const kind = /special resolution/i.test(text) || special ? "special" : /ordinary resolution/i.test(text) ? "ordinary" : "unknown";
      out.push(at({ text: text.slice(0, 600), kind }, line, undefined, 0.8, "Proposed resolution (notice or script): never a record of a decision."));
    }
  }
  return out;
}
