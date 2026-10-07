/** Run-level stages for the non-minutes classes (WP-L): organization detection,
 * embedded-minutes derivation from packages, fiscal-year-end change detection,
 * policy-version → adoption-motion links, agenda-evidenced meetings and
 * reference/rule record gaps. Pure functions over pipeline data. */
import type { IntakeExtract } from "./blocks";
import type { IntakeExtractionResult, IntakeFileRecord } from "./bundle";
import { bodyKeyFor, meetingKey } from "./entities";
import { textSimilarity } from "./eval";
import { fiscalYearEndChanges } from "./extractors/financial";
import { rebaseLocators, subExtract } from "./extractors/toolkit";
import { extractMeetingMinutes } from "./minutes/extractMinutes";
import type { RecordGap, ReconcileLink, ReconciledMeeting } from "./reconcile";
import { inferred } from "./schemas/common";
import { verifyRecord } from "./verify";

const val = (field: any) => (field && (field.status === "stated" || field.status === "inferred" || field.status === "conflicting") ? field.value : undefined);

/** The organization whose records these are: the most frequent "… Society/Roundtable/Association" name near the top of documents. */
export function detectOrganizationName(texts: Record<string, string>): string | undefined {
  const counts = new Map<string, { name: string; count: number }>();
  for (const text of Object.values(texts)) {
    const head = text.slice(0, 2500);
    const seen = new Set<string>();
    for (const match of head.matchAll(/\b((?:[A-Z][A-Za-z'’&-]+\s+){1,6}(?:Society|Roundtable|Association|Foundation|Council))\b/g)) {
      const name = match[1].replace(/\s+/g, " ").trim();
      const key = name.toLowerCase().replace(/\bsociety$/, "").trim();
      if (seen.has(key) || /^(?:the|a|an)\s/i.test(name) && name.split(" ").length < 3) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { name, count: 0 };
      entry.count += 1;
      if (name.length > entry.name.length) entry.name = name;
      counts.set(key, entry);
    }
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return best && best.count >= 2 ? best.name : undefined;
}

/** Minutes embedded in a package / consent agenda / AGM package, extracted as derived records
 * keyed `<package fileKey>#part-<blockStart>` with locators on the package's own blocks. */
export function deriveEmbeddedMinutes(envelope: IntakeExtractionResult, extract: IntakeExtract, file: Pick<IntakeFileRecord, "fileKey" | "name">): Array<IntakeExtractionResult & { parentFileKey: string }> {
  const parts = ((envelope.record as any).embeddedDocuments ?? []) as Array<any>;
  const out: Array<IntakeExtractionResult & { parentFileKey: string }> = [];
  for (const part of parts) {
    if (part.docClass !== "meetingMinutes" || part.blockEnd - part.blockStart < 2) continue;
    const { extract: sub, blockOffset, charOffset } = subExtract(extract, part.blockStart, part.blockEnd);
    const title = val(part.title) ?? "Embedded minutes";
    const derived = extractMeetingMinutes({ fileId: file.fileKey, fileName: String(title), extract: sub });
    const date = val((derived.record as any).date);
    if (!date || date.precision !== "day") continue;
    const seen = new WeakSet<object>();
    rebaseLocators(derived.record, blockOffset, charOffset, seen);
    for (const item of [...derived.unsupported, ...derived.references]) rebaseLocators(item, blockOffset, charOffset, seen);
    // Embedded copies are circulated drafts unless they say otherwise.
    const record: any = derived.record;
    if (val(record.recordStatus) === "recorded" || val(record.recordStatus) === "unknown") record.recordStatus = inferred("draft", record.recordStatus?.locators ?? [], 0.55, `Copy embedded in ${file.name} (circulated for approval).`);
    const verification = verifyRecord(derived.record, extract);
    out.push({ ...derived, fileId: file.fileKey, fileKey: `${file.fileKey}#part-${part.blockStart}`, parentFileKey: file.fileKey, verification, warnings: [...(derived.warnings ?? []), `Embedded in ${file.name} (blocks ${part.blockStart}–${part.blockEnd}).`] });
  }
  return out;
}

/** Fiscal-year-end change across the run's annual statements (e.g. 31 Jul → 31 Dec): annotates the first statement after the change. */
export function annotateFiscalYearEndChanges(extractions: IntakeExtractionResult[]): Array<{ fileKey: string; from: string; to: string; firstYear: number }> {
  const statements = extractions.filter((extraction) => extraction.docClass === "financialStatement" || extraction.docClass === "budget").map((extraction) => {
    const record: any = extraction.record;
    return { fileKey: extraction.fileKey, periodEndIso: val(record.periodEnd)?.precision === "day" ? val(record.periodEnd).iso : undefined, fiscalYearEnd: val(record.fiscalYearEnd) as string | undefined };
  });
  const changes = fiscalYearEndChanges(statements);
  for (const change of changes) {
    const extraction = extractions.find((candidate) => candidate.fileKey === change.fileKey);
    if (!extraction) continue;
    const record: any = extraction.record;
    const locators = record.fiscalYearEnd?.locators ?? record.periodEnd?.locators ?? [];
    record.fiscalYearEndChange = inferred(`${change.from} → ${change.to} (first ${change.to} year end ${change.firstYear})`, locators, 0.65, "Fiscal year end differs from the previous annual statement in the run.");
    extraction.unsupported.push({ description: `Fiscal year end changed from ${change.from} to ${change.to} (${change.firstYear}); there is no native field for a change of financial year or the transition period.`, locators, suggestedTarget: "societies.fiscalYearEndHistory", category: "no_field", infoType: "finance.fiscal_year_end_change" });
  }
  return changes;
}

/** Policies / bylaws ↔ the motion that adopted them (title similarity; date window around the version date). */
export function linkPolicyAdoptions(extractions: IntakeExtractionResult[], meetings: ReconciledMeeting[], windowDays = 180): Array<ReconcileLink & { meetingDate: string; bodyKey: string; motionIndex: number }> {
  const motions: Array<{ fileKey: string; motionIndex: number; date: string; bodyKey: string; text: string }> = [];
  const canonical = new Set(meetings.map((meeting) => meeting.canonicalFileId));
  for (const extraction of extractions) {
    if (extraction.docClass !== "meetingMinutes" || !canonical.has(extraction.fileKey)) continue;
    const record: any = extraction.record;
    const date = val(record.date);
    if (date?.precision !== "day") continue;
    (record.motions ?? []).forEach((motion: any, index: number) => {
      const text = val(motion.adoptsPolicy) ?? val(motion.text) ?? "";
      if (/\b(?:polic|bylaw|constitution|terms of reference|tor|signing authority|delegation|procedure|protocol)/i.test(text)) motions.push({ fileKey: extraction.fileKey, motionIndex: index, date: date.iso, bodyKey: bodyKeyFor(val(record.bodyLabel) ?? val(record.body)), text });
    });
  }
  const links: Array<ReconcileLink & { meetingDate: string; bodyKey: string; motionIndex: number }> = [];
  for (const extraction of extractions) {
    if (extraction.docClass !== "policy" && extraction.docClass !== "bylaws") continue;
    const record: any = extraction.record;
    if (val(record.external)) continue;
    const title = String(val(record.title) ?? "");
    const versionDate = val(record.adoptedDate)?.iso ?? val(record.effectiveDate)?.iso;
    const scored = motions
      .map((motion) => ({ motion, score: Math.max(textSimilarity(title, motion.text), /bylaw/i.test(title) && /bylaw/i.test(motion.text) ? 0.5 : 0, /signing authority|delegation/i.test(title) && /signing authority|delegation/i.test(motion.text) ? 0.6 : 0, /terms of reference|\btor\b/i.test(title) && /terms of reference|\btor\b/i.test(motion.text) && textSimilarity(title, motion.text) > 0.2 ? 0.55 : 0) }))
      .filter(({ motion, score }) => score >= 0.5 && (!versionDate || Math.abs(Date.parse(motion.date) - Date.parse(versionDate.length === 7 ? `${versionDate}-15` : versionDate)) <= windowDays * 86400000))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best) links.push({ kind: "policy-adopted-by", from: extraction.fileKey, to: `${best.motion.fileKey}#motion${best.motion.motionIndex}`, detail: `${meetingKey(best.motion.bodyKey, best.motion.date)} (similarity ${best.score.toFixed(2)})`, meetingDate: best.motion.date, bodyKey: best.motion.bodyKey, motionIndex: best.motion.motionIndex });
  }
  return links;
}

export type ExtendedRecordGap = RecordGap;

const KIND_LABEL: Record<string, string> = { agenda: "agenda", consent_agenda: "consent agenda", agm_agenda: "AGM agenda", package: "meeting package", meetingPackage: "meeting package", agmMaterial: "AGM notice or package", agm_notice: "AGM notice", agm_script: "AGM script", agm_package: "AGM package" };
const BODY_LABEL: Record<string, string> = { board: "board", agm: "annual general", sgm: "special general", executive: "executive committee", operations: "operations committee", committee: "committee", members: "members'", joint: "joint" };
const CLASS_LABEL: Record<string, string> = { agenda: "An agenda", meetingPackage: "A meeting package", agmMaterial: "AGM material", bylaws: "The bylaws", policy: "A policy", correspondence: "Correspondence", agreement: "An agreement", grant: "A grant document", registryFiling: "A registry filing", financialStatement: "A financial statement", budget: "A budget", insurance: "An insurance document" };
/** "an agenda", "a consent agenda" — the article English needs before a label. */
const withArticle = (label: string) => `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
/** Body key → words ("committee:aqmp-committee" → "aqmp committee"). */
const bodyWords = (bodyKey: string) => BODY_LABEL[bodyKey] ?? bodyKey.replace(/^committee:/, "").replace(/-/g, " ");

/** Meetings evidenced by an agenda / package / AGM material but with no minutes in the corpus. */
export function agendaEvidencedMeetings(extractions: IntakeExtractionResult[], files: IntakeFileRecord[], meetings: ReconciledMeeting[]): Array<{ meetingKey: string; bodyKey: string; date: string; fileId: string; kind: string }> {
  const known = new Set(meetings.map((meeting) => meeting.meetingKey));
  const out = new Map<string, { meetingKey: string; bodyKey: string; date: string; fileId: string; kind: string }>();
  for (const extraction of extractions) {
    if (!["agenda", "meetingPackage", "agmMaterial"].includes(extraction.docClass)) continue;
    const record: any = extraction.record;
    const date = val(record.date) ?? val(record.meetingDate);
    if (!date || date.precision !== "day") continue;
    const label = val(record.bodyLabel) ?? val(record.body) ?? (extraction.docClass === "agmMaterial" ? "Annual General Meeting" : undefined);
    const bodyKey = bodyKeyFor(label ?? files.find((file) => file.fileKey === extraction.fileKey)?.classification?.bodyLabel);
    if (bodyKey === "unknown") continue;
    const file = files.find((candidate) => candidate.fileKey === (extraction.parentFileKey ?? extraction.fileKey));
    const name = `${file?.name ?? extraction.fileKey} ${val(record.title) ?? ""}`;
    // A press or media release announces a meeting; it is not evidence that one was held.
    if (/\b(?:press|media|news)\s+release\b/i.test(name)) continue;
    const key = meetingKey(bodyKey, date.iso);
    // Same body within a day counts as found (agenda dated the evening before, etc.). An agenda
    // within a week of a held meeting of the same body is that meeting's (rescheduled or
    // misdated) agenda unless it says the meeting is a special one.
    const toleranceDays = /\bspecial\b/i.test(name) ? 1 : 7;
    const near = [...known].some((existing) => existing.startsWith(`${bodyKey}@`) && Math.abs(Date.parse(existing.split("@")[1]) - Date.parse(date.iso)) <= toleranceDays * 86400000);
    if (known.has(key) || near || out.has(key)) continue;
    out.set(key, { meetingKey: key, bodyKey, date: date.iso, fileId: extraction.fileKey, kind: String(val(record.kind) ?? extraction.docClass) });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Record gaps from class extractions: agenda-evidenced meetings without minutes, unresolved
 * references, annual-report evidence per AGM year, and policies without an adoption link. */
export function classRecordGaps(input: {
  extractions: IntakeExtractionResult[];
  meetings: ReconciledMeeting[];
  evidenced: ReturnType<typeof agendaEvidencedMeetings>;
  policyLinks: ReturnType<typeof linkPolicyAdoptions>;
  fiscalChanges: ReturnType<typeof annotateFiscalYearEndChanges>;
}): ExtendedRecordGap[] {
  const gaps: ExtendedRecordGap[] = [];
  for (const meeting of input.evidenced) {
    const label = KIND_LABEL[meeting.kind] ?? meeting.kind.replace(/_/g, " ");
    const shown = withArticle(label);
    gaps.push({ kind: "meeting_without_minutes", bodyKey: meeting.bodyKey, date: meeting.date, severity: meeting.bodyKey === "agm" ? "statutory" : "practice", explanation: `${shown[0].toUpperCase()}${shown.slice(1)} shows ${withArticle(bodyWords(meeting.bodyKey))} meeting on ${meeting.date}, but no minutes for it were found. Promoting the agenda creates the meeting record; confirm it was held and add the minutes.`, evidence: [{ fileId: meeting.fileId }] });
  }
  // References to earlier minutes (packages, AGM material, correspondence) that no meeting satisfies.
  const known = input.meetings.map((meeting) => meeting.meetingKey);
  const seen = new Set<string>();
  for (const extraction of input.extractions) {
    if (extraction.docClass === "meetingMinutes") continue;
    for (const reference of extraction.references) {
      if ((reference.kind !== "prior_minutes" && reference.kind !== "meeting") || !reference.date || !/^\d{4}-\d{2}-\d{2}$/.test(reference.date)) continue;
      // Only citations of minutes or meetings count: a heading such as "Notes:" or "Annual
      // Activity Report", or a duration ("limited to 10 minutes"), is not a missing record.
      if (!/\bminutes\b|\bmeeting\b|\bAGM\b/i.test(reference.text) || /\b\d+\s*(?:-\s*\d+\s*)?minutes\b/i.test(reference.text)) continue;
      const bodyKey = reference.body ? bodyKeyFor(reference.body) : undefined;
      const found = known.some((key) => (!bodyKey || bodyKey === "unknown" || key.startsWith(`${bodyKey}@`)) && Math.abs(Date.parse(key.split("@")[1]) - Date.parse(reference.date!)) <= 2 * 86400000)
        || input.evidenced.some((meeting) => meeting.date === reference.date);
      const key = `${bodyKey ?? "any"}@${reference.date}`;
      if (found || seen.has(key)) continue;
      seen.add(key);
      // Embedded minutes are cited by their heading; a bare heading ("Members Present:") says nothing, so it is not quoted.
      const quoted = reference.text.trim().length > 12 && !/:\s*$/.test(reference.text.trim()) ? ` ("${reference.text.slice(0, 120)}")` : "";
      const what = reference.kind === "prior_minutes" ? `minutes of ${reference.date}` : `a meeting on ${reference.date}`;
      gaps.push({ kind: "unresolved_reference", bodyKey, date: reference.date, severity: "practice", explanation: `${CLASS_LABEL[extraction.docClass] ?? "A document"} cites ${what}${quoted}, but no minutes or meeting record for that date were found.`, evidence: [{ fileId: extraction.fileKey, text: reference.text.slice(0, 200) }] });
    }
  }
  // Annual report filing evidence for every year with an AGM (BC Societies Act: within 30 days of the AGM).
  const filings = input.extractions.filter((extraction) => extraction.docClass === "registryFiling" && val((extraction.record as any).filingType) === "annual_report");
  const filedYears = new Set(filings.flatMap((extraction) => {
    const record: any = extraction.record;
    return [val(record.period), val(record.agmDate)?.iso?.slice(0, 4), val(record.filedDate)?.iso?.slice(0, 4)].filter(Boolean).map(String);
  }));
  if (filings.length) {
    const agmYears = [...new Set(input.meetings.filter((meeting) => meeting.bodyKey === "agm" || meeting.bodyKey === "joint").map((meeting) => meeting.date.slice(0, 4)))];
    for (const year of agmYears) {
      if (filedYears.has(year)) continue;
      gaps.push({ kind: "annual_report_evidence_missing", year: Number(year), severity: "statutory", explanation: `An AGM was held in ${year} but no annual-report filing confirmation for ${year} is in the folder. Mark "evidence missing" (it may be on file with the registry), not "not filed".` });
    }
  }
  // Policy versions with no adopting motion found.
  const linked = new Set(input.policyLinks.map((link) => link.from));
  for (const extraction of input.extractions) {
    if (extraction.docClass !== "policy" && extraction.docClass !== "bylaws") continue;
    const record: any = extraction.record;
    if (val(record.external) || linked.has(extraction.fileKey) || val(record.status) === "draft") continue;
    gaps.push({ kind: "policy_without_adoption", severity: extraction.docClass === "bylaws" ? "bylaw" : "practice", explanation: `No motion adopting "${String(val(record.title) ?? extraction.fileKey).slice(0, 100)}"${val(record.versionLabel) ? ` (${val(record.versionLabel)})` : ""} was found in the minutes.`, evidence: [{ fileId: extraction.fileKey }] });
  }
  for (const change of input.fiscalChanges) gaps.push({ kind: "fiscal_year_end_change", year: change.firstYear, severity: "statutory", explanation: `Fiscal year end changed from ${change.from} to ${change.to}; confirm the transition period was approved (bylaw/registry change) and that an AGM received the transition statements.`, evidence: [{ fileId: change.fileKey }] });
  return gaps;
}
