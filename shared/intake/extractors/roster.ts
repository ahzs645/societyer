/** Director consent / proxy / representative / roster extractor (design §4.3).
 * Person, represented organization, seat, role, term start/end, signed date
 * and proxy holder. Personal contact details (addresses, emails, phones) are
 * never extracted: they stay in the restricted original. */
import { looksLikePersonName } from "../names";
import { findDates, monthIndex, validIsoDay } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Locator, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { ClassExtractorInput } from "./agenda";
import { at, clean, dateValue, fileLoc, fromFile, guessAt, linesOf, loc, type Line } from "./toolkit";

export const DETERMINISTIC_ROSTER_ENGINE = "deterministic-roster/1";

type DateVal = { iso: string; precision: "day" | "month" | "year"; text: string };
const UNDERSCORES = /_+/g;

/** "DATED effective the 18th day of March, 2025" / "the____11____ day of __June____, 2021" / "Dated [ 06 / 23 / 2020 ]". */
export function signedDateIn(text: string): DateVal | undefined {
  const plain = text.replace(UNDERSCORES, " ").replace(/\s+/g, " ");
  const dayOf = /(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]+)\s*,?\s*((?:19|20)\d{2})/i.exec(plain);
  if (dayOf) {
    const iso = validIsoDay(Number(dayOf[3]), monthIndex(dayOf[2]), Number(dayOf[1]));
    if (iso) return { iso, precision: "day", text: dayOf[0] };
  }
  const bracket = /\[\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*((?:19|20)\d{2})\s*\]/.exec(plain);
  if (bracket) {
    // Forms print [MM/DD/YYYY].
    const iso = validIsoDay(Number(bracket[3]), Number(bracket[1]), Number(bracket[2]));
    if (iso) return { iso, precision: "day", text: bracket[0] };
  }
  const found = findDates(plain)[0];
  return found ? { iso: found.iso, precision: found.precision, text: found.text } : undefined;
}

/** A quote that exists verbatim in the line for a value found in an underscore-cleaned copy. */
function rawSpan(line: Line, cleaned: string): string | undefined {
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  const pattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_\\[\\]]*"), "i");
  return pattern.exec(line.text)?.[0];
}

type Entry = Record<string, unknown> & { person: FieldValue<{ nameAsWritten: string; role?: string; affiliation?: string }> };

function consentEntries(lines: Line[], fileName: string): { entries: Entry[]; blank: boolean } {
  const consentLine = lines.find((line) => /\bI,?\s*[_\s]*([A-Z][^,_]*?)[_\s]*,?\s*(?:hereby )?consent/i.test(line.text)) ?? lines.find((line) => /consent to act as a director/i.test(line.text) && /\bI,/.test(line.text));
  if (!consentLine) return { entries: [], blank: false };
  const match = /\bI,?\s*[_\s]*([A-Z][A-Za-z.'’\- ]{1,60}?)[_\s]*,?\s*(?:hereby )?consent/.exec(consentLine.text);
  const name = match ? clean(match[1].replace(UNDERSCORES, " ")) : undefined;
  if (!name || !looksLikePersonName(name)) return { entries: [], blank: true };
  const dateLine = lines.find((line) => /\bdated\b/i.test(line.text) && signedDateIn(line.text));
  const signed = dateLine ? signedDateIn(dateLine.text) : undefined;
  const signedQuote = dateLine && signed ? rawSpan(dateLine, signed.text) ?? undefined : undefined;
  const printed = lines.find((line) => /print name/i.test(line.text) && line.text.replace(/print name[^:]*:?/i, "").replace(UNDERSCORES, " ").trim().length > 3);
  const nameQuote = rawSpan(consentLine, name) ?? name;
  const org = /\b(?:representing|on behalf of|appointed by)\s+(?:the\s+)?([A-Z][\w&.,'’ -]{2,80}?)(?:[.,;]|$)/.exec(lines.map((line) => line.text).join(" "));
  const entry: Entry = {
    person: at({ nameAsWritten: name, role: "Director" }, consentLine, nameQuote, 0.9),
    role: at("Director", consentLine, "consent to the responsibilities as a director", 0.85),
    consentGiven: at(true, consentLine, /consent/i.exec(consentLine.text)?.[0], 0.9),
    representativeType: guessAt("director", consentLine, undefined, 0.7),
    ...(signed && dateLine ? { signedDate: at(signed, dateLine, signedQuote ?? undefined, 0.85), termStart: guessAt(signed, dateLine, signedQuote ?? undefined, 0.6, "Consent effective date; the term itself starts on appointment (usually the AGM).") } : {}),
    ...(org ? { organisationRepresented: at(clean(org[1]), lines.find((line) => line.text.includes(org[1]))!, org[1], 0.6) } : {}),
  };
  void printed;
  return { entries: [entry], blank: false };
}

function proxyEntries(lines: Line[], fileName: string): { entries: Entry[]; blank: boolean } {
  const appoints = lines.findIndex((line) => /\bhereby appoints?\b|\bappoint\b.*\bas (?:my|its|our) proxy\b/i.test(line.text));
  if (appoints < 0) return { entries: [], blank: false };
  const holderLine = lines.slice(appoints, appoints + 3).find((line) => /as proxy holder|as (?:my|its|our) proxy/i.test(line.text));
  const holderMatch = holderLine ? /(?:\[\s*([^\]]+?)\s*\]|appoints?\s+([A-Z][^,\[]+?))\s+as (?:proxy holder|(?:my|its|our) proxy)/i.exec(holderLine.text) ?? /^\s*\[?\s*([^\]]+?)\s*\]?\s+as proxy holder/i.exec(holderLine.text) : undefined;
  const holder = holderMatch ? clean((holderMatch[1] ?? holderMatch[2] ?? "").replace(/^(?:dr|mr|mrs|ms)\.?\s+/i, (prefix) => prefix)) : undefined;
  const blank = !holder || /^name$|^\[?\s*name/i.test(holder) || /_{3,}/.test(holder);
  if (blank) return { entries: [], blank: true };
  const dated = lines.find((line) => /^\s*dated\b/i.test(line.text) && signedDateIn(line.text));
  const signed = dated ? signedDateIn(dated.text) : undefined;
  const untilMatch = holderLine ? /\buntil\s+(\[[^\]]+\]|[A-Z][a-z]+ \d{1,2},? \d{4})/i.exec(holderLine.text) : undefined;
  const until = untilMatch ? signedDateIn(untilMatch[1]) : undefined;
  // Grantor: the name line just above "[NAME OF DIRECTOR]" / "Signature", or after the date.
  const markerIndex = lines.findIndex((line) => /name of (?:director|member)|^\s*\(?signature/i.test(line.text));
  const grantorLine = markerIndex > 0 ? lines.slice(Math.max(0, markerIndex - 2), markerIndex).reverse().find((line) => looksLikePersonName(clean(line.text.replace(/[\[\]_]/g, " ")))) : undefined;
  const grantor = grantorLine ? clean(grantorLine.text.replace(/[\[\]_]/g, " ")) : undefined;
  const meetingLine = holderLine && /\bmeeting\b[^.]*?\bto be held on\s+(?:[A-Z][a-z]+day,?\s+)?([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\[[^\]]+\])/i.exec(holderLine.text);
  const meetingDate = meetingLine ? signedDateIn(meetingLine[1]) : undefined;
  const org = /^([A-Z][A-Za-z&]+)\s+proxy/i.exec(fileName.replace(/_/g, " "));
  // "Harbour Health Authority, a member of the Society, hereby appoints …": a member organization grants the proxy.
  const grantorOrg = holderLine ? /^\s*(?:the\s+)?([A-Z][\w&.'’ -]{2,80}?),\s+a member of\b/.exec(holderLine.text) ?? /^\s*([A-Z][\w&.'’ -]{2,80}?)\s+hereby appoints?\b/.exec(holderLine.text) : undefined;
  const orgName = grantorOrg && !/^(?:i|we|the undersigned)$/i.test(grantorOrg[1].trim()) ? grantorOrg[1].trim() : undefined;
  const entry: Entry = {
    person: grantorLine && grantor ? at({ nameAsWritten: grantor, role: "Director" }, grantorLine, grantor, 0.75) : { status: "not_stated", confidence: 1, locators: [], note: "Grantor not named on the form." } as any,
    proxyHolder: at({ nameAsWritten: holder! }, holderLine!, holderMatch![1] ?? holderMatch![2], 0.85),
    representativeType: at("proxy", holderLine!, "proxy holder", 0.85),
    ...(signed && dated ? { signedDate: at(signed, dated, rawSpan(dated, signed.text) ?? undefined, 0.85), termStart: guessAt(signed, dated, rawSpan(dated, signed.text) ?? undefined, 0.6, "Proxy dated") } : {}),
    ...(until && holderLine ? { termEnd: at(until, holderLine, untilMatch![1], 0.8) } : {}),
    ...(meetingDate && holderLine ? { meetingDate: at(meetingDate, holderLine, meetingLine![1], 0.8) } : {}),
    ...(orgName && holderLine ? { organisationRepresented: at(orgName, holderLine, orgName, 0.8) } : org ? { organisationRepresented: fromFile(org[1], fileName, 0.55, "Organization named in the file name.") } : {}),
  };
  return { entries: entry.person.value || orgName ? [entry] : [], blank: false };
}

const NAME_HEADER = /^(?:name|director|representative|member|person|full name)$/i;
const OFFICER = /\b(?:president|vice[- ]?president|chair|vice[- ]?chair|treasurer|secretary)\b/i;
/** Spreadsheet / table rosters: Name | Organization | Office | … | (update notes). */
function tableEntries(extract: ClassExtractorInput["extract"], lines: Line[]): Entry[] {
  const out: Entry[] = [];
  for (const block of extract.blocks) {
    if (block.kind !== "table") continue;
    const rows = block.rows ?? [];
    const headerIndex = rows.findIndex((row) => row.cells.some((cell) => NAME_HEADER.test(cell.text.trim())));
    if (headerIndex < 0) continue;
    const header = rows[headerIndex].cells.map((cell) => cell.text.trim().toLowerCase());
    const col = (re: RegExp) => header.findIndex((text) => re.test(text));
    const nameCol = col(/^(?:name|director|representative|member|person|full name)$/);
    const orgCol = col(/organi[sz]ation|agency|company|represent|sector|seat/);
    const roleCol = col(/office|role|position|title/);
    const startCol = col(/start|appointed|joined|from/);
    const endCol = col(/end|term expir|left|to$/);
    const noteCol = header.findIndex((text, index) => /update|note|comment|status|change/.test(text) && index !== nameCol);
    const group = block.sheet && !/^sheet\d*$/i.test(block.sheet) ? block.sheet : undefined;
    // Officers listed on a board or executive sheet are directors; on a committee or working-group sheet they are members.
    const boardGroup = !group || /board|director|executive|officer/i.test(group);
    rows.slice(headerIndex + 1).forEach((row, offset) => {
      const rowIndex = headerIndex + 1 + offset;
      const cellLine = (column: number) => column < 0 ? undefined : lines.find((line) => line.blockIndex === block.index && line.row === rowIndex && line.col === column);
      const nameLine = cellLine(nameCol);
      if (!nameLine) return;
      const raw = nameLine.text.trim();
      const vacant = /^vacant$/i.test(raw);
      const name = clean(raw.replace(/\((?:on leave|chair|vice[- ]chair|proxy|acting)\)/i, ""));
      const orgLine = cellLine(orgCol);
      if (!vacant && !looksLikePersonName(name)) return;
      const roleLine = cellLine(roleCol);
      const noteLine = cellLine(noteCol);
      const startLine = cellLine(startCol);
      const endLine = cellLine(endCol);
      const role = roleLine?.text.trim();
      const isProxy = /proxy|alternate/i.test(role ?? "") && !/^director$/i.test(role ?? "");
      const left = noteLine && /\b(?:left|replaced by|resigned|stepped down|retired)\b/i.exec(noteLine.text);
      const joined = noteLine && /\b(?:joined|appointed|started|new)\b/i.exec(noteLine.text);
      const noteDate = noteLine ? findDates(noteLine.text, { allowMonthPrecision: true }).find((date) => date.precision !== "year") : undefined;
      const startDate = startLine ? findDates(startLine.text, { allowMonthPrecision: true })[0] : undefined;
      const endDate = endLine ? findDates(endLine.text, { allowMonthPrecision: true })[0] : undefined;
      if (vacant) {
        out.push({ person: { status: "not_stated", confidence: 1, locators: [loc(nameLine)], note: "Seat listed as VACANT." } as any, ...(orgLine ? { organisationRepresented: at(clean(orgLine.text), orgLine, undefined, 0.8), seat: at(clean(orgLine.text), orgLine, undefined, 0.8) } : {}), ...(role ? { role: at(role, roleLine!, undefined, 0.8) } : {}), representativeType: at("vacant", nameLine, raw, 0.85) });
        return;
      }
      out.push({
        person: at({ nameAsWritten: name, ...(role ? { role } : {}), ...(orgLine ? { affiliation: clean(orgLine.text) } : {}) }, nameLine, raw, 0.85),
        ...(orgLine ? { organisationRepresented: at(clean(orgLine.text), orgLine, undefined, 0.8), seat: at(clean(orgLine.text), orgLine, undefined, 0.7) } : {}),
        ...(role ? { role: at(role, roleLine!, undefined, 0.85) } : group ? { role: inferred(group, [loc(nameLine)], 0.5, `Sheet "${group}".`) } : {}),
        representativeType: role ? at(isProxy ? "proxy" : /staff|manager|coordinator|secretariat|executive director/i.test(role) ? "staff" : /director/i.test(role) || (boardGroup && OFFICER.test(role)) ? "director" : "member", roleLine!, role, 0.75) : inferred(group && /staff/i.test(group) ? "staff" : group && !boardGroup ? "member" : "director", [loc(nameLine)], 0.5),
        ...(startDate && startLine ? { termStart: at(dateValue(startDate), startLine, startDate.text, 0.8) } : joined && noteDate && noteLine ? { termStart: at(dateValue(noteDate), noteLine, noteDate.text, 0.7) } : {}),
        ...(endDate && endLine ? { termEnd: at(dateValue(endDate), endLine, endDate.text, 0.8) } : left && noteDate && noteLine ? { termEnd: at(dateValue(noteDate), noteLine, noteDate.text, 0.7) } : {}),
        ...(noteLine && /replaced by/i.test(noteLine.text) ? { meetingRef: at(clean(noteLine.text).slice(0, 200), noteLine, undefined, 0.6) } : {}),
      });
    });
  }
  return out;
}

/** "Name, Organization" lines (directors & staff lists in packages). */
function listEntries(lines: Line[]): Entry[] {
  const out: Entry[] = [];
  for (const line of lines) {
    if (line.kind === "table") continue;
    const match = /^\s*(?:\d{1,2}[.)]\s*|[•●▪◦·\-–*]\s*)?([A-Z][\w'’.\-]+(?:\s+[A-Z][\w'’.\-]+){1,3})\s*[,–—-]\s+([A-Z][^,]{2,80})$/.exec(line.text.trim());
    if (!match || !looksLikePersonName(match[1])) continue;
    out.push({ person: at({ nameAsWritten: match[1], affiliation: match[2].trim() }, line, match[1], 0.7), organisationRepresented: at(match[2].trim(), line, match[2].trim(), 0.7) });
  }
  return out;
}

export function extractRoster(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract);
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const head = lines.slice(0, 15).map((line) => line.text).join(" ");
  const isConsent = /consent to act/i.test(`${fileName} ${head}`);
  const isProxy = /\bprox(?:y|ies)\b/i.test(fileName) || /hereby appoints?\b.*proxy|as proxy holder/i.test(extract.text.slice(0, 4000));
  const isRepresentative = /representative form|appointed organization/i.test(`${fileName} ${head}`);
  let entries: Entry[] = [];
  let blank = false;
  let kind: "director_consent" | "proxy" | "roster" | "appointment" | "resignation" = "roster";
  let kindLine: Line | undefined;
  if (isConsent) {
    ({ entries, blank } = consentEntries(lines, fileName));
    kind = "director_consent";
    kindLine = lines.find((line) => /consent to act/i.test(line.text));
  } else if (isProxy && !/full list|roster|contact/i.test(fileName)) {
    ({ entries, blank } = proxyEntries(lines, fileName));
    kind = "proxy";
    kindLine = lines.find((line) => /proxy/i.test(line.text));
  } else if (isRepresentative) {
    kind = "appointment";
    kindLine = lines.find((line) => /representative/i.test(line.text));
    const nameLine = lines.find((line) => /name of representative/i.test(line.text));
    const name = nameLine ? clean(nameLine.text.replace(/name of representative\(?s?\)?\s*:?/i, "").replace(UNDERSCORES, " ")) : "";
    const orgLine = lines.find((line) => /organization name/i.test(line.text));
    const org = orgLine ? clean(orgLine.text.replace(/organization name\s*:?/i, "").replace(UNDERSCORES, " ")) : "";
    blank = !name || !looksLikePersonName(name.split(/\s{2,}/)[0]);
    if (!blank && nameLine) entries = [{ person: at({ nameAsWritten: name.split(/\s{2,}/)[0] }, nameLine, rawSpan(nameLine, name.split(/\s{2,}/)[0]), 0.8), representativeType: at("representative", nameLine, "Name of Representative", 0.8), ...(org && orgLine ? { organisationRepresented: at(org, orgLine, rawSpan(orgLine, org), 0.8) } : {}) }];
  } else {
    entries = tableEntries(extract, lines);
    if (!entries.length) entries = listEntries(lines);
    kind = /resign/i.test(fileName) ? "resignation" : /appoint/i.test(fileName) ? "appointment" : "roster";
  }
  if (blank) warnings.push("Blank form (template): no person named.");
  const asOf = findDates(fileName.replace(/_/g, " "), { allowMonthPrecision: true }).find((date) => date.precision !== "year") ?? findDates(fileName.replace(/_/g, " "), { allowMonthPrecision: true })[0];
  // Bylaw passed date cited on consent forms ("Bylaws … passed on October 26, 2018") → reference to the adopting meeting.
  const bylawLine = lines.find((line) => /bylaws?.{0,80}passed on/i.test(line.text) && findDates(line.text)[0]);
  if (bylawLine) {
    const date = findDates(bylawLine.text)[0];
    references.push({ kind: "policy", text: `Bylaws passed on ${date.text}`, date: date.iso, locators: [loc(bylawLine, /bylaws?.{0,80}passed on [^.,]*/i.exec(bylawLine.text)?.[0])] });
  }
  if (lines.some((line) => /delivery address|residential address|postal code/i.test(line.text))) unsupported.push({ description: "Director's residential address on the consent form (restricted; kept in the original, not extracted).", locators: [loc(lines.find((line) => /delivery address|residential address|postal code/i.test(line.text))!, /delivery address|residential address|postal code/i.exec(lines.find((line) => /delivery address|residential address|postal code/i.test(line.text))!.text)![0])], suggestedTarget: "directors.residentialAddress", category: "no_ui_edit", infoType: "person.address_restricted" });
  const record = {
    kind: kindLine ? at(kind, kindLine, undefined, 0.85) : inferred(kind, [fileLoc(fileName)], 0.6),
    entries,
    ...(blank ? { blankForm: inferred(true, [kindLine ? loc(kindLine) : fileLoc(fileName)], 0.8, "Template without a named person.") } : {}),
    ...(asOf ? { asOfDate: fromFile(dateValue(asOf), fileName, 0.55, "List date from the file name.") } : {}),
  };
  void notStated; void ({} as Locator);
  return { fileId: input.fileId, docClass: input.docClass, schemaVersion: `${input.docClass}/1+intake/1`, engine: "deterministic", model: DETERMINISTIC_ROSTER_ENGINE, record, unsupported, references, warnings };
}
