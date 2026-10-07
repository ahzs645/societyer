/** AGM material extractor: notices, scripts and AGM packages (design §4.3).
 * Resolutions in scripts and notices are PROPOSED, never carried: a script
 * prints "CARRIED." before the meeting happens. The election slate is the
 * list of nominees/appointees as written. */
import { versionMarker } from "../cluster";
import { looksLikePersonName } from "../names";
import { findDates, findTimeRange, parseTime } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import { bodyFields, embeddedDocumentFor, meetingHeader, proposedResolutionsIn, type ClassExtractorInput } from "./agenda";
import { splitPackage } from "./packageSplit";
import { at, clean, dateValue, fileLoc, fromFile, guessAt, labelled, linesOf, loc, stripBullet, titleLine, type Line } from "./toolkit";

export const DETERMINISTIC_AGM_ENGINE = "deterministic-agm/1";

type AgmKind = "notice" | "script" | "package" | "report" | "unknown";

function kindOf(fileName: string, lines: Line[]): { kind: AgmKind; line?: Line } {
  const head = lines.slice(0, 12);
  const titled = head.find((line) => /\bscript\b/i.test(line.text)) ?? head.find((line) => /\bnotice of (?:the )?(?:annual )?general meeting|notice is hereby given/i.test(line.text)) ?? head.find((line) => /\bpackage\b/i.test(line.text));
  if (/\bscript\b/i.test(fileName) || (titled && /\bscript\b/i.test(titled.text)) || lines.some((line) => /^\s*chair says\s*:/i.test(line.text))) return { kind: "script", line: titled && /script/i.test(titled.text) ? titled : undefined };
  if (/\bnotice\b/i.test(fileName) || (titled && /notice/i.test(titled.text))) return { kind: "notice", line: titled && /notice/i.test(titled.text) ? titled : undefined };
  if (/\bpackage\b/i.test(fileName) || (titled && /package/i.test(titled.text))) return { kind: "package", line: titled };
  if (/\breport\b/i.test(fileName)) return { kind: "report" };
  return { kind: "unknown" };
}

const NAME_LINE = /^[A-Z][\w'’.\-]+(?:\s+[A-Z][\w'’.\-]+){1,3}$/;
const NOT_A_NAME = /\b(?:resolution|meeting|report|statements?|minutes|agenda|society|board|committee|business|election|adjourn\w*|notice|bylaws?|directors?|members?|nominations?|other)\b/i;

/** People listed under "appointment of directors" / "nominated" until the list ends. */
function electionSlate(lines: Line[]): Array<FieldValue<{ nameAsWritten: string; role?: string; affiliation?: string }>> {
  const out: Array<FieldValue<{ nameAsWritten: string; role?: string; affiliation?: string }>> = [];
  let open = false;
  let misses = 0;
  for (const line of lines) {
    const text = stripBullet(line.text.replace(/^\s*\d{1,2}[.)]\s*/, ""));
    if (/appoint(?:ment|ed)? (?:of )?(?:the )?directors|following .*(?:individuals|directors|positions).*(?:appointed|nominated|elected)|nominated for|nominees?\b|slate of directors|elect(?:ion)? of (?:the )?(?:directors|executive)/i.test(line.text) && !/^\s*\d{1,2}[:.]\d{2}/.test(line.text)) {
      open = true;
      misses = 0;
      // Inline list: "Nominees for election to the Board: Avery Quill, Casey Lark and Sam Reed."
      const inline = /:\s*(.+)$/.exec(line.text);
      if (inline) {
        for (const raw of inline[1].replace(/[.;]\s*$/, "").split(/\s*,\s*|\s+and\s+/)) {
          const name = raw.trim();
          if (name && NAME_LINE.test(name) && !NOT_A_NAME.test(name) && looksLikePersonName(name)) out.push(at({ nameAsWritten: name }, line, name, 0.75, "Nominee listed in AGM material: proposed, not an election result."));
        }
        if (out.length) open = false;
      }
      continue;
    }
    if (!open) continue;
    if (/^_{3,}/.test(text)) continue; // blank nomination lines in a script
    const parts = text.split(/\s*[,–—-]\s+|\t+/).map((part) => part.trim()).filter(Boolean);
    const name = parts[0]?.replace(/\s*\((?:for|chair|representing)[^)]*\)\s*/i, "").trim();
    if (name && NAME_LINE.test(name) && !NOT_A_NAME.test(name) && looksLikePersonName(name) && text.length <= 120) {
      const affiliation = parts.slice(1).join(", ");
      const role = /\b(?:president|vice[- ]president|secretary|treasurer|chair|director at large)\b/i.exec(affiliation)?.[0];
      out.push(at({ nameAsWritten: name, ...(role ? { role } : {}), ...(affiliation && !role ? { affiliation } : {}) }, line, undefined, 0.75, "Nominee/appointee listed in AGM material: proposed, not an election result."));
      misses = 0;
      continue;
    }
    if (++misses >= 2) open = false;
  }
  const seen = new Set<string>();
  return out.filter((entry) => {
    const key = entry.value!.nameAsWritten.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractAgmMaterial(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract);
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const kind = kindOf(fileName, lines);
  const segments = kind.kind === "package" ? splitPackage(extract) : [];
  const agendaSegment = segments.find((segment) => segment.docClass === "agenda");
  const minutesRanges = segments.filter((segment) => segment.docClass === "meetingMinutes");
  const own = lines.filter((line) => !minutesRanges.some((segment) => line.blockIndex >= segment.blockStart && line.blockIndex <= segment.blockEnd));
  const header = meetingHeader(agendaSegment ? lines.filter((line) => line.blockIndex >= agendaSegment.blockStart && line.blockIndex <= agendaSegment.blockEnd) : lines, fileName, 30);
  // Notices: the issue date is the header "Date:"; the meeting date is the notice body's "DATE:" / subject.
  let noticeDate: FieldValue<ReturnType<typeof dateValue>> | undefined;
  let meetingDate: FieldValue<ReturnType<typeof dateValue>> = header.date;
  let startTime = header.startTime;
  let location = header.location;
  if (kind.kind === "notice") {
    const issued = labelled(lines.slice(0, 8), /date(?:\s+issued)?/i);
    const issuedDate = issued ? findDates(issued.value)[0] : undefined;
    if (issued && issuedDate) noticeDate = at(dateValue(issuedDate), issued.line, issuedDate.text, 0.85);
    const dated = noticeDate ? undefined : lines.find((line) => /^\s*dated\b/i.test(line.text) && findDates(line.text)[0]?.precision === "day");
    if (dated) {
      const date = findDates(dated.text)[0];
      noticeDate = at(dateValue(date), dated, date.text, 0.85);
    }
    const given = lines.findIndex((line) => /notice is hereby given|will be held/i.test(line.text));
    const meetingLabel = labelled(lines, /date/i, { from: given >= 0 ? given : 0 });
    const meetingFound = meetingLabel ? findDates(meetingLabel.value)[0] : undefined;
    const subject = labelled(lines.slice(0, 8), /subject|re/i);
    const subjectDate = subject ? findDates(subject.value)[0] : undefined;
    if (meetingLabel && meetingFound && meetingLabel.line !== issued?.line) meetingDate = at(dateValue(meetingFound), meetingLabel.line, meetingFound.text, 0.9);
    else if (subject && subjectDate) meetingDate = at(dateValue(subjectDate), subject.line, subjectDate.text, 0.8);
    const time = labelled(lines, /time/i, { from: given >= 0 ? given : 0 });
    const range = time ? findTimeRange(time.value) : undefined;
    const single = time && !range ? parseTime(time.value) : undefined;
    if (time && (range?.start || single)) startTime = at((range?.start ?? single!.time), time.line, range?.text ?? single!.text, 0.85);
    else if (!startTime?.value && given >= 0) {
      // "… will be held on Tuesday, November 18, 2025 at 7:00 PM at …"
      const at_ = /\bat\s+(\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?)/i.exec(lines[given].text);
      const parsed = at_ ? parseTime(at_[1]) : undefined;
      if (parsed) startTime = at(parsed.time, lines[given], at_![1], 0.8);
    }
    const place = labelled(lines, /location|place/i, { from: given >= 0 ? given : 0 });
    if (place) location = at(clean(place.value), place.line, place.value, 0.85);
  }
  const NOTICE_METHOD = /\b(?:(?:sent|given|delivered|mailed|emailed|circulated)\s+(?:by|via)\s+(?:e-?mail|mail|post|courier)|by (?:e-?mail|regular mail|mail|newspaper advertisement)|published in (?:the )?[A-Z][\w ]{2,40}|notice to (?:public|directors|members))\b/i;
  const noticeMethodLine = lines.find((line) => NOTICE_METHOD.test(line.text));
  const methodFromName = /notice to (public|directors|members)/i.exec(fileName);
  const noticeMethod = noticeMethodLine
    ? at(clean(NOTICE_METHOD.exec(noticeMethodLine.text)![0]), noticeMethodLine, NOTICE_METHOD.exec(noticeMethodLine.text)![0], 0.6)
    : methodFromName ? fromFile(`notice to ${methodFromName[1].toLowerCase()}`, fileName, 0.5) : undefined;
  // Agenda items: list items / numbered items of the agenda part or script.
  const scope = agendaSegment ? lines.filter((line) => line.blockIndex >= agendaSegment.blockStart && line.blockIndex <= agendaSegment.blockEnd) : lines;
  const agendaItems = scope.filter((line) => {
    const text = stripBullet(line.text.replace(/^\s*\d{1,2}[.)]\s*/, ""));
    if (!text || text.length > 120 || /^_{3,}/.test(text)) return false;
    if (/^\s*(?:date|time|place|location|subject|issued by)\s*:/i.test(text)) return false;
    const lead = text.split(/\s*[,–—-]\s+/)[0];
    if (NAME_LINE.test(lead) && looksLikePersonName(lead)) return false;
    return (line.kind === "list_item" && !/\b(?:says|MOVE|SECOND)\b/.test(line.text)) || /^\s*\d{1,2}[.)]\s+[A-Z]/.test(line.text);
  }).map((line) => at(clean(stripBullet(line.text.replace(/^\s*\d{1,2}[.)]\s*/, ""))), line, undefined, 0.8));
  // Proposed resolutions: "I MOVE that …" in scripts; "Resolved …" in notices. Always proposed.
  const resolutions = [
    ...own.filter((line) => /\bI (?:so )?MOVE\b/.test(line.text)).map((line) => {
      const moved = /\bI (?:so )?MOVE\b\s*(?:that\s+)?(.*)$/.exec(line.text)!;
      moved[1] = moved[1].replace(/^[\s.,;:]+$/, "");
      const position = lines.indexOf(line);
      const asked = lines.slice(Math.max(0, position - 4), position).reverse().map((candidate) => /\bmotion that\s+(.+?)[?.]?\s*$/i.exec(candidate.text)?.[1]).find(Boolean);
      const heading = lines.slice(0, position).reverse().find((candidate) => candidate.kind === "list_item" && !/\b(?:says|MOVE|SECOND)\b/.test(candidate.text) && !NAME_LINE.test(stripBullet(candidate.text).split(/\s*[,–—-]\s+/)[0]));
      const text = moved[1].trim() ? `That ${moved[1].trim()}` : asked ? `That ${asked}` : heading ? `Motion on: ${clean(heading.text)}` : "Motion put by the chair";
      return at({ text, kind: "unknown" as const }, line, moved[0].trim() || undefined, 0.75, moved[1].trim() ? "Scripted motion: proposed wording, not a decision." : "Scripted motion without wording; text taken from the script context.");
    }),
    ...proposedResolutionsIn(own),
  ];
  // Financial statements placed before the members; auditor / review engagement.
  const fsLine = own.find((line) => /financial statements?\b.*(?:fiscal|year)\s+(?:year\s+)?end(?:ed|ing)?\s+[A-Z][a-z]+ \d/i.test(line.text)) ?? own.find((line) => /financial statements?\b.*(?:fiscal|year)\s+(?:year\s+)?end(?:ed|ing)?|receipt of (?:the )?financial (?:statements?|report)/i.test(line.text));
  const fsPeriod = fsLine ? /(?:fiscal year|year)\s+end(?:ed|ing)?\s+([A-Z][a-z]+ \d{1,2},? \d{4})|\((?:aug(?:ust)?|jan(?:uary)?)[^)]*\d{4}[^)]*\)|\(\d{4}[-–]\d{2,4}\)/i.exec(fsLine.text) : undefined;
  const auditorLine = own.find((line) => /\bauditor|review engagement|audited\b|notice to reader/i.test(line.text));
  const fiscalYear = fsPeriod?.[1] ? findDates(fsPeriod[1])[0]?.iso.slice(0, 4) : (/\b(20\d{2})\s*[-–/]\s*(\d{2,4})\b/.exec(fileName + " " + (fsLine?.text ?? ""))?.[0]);
  const slate = electionSlate(own);
  const titleCandidate = kind.line ?? titleLine(lines);
  const bodyInfo = bodyFields([titleCandidate, ...lines.slice(0, 4)], fileName);
  if (kind.kind === "script") warnings.push("Script: motions and CARRIED markers are pre-written; every resolution is recorded as proposed.");
  // Notice evidence has no native notice-delivery import; keep it as a representation gap.
  if (noticeDate || noticeMethod) {
    const where = noticeDate?.locators ?? noticeMethod?.locators ?? [fileLoc(fileName)];
    unsupported.push({ description: `AGM notice${noticeDate?.value ? ` issued ${noticeDate.value.iso}` : ""}${noticeMethod?.value ? ` (${noticeMethod.value})` : ""}${meetingDate.value ? ` for the meeting of ${meetingDate.value.iso}` : ""}.`, locators: where, suggestedTarget: "noticeDeliveries.sentAtISO", category: "no_relationship", infoType: "agm.notice" });
  }
  for (const segment of segments) {
    if (segment.docClass === "meetingMinutes") {
      const titleLineValue = lines.find((line) => line.blockIndex === segment.titleBlock);
      if (titleLineValue) references.push({ kind: "prior_minutes", text: segment.title.slice(0, 300), ...(segment.date ? { date: segment.date.iso } : {}), body: "agm", locators: [loc(titleLineValue)] });
    }
  }
  const adoptMinutes = lines.find((line) => /adopt(?:ion of)? (?:the )?minutes of (?:the )?/i.test(line.text) && findDates(line.text)[0]);
  if (adoptMinutes) {
    const date = findDates(adoptMinutes.text)[0];
    references.push({ kind: "prior_minutes", text: clean(adoptMinutes.text).slice(0, 300), date: date.iso, body: "agm", locators: [loc(adoptMinutes)] });
  }
  const marker = versionMarker(fileName);
  const record = {
    kind: kind.line ? at(kind.kind, kind.line, undefined, 0.85) : inferred(kind.kind, [fileLoc(fileName)], 0.7, "From the file name / script cues."),
    ...(fiscalYear ? { fiscalYear: fsLine ? at(fiscalYear, fsLine, undefined, 0.6) : fromFile(fiscalYear, fileName, 0.5) } : {}),
    ...(noticeDate ? { noticeDate } : {}),
    ...(noticeMethod ? { noticeMethod } : {}),
    agendaItems,
    proposedResolutions: resolutions.map((resolution) => ({ ...resolution, value: resolution.value!.text })),
    ...(slate.length ? { electionSlate: slate } : {}),
    ...(fsLine ? { financialStatementsPresented: at(clean(fsPeriod?.[0] ?? fsLine.text).slice(0, 200), fsLine, fsPeriod?.[0], 0.7) } : {}),
    ...(auditorLine ? { auditorOrReviewEngagement: at(clean(auditorLine.text).slice(0, 200), auditorLine, undefined, 0.6) } : {}),
    meetingDate,
    ...(startTime ? { startTime } : {}),
    ...(location ? { location } : {}),
    ...(bodyInfo.bodyLabel ? { bodyLabel: bodyInfo.bodyLabel } : {}),
    resolutions,
    ...(segments.length > 1 ? { embeddedDocuments: segments.filter((segment) => segment !== agendaSegment).map((segment) => embeddedDocumentFor(segment, lines)) } : {}),
  };
  if (!meetingDate.value) warnings.push("No AGM date found.");
  void notStated; void guessAt; void marker;
  return { fileId: input.fileId, docClass: input.docClass, schemaVersion: `${input.docClass}/1+intake/1`, engine: "deterministic", model: DETERMINISTIC_AGM_ENGINE, record, unsupported, references, warnings };
}
