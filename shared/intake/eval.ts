/** Intake evaluation (design §4.5): grades an extraction against a golden
 * document in the golden-set format (expected NATIVE records per source). */
import { referenceMatches, normalizePersonKey, similarNames } from "./names";
import type { FieldValue } from "./schemas/common";
import type { VerificationSummary } from "./verify";

export type GoldenMotion = { text: string; status?: string; outcome?: string | null; movedBy?: string; secondedBy?: string; sectionTitle?: string };
export type GoldenDocument = {
  id: string;
  source: { fileName: string; shaDir?: string; fixture?: string; [key: string]: unknown };
  meeting?: { type?: string; date?: string; startLocal?: string | null; endLocal?: string | null; location?: string | null; electronic?: boolean | null; [key: string]: unknown } | null;
  minutes?: { chairName?: string | null; recorderName?: string | null; calledToOrderAt?: string | null; adjournedAt?: string | null; quorumStatus?: string | null; nextMeeting?: { date?: string } | null; [key: string]: unknown } | null;
  attendance?: Array<{ name: string; status: string; roleTitle?: string; affiliation?: string; proxyFor?: string }>;
  motions?: GoldenMotion[] | null;
  tasks?: Array<{ text: string; assignee?: string | null; dueDate?: string | null }> | null;
  holdout?: boolean;
};
export type GoldenSet = { version?: number; documents: GoldenDocument[] };

const STOP = new Set(["the", "a", "an", "of", "to", "for", "and", "be", "by", "with", "on", "in", "at", "as", "that", "this", "is", "was", "were", "it", "its", "from", "or", "all", "any", "made", "motion", "moved", "move", "seconded", "carried", "approve", "approved", "adopt", "adopted", "adoption", "previous", "meeting", "minutes"]);
function stem(word: string): string {
  return word.replace(/(?:ings?|ed|es|s)$/i, "").replace(/(?:ation|ment)$/i, "");
}
export function contentTokens(value: string | undefined | null): string[] {
  return (value ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9$\s]/g, " ").split(/\s+/).filter((word) => word && !STOP.has(word)).map(stem);
}
export function textSimilarity(a: string | undefined | null, b: string | undefined | null): number {
  const x = new Set(contentTokens(a)), y = new Set(contentTokens(b));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const token of x) if (y.has(token)) shared++;
  return (2 * shared) / (x.size + y.size);
}

/** Golden names may carry aliases in parentheses: "Chamber of Commerce (CoC)", "Avery Quill (first name only in source: 'Avery')". */
export function nameVariants(value: string | undefined | null): string[] {
  if (!value) return [];
  const variants = [value.split("(")[0].replace(/\s+/g, " ").trim()];
  for (const inner of value.matchAll(/\(([^)]*)\)/g)) {
    for (const quoted of inner[1].matchAll(/['‘’"“”]([^'‘’"“”]+)['‘’"“”]/g)) variants.push(quoted[1]);
    if (!/[:;]/.test(inner[1]) && inner[1].split(/\s+/).length <= 4) variants.push(inner[1]);
  }
  for (const part of value.split(/;\s*/)) if (part !== value) variants.push(part.replace(/\([^)]*\)/g, "").trim());
  return [...new Set(variants.filter(Boolean))];
}
export function namesMatch(predicted: string | undefined | null, golden: string | undefined | null): boolean {
  if (!predicted || !golden) return false;
  const variants = nameVariants(golden);
  return variants.some((variant) => similarNames(predicted, variant) || referenceMatches(predicted, variant) || referenceMatches(variant, predicted) || normalizePersonKey(variant) === normalizePersonKey(predicted));
}

const val = <T,>(field: FieldValue<T> | undefined): T | undefined => (field && (field.status === "stated" || field.status === "inferred" || field.status === "conflicting") ? field.value : undefined);
const personName = (field: FieldValue<{ nameAsWritten: string; resolvedName?: string }> | undefined) => {
  const value = val(field);
  return value ? value.resolvedName ?? value.nameAsWritten : undefined;
};

export type PredictedMinutes = {
  type?: string; date?: string; startLocal?: string; endLocal?: string; location?: string; electronic?: boolean;
  chair?: string; recorder?: string; calledToOrderAt?: string; adjournedAt?: string; quorumStatus?: string; nextMeetingDate?: string;
  attendance: Array<{ name: string; status: string }>;
  motions: Array<{ text: string; section?: string; movedBy?: string; secondedBy?: string; outcome?: string }>;
  tasks: Array<{ text: string; assignee?: string; due?: string }>;
};

const BODY_TO_TYPE: Record<string, string> = { board: "Board", executive: "Board", agm: "AGM", sgm: "AGM", joint: "AGM", operations: "Committee", committee: "Committee" };

export function predictedFromRecord(record: any): PredictedMinutes {
  const quorum = val(record?.quorum?.stated) as string | undefined;
  return {
    type: BODY_TO_TYPE[String(val(record?.body) ?? "")] ?? undefined,
    date: (val(record?.date) as any)?.precision === "day" ? (val(record?.date) as any)?.iso : undefined,
    startLocal: val(record?.startTime), endLocal: val(record?.endTime), location: val(record?.location), electronic: val(record?.electronic),
    chair: personName(record?.chair), recorder: personName(record?.recorder),
    calledToOrderAt: val(record?.calledToOrderAt), adjournedAt: val(record?.adjournedAt),
    quorumStatus: quorum === "met" ? "confirmed" : quorum === "not_met" ? "not_met" : quorum ? "not_recorded" : undefined,
    nextMeetingDate: (val(record?.nextMeeting) as any)?.date,
    attendance: (record?.attendance ?? []).map((entry: any) => ({ name: val(entry.nameAsWritten) ?? "", status: val(entry.category) ?? "unlabelled" })),
    motions: (record?.motions ?? []).map((motion: any) => ({ text: val(motion.text) ?? "", section: val(motion.sectionRef), movedBy: personName(motion.movedBy), secondedBy: personName(motion.secondedBy), outcome: val(motion.outcome) })),
    tasks: (record?.actionItems ?? []).map((task: any) => ({ text: val(task.text) ?? "", assignee: val(task.assigneeAsWritten), due: (val(task.due) as any)?.iso || undefined })),
  };
}

function goldenOutcome(motion: GoldenMotion): string {
  const status = (motion.status ?? "").toLowerCase();
  const outcome = (motion.outcome ?? "").toLowerCase();
  if (status === "voted") return outcome === "defeated" ? "defeated" : "carried";
  return status || outcome || "unknown";
}

function greedyMatch<G, P>(golden: G[], predicted: P[], score: (g: G, p: P) => number, threshold: number): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = [];
  golden.forEach((g, gi) => predicted.forEach((p, pi) => {
    const s = score(g, p);
    if (s >= threshold) pairs.push([gi, pi, s]);
  }));
  pairs.sort((a, b) => b[2] - a[2]);
  const usedG = new Set<number>(), usedP = new Set<number>();
  const out: Array<[number, number, number]> = [];
  for (const pair of pairs) {
    if (usedG.has(pair[0]) || usedP.has(pair[1])) continue;
    usedG.add(pair[0]);
    usedP.add(pair[1]);
    out.push(pair);
  }
  return out;
}

export type Counts = { tp: number; fp: number; fn: number };
export type DocScore = {
  id: string;
  holdout: boolean;
  motions: Counts & { moverChecked: number; moverCorrect: number; seconderChecked: number; seconderCorrect: number; outcomeChecked: number; outcomeCorrect: number; misses: string[]; extras: string[] };
  attendance: Counts & { categoryChecked: number; categoryCorrect: number; attendedCorrect: number; misses: string[]; extras: string[] };
  header: { checked: number; correct: number; fields: Record<string, { expected: unknown; predicted: unknown; ok: boolean }> };
  tasks: Counts & { assigneeChecked: number; assigneeCorrect: number };
  verification?: VerificationSummary;
};

const ATTENDED = new Set(["present", "staff", "proxy", "guest", "unlabelled"]);
const timeOf = (value: string | null | undefined) => value ?? undefined;

export function scoreDocument(golden: GoldenDocument, predicted: PredictedMinutes, verification?: VerificationSummary): DocScore {
  const goldMotions = golden.motions ?? [];
  const motionPairs = greedyMatch(goldMotions, predicted.motions, (g, p) => {
    const text = textSimilarity(g.text, p.text);
    const section = g.sectionTitle && p.section ? textSimilarity(g.sectionTitle, p.section) : 0;
    return Math.max(text, 0.6 * text + 0.4 * section);
  }, 0.34);
  const motions: DocScore["motions"] = { tp: motionPairs.length, fp: predicted.motions.length - motionPairs.length, fn: goldMotions.length - motionPairs.length, moverChecked: 0, moverCorrect: 0, seconderChecked: 0, seconderCorrect: 0, outcomeChecked: 0, outcomeCorrect: 0, misses: [], extras: [] };
  for (const [gi, pi] of motionPairs) {
    const g = goldMotions[gi], p = predicted.motions[pi];
    if (g.movedBy) { motions.moverChecked++; if (namesMatch(p.movedBy, g.movedBy)) motions.moverCorrect++; }
    else if (p.movedBy) motions.moverChecked++;
    if (g.secondedBy) { motions.seconderChecked++; if (namesMatch(p.secondedBy, g.secondedBy)) motions.seconderCorrect++; }
    else if (p.secondedBy) motions.seconderChecked++;
    motions.outcomeChecked++;
    if (goldenOutcome(g) === (p.outcome ?? "unknown")) motions.outcomeCorrect++;
  }
  const matchedG = new Set(motionPairs.map((pair) => pair[0])), matchedP = new Set(motionPairs.map((pair) => pair[1]));
  goldMotions.forEach((g, index) => { if (!matchedG.has(index)) motions.misses.push(g.text); });
  predicted.motions.forEach((p, index) => { if (!matchedP.has(index)) motions.extras.push(p.text); });

  const goldAttendance = golden.attendance ?? [];
  const attendancePairs = greedyMatch(goldAttendance, predicted.attendance, (g, p) => (namesMatch(p.name, g.name) ? (normalizePersonKey(p.name) === normalizePersonKey(g.name) ? 1 : 0.8) : 0), 0.5);
  const attendance: DocScore["attendance"] = { tp: attendancePairs.length, fp: predicted.attendance.length - attendancePairs.length, fn: goldAttendance.length - attendancePairs.length, categoryChecked: 0, categoryCorrect: 0, attendedCorrect: 0, misses: [], extras: [] };
  for (const [gi, pi] of attendancePairs) {
    attendance.categoryChecked++;
    const g = goldAttendance[gi].status, p = predicted.attendance[pi].status;
    if (g === p) attendance.categoryCorrect++;
    if (ATTENDED.has(g) === ATTENDED.has(p)) attendance.attendedCorrect++;
  }
  const aG = new Set(attendancePairs.map((pair) => pair[0])), aP = new Set(attendancePairs.map((pair) => pair[1]));
  goldAttendance.forEach((g, index) => { if (!aG.has(index)) attendance.misses.push(g.name); });
  predicted.attendance.forEach((p, index) => { if (!aP.has(index)) attendance.extras.push(p.name); });

  const header: DocScore["header"] = { checked: 0, correct: 0, fields: {} };
  const check = (field: string, expected: unknown, predictedValue: unknown, ok: (e: any, p: any) => boolean = (e, p) => e === p) => {
    if (expected === undefined || expected === null || expected === "") return;
    const result = predictedValue !== undefined && predictedValue !== null && ok(expected, predictedValue);
    header.checked++;
    if (result) header.correct++;
    header.fields[field] = { expected, predicted: predictedValue, ok: result };
  };
  const meeting = golden.meeting ?? {};
  const minutes = golden.minutes ?? {};
  check("date", meeting.date, predicted.date);
  check("type", meeting.type, predicted.type);
  check("startLocal", timeOf(meeting.startLocal), predicted.startLocal);
  check("endLocal", timeOf(meeting.endLocal), predicted.endLocal);
  check("location", meeting.location, predicted.location, (e, p) => {
    const expected = contentTokens(e), got = new Set(contentTokens(p));
    return expected.length > 0 && expected.filter((token) => got.has(token)).length / expected.length >= 0.6;
  });
  check("electronic", meeting.electronic, predicted.electronic);
  check("chair", minutes.chairName, predicted.chair, (e, p) => namesMatch(p, e));
  check("recorder", minutes.recorderName, predicted.recorder, (e, p) => namesMatch(p, e));
  check("calledToOrderAt", minutes.calledToOrderAt, predicted.calledToOrderAt);
  check("adjournedAt", minutes.adjournedAt, predicted.adjournedAt);
  check("quorumStatus", minutes.quorumStatus, predicted.quorumStatus ?? "not_recorded");
  check("nextMeetingDate", minutes.nextMeeting?.date, predicted.nextMeetingDate);

  const goldTasks = golden.tasks ?? [];
  const taskPairs = greedyMatch(goldTasks, predicted.tasks, (g, p) => textSimilarity(g.text, p.text), 0.34);
  const tasks: DocScore["tasks"] = { tp: taskPairs.length, fp: predicted.tasks.length - taskPairs.length, fn: goldTasks.length - taskPairs.length, assigneeChecked: 0, assigneeCorrect: 0 };
  for (const [gi, pi] of taskPairs) {
    const g = goldTasks[gi], p = predicted.tasks[pi];
    if (!g.assignee) continue;
    tasks.assigneeChecked++;
    const parts = (p.assignee ?? "").split(/\s*(?:\/|,|&|\band\b|;)\s*/).filter(Boolean);
    if (parts.length && parts.every((part) => g.assignee!.split(/;\s*/).some((gold) => namesMatch(part, gold) || /^all\b/i.test(gold) && /^all\b|everyone/i.test(part) || textSimilarity(part, gold) >= 0.5))) tasks.assigneeCorrect++;
  }
  return { id: golden.id, holdout: Boolean(golden.holdout), motions, attendance, header, tasks, verification };
}

const ratio = (a: number, b: number) => (b ? a / b : 1);
export type Aggregate = {
  documents: number;
  motionRecall: number; motionPrecision: number; moverAccuracy: number; seconderAccuracy: number; outcomeAccuracy: number;
  attendanceRecall: number; attendancePrecision: number; attendanceCategoryAccuracy: number; attendedAccuracy: number;
  headerAccuracy: number; headerByField: Record<string, number>;
  taskRecall: number; taskPrecision: number; taskAssigneeAccuracy: number;
  hallucinationRate: number; quotedLocators: number;
  counts: { motions: Counts; attendance: Counts; tasks: Counts };
};

export function aggregate(scores: DocScore[]): Aggregate {
  const sum = (pick: (score: DocScore) => number) => scores.reduce((total, score) => total + pick(score), 0);
  const motion = { tp: sum((s) => s.motions.tp), fp: sum((s) => s.motions.fp), fn: sum((s) => s.motions.fn) };
  const att = { tp: sum((s) => s.attendance.tp), fp: sum((s) => s.attendance.fp), fn: sum((s) => s.attendance.fn) };
  const task = { tp: sum((s) => s.tasks.tp), fp: sum((s) => s.tasks.fp), fn: sum((s) => s.tasks.fn) };
  const byField: Record<string, { checked: number; ok: number }> = {};
  for (const score of scores) for (const [field, result] of Object.entries(score.header.fields)) {
    byField[field] ??= { checked: 0, ok: 0 };
    byField[field].checked++;
    if (result.ok) byField[field].ok++;
  }
  const quoted = sum((s) => s.verification?.quoted ?? 0);
  const bad = sum((s) => (s.verification?.mismatched ?? 0) + (s.verification?.invalid ?? 0));
  return {
    documents: scores.length,
    motionRecall: ratio(motion.tp, motion.tp + motion.fn), motionPrecision: ratio(motion.tp, motion.tp + motion.fp),
    moverAccuracy: ratio(sum((s) => s.motions.moverCorrect), sum((s) => s.motions.moverChecked)),
    seconderAccuracy: ratio(sum((s) => s.motions.seconderCorrect), sum((s) => s.motions.seconderChecked)),
    outcomeAccuracy: ratio(sum((s) => s.motions.outcomeCorrect), sum((s) => s.motions.outcomeChecked)),
    attendanceRecall: ratio(att.tp, att.tp + att.fn), attendancePrecision: ratio(att.tp, att.tp + att.fp),
    attendanceCategoryAccuracy: ratio(sum((s) => s.attendance.categoryCorrect), sum((s) => s.attendance.categoryChecked)),
    attendedAccuracy: ratio(sum((s) => s.attendance.attendedCorrect), sum((s) => s.attendance.categoryChecked)),
    headerAccuracy: ratio(sum((s) => s.header.correct), sum((s) => s.header.checked)),
    headerByField: Object.fromEntries(Object.entries(byField).map(([field, value]) => [field, ratio(value.ok, value.checked)])),
    taskRecall: ratio(task.tp, task.tp + task.fn), taskPrecision: ratio(task.tp, task.tp + task.fp),
    taskAssigneeAccuracy: ratio(sum((s) => s.tasks.assigneeCorrect), sum((s) => s.tasks.assigneeChecked)),
    hallucinationRate: quoted ? bad / quoted : 0, quotedLocators: quoted,
    counts: { motions: motion, attendance: att, tasks: task },
  };
}

// ---------------------------------------------------------------- bulk-accept calibration
/** For the fields that most often stayed below the bulk-accept thresholds (chair, meeting type,
 * body, adopts-minutes links), whether each extracted value would be bulk-accepted and whether it
 * is right. Calibration raises a confidence or lowers a threshold only while every bulk-eligible
 * value stays correct (precision is never traded for coverage). */
export type CalibrationField = "chair" | "meetingType" | "body" | "adoptsMinutesOf";
export type CalibrationItem = { docId: string; field: CalibrationField; expected?: string; predicted?: string; eligible: boolean; correct: boolean; confidence?: number; note?: string };
export type CalibrationSummary = Record<CalibrationField, { expected: number; predicted: number; eligible: number; eligibleCorrect: number; eligibleWrong: number; correctBelowThreshold: number }>;

const TYPE_OF_MEETING_TYPE: Record<string, string> = { regular: "Board", special: "Board", annual_general: "AGM", special_general: "AGM", joint: "AGM", committee: "Committee" };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** ISO dates written in prose ("November 17, 2015", "21 November 2018", "2015-11-17"). */
export function isoDatesIn(text: string): string[] {
  const out = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
  for (const match of text.matchAll(/\b([A-Z][a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]+)\.?,?\s+(\d{4})\b/g)) {
    const name = (match[1] ?? match[5] ?? "").toLowerCase();
    const month = MONTHS.findIndex((candidate) => candidate === name || (name.length >= 3 && candidate.startsWith(name)));
    const day = Number(match[2] ?? match[4]);
    const year = match[3] ?? match[6];
    if (month >= 0 && day >= 1 && day <= 31) out.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return out;
}

export const ADOPTS_MINUTES_WORDING = /\b(?:adopt|approv|accept)\w*\b.{0,60}\bminutes\b|\bminutes\b.{0,60}\b(?:adopt|approv)/i;

export function calibrationItems(golden: GoldenDocument, record: any, threshold: (pattern: string) => number): CalibrationItem[] {
  const items: CalibrationItem[] = [];
  const docId = golden.id;
  const eligible = (field: FieldValue<unknown> | undefined, pattern: string) => Boolean(field && field.status === "stated" && field.value !== undefined && field.value !== "" && (field.verification === "verified_span" || field.verification === "verified_fuzzy") && field.locators?.length && field.confidence >= threshold(pattern));
  if (!golden.meeting) return items;
  // Chair: a chair predicted where the golden record names none is a false positive.
  const expectedChair = golden.minutes?.chairName ?? undefined;
  const chairField = record?.chair as FieldValue<{ nameAsWritten: string; resolvedName?: string }> | undefined;
  const chair = personName(chairField);
  if (expectedChair || chair) items.push({ docId, field: "chair", expected: expectedChair ?? undefined, predicted: chair, eligible: eligible(chairField, "chair"), correct: Boolean(chair && expectedChair && namesMatch(chair, expectedChair)), confidence: chairField?.confidence, note: chairField?.note });
  const expectedType = golden.meeting.type ?? undefined;
  const body = val(record?.body) as string | undefined;
  const bodyType = body ? BODY_TO_TYPE[body] : undefined;
  if (expectedType || body) items.push({ docId, field: "body", expected: expectedType, predicted: bodyType ?? body, eligible: eligible(record?.body, "body"), correct: Boolean(bodyType && bodyType === expectedType), confidence: record?.body?.confidence });
  const meetingType = val(record?.meetingType) as string | undefined;
  // The executive committee acts for the board (golden "Board"): its meetings follow the body.
  const typeLabel = meetingType ? (body === "executive" ? "Board" : TYPE_OF_MEETING_TYPE[meetingType]) : undefined;
  if (expectedType || meetingType) items.push({ docId, field: "meetingType", expected: expectedType, predicted: typeLabel ?? meetingType, eligible: eligible(record?.meetingType, "meetingType"), correct: Boolean(typeLabel && typeLabel === expectedType), confidence: record?.meetingType?.confidence });
  // Adopts-minutes links: the date the adopting motion names, against the golden motion's wording.
  const expectedDates = new Set((golden.motions ?? []).filter((motion) => ADOPTS_MINUTES_WORDING.test(`${motion.text} ${motion.sectionTitle ?? ""}`)).flatMap((motion) => isoDatesIn(`${motion.text} ${motion.sectionTitle ?? ""}`)));
  const predicted = ((record?.motions ?? []) as any[]).map((motion) => motion.adoptsMinutesOf).filter(Boolean);
  for (const link of predicted) {
    const date = link.value?.date as string | undefined;
    items.push({ docId, field: "adoptsMinutesOf", expected: [...expectedDates].join(", ") || undefined, predicted: date ?? link.value?.text, eligible: eligible(link, "motions.adoptsMinutesOf"), correct: Boolean(date && expectedDates.has(date)), confidence: link.confidence, note: link.note });
  }
  for (const date of expectedDates) if (!predicted.some((link: any) => link.value?.date === date)) items.push({ docId, field: "adoptsMinutesOf", expected: date, eligible: false, correct: false });
  return items;
}

export function summarizeCalibration(items: CalibrationItem[]): CalibrationSummary {
  const fields: CalibrationField[] = ["chair", "meetingType", "body", "adoptsMinutesOf"];
  return Object.fromEntries(fields.map((field) => {
    const rows = items.filter((item) => item.field === field);
    return [field, {
      expected: rows.filter((item) => item.expected).length,
      predicted: rows.filter((item) => item.predicted).length,
      eligible: rows.filter((item) => item.eligible).length,
      eligibleCorrect: rows.filter((item) => item.eligible && item.correct).length,
      eligibleWrong: rows.filter((item) => item.eligible && !item.correct).length,
      correctBelowThreshold: rows.filter((item) => !item.eligible && item.correct).length,
    }];
  })) as CalibrationSummary;
}
