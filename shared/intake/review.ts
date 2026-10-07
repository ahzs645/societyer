/** Review and promotion model for intake extractions (design §4.4, stage 10–11).
 * Pure and runtime-neutral: the review screen, the portable promotion
 * mutation and the gate scripts all use it.
 *
 * - `reviewFieldsForRecord` lists every reviewable FieldValue with a stable
 *   path (`motions[2].movedBy`), a label, an editor kind and a legal weight.
 * - Reviews are append-only rows; the latest row per path is the decision.
 * - `applyReviews` turns an extraction record into the record that is
 *   promoted: only accepted or edited fields keep a value.
 * - `bulkAcceptCandidates` selects fields that are stated, span-verified,
 *   not conflicting and at or above the per-class/field threshold.
 * - `nativeTargetForPath` maps a reviewed field to the native table/field it
 *   lands in, so promotion can write one fieldProvenance row per field. */
import type { FieldValue, Locator } from "./schemas/common";
import { isFieldValue } from "./verify";
import { resolvePerson, type DirectoryPerson, type OfficeTerm, type PersonCandidate } from "./entities";
import { isRoleWord, looksLikePersonName, tokens } from "./names";

export type ReviewDecision = "accept" | "edit" | "reject" | "cant_represent";
export const REVIEW_DECISIONS: readonly ReviewDecision[] = ["accept", "edit", "reject", "cant_represent"];

export type ReviewRow = {
  _id?: string;
  fieldPath: string;
  decision: ReviewDecision | string;
  editedValue?: unknown;
  originalValue?: unknown;
  note?: string;
  gap?: Record<string, unknown>;
  reviewedAtISO: string;
  _creationTime?: number;
};

export type FieldKind = "text" | "longtext" | "date" | "time" | "boolean" | "number" | "person" | "enum" | "votes" | "nextMeeting" | "adoptsMinutes" | "json";

export type ReviewGroup = "meeting" | "attendance" | "quorum" | "sections" | "motions" | "actionItems" | "decisions" | "other";

export type ReviewField = {
  path: string;
  /** Path with array indices removed, e.g. `motions.movedBy` (threshold and target lookups). */
  pattern: string;
  group: ReviewGroup;
  /** Index of the array item (motion, attendee, action) the field belongs to. */
  itemIndex?: number;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  required: boolean;
  /** 1 (catalogue detail) … 5 (legal effect: dates, motions, adoption). */
  legalWeight: number;
  field: FieldValue<any>;
};

const BODY_OPTIONS = ["board", "executive", "operations", "committee", "agm", "sgm", "members", "joint", "unknown"] as const;
const MEETING_TYPE_OPTIONS = ["regular", "annual_general", "special_general", "committee", "special", "in_camera", "joint", "workshop", "unknown"] as const;
const RECORD_STATUS_OPTIONS = ["draft", "approved", "signed", "template", "script", "agenda", "recorded", "unknown"] as const;
const ATTENDANCE_OPTIONS = ["present", "regrets", "absent", "staff", "guest", "proxy", "unlabelled"] as const;
const OUTCOME_OPTIONS = ["carried", "defeated", "tabled", "withdrawn", "deferred", "no_quorum", "unknown"] as const;
const RESOLUTION_OPTIONS = ["ordinary", "special", "unanimous", "unknown"] as const;
const QUORUM_OPTIONS = ["met", "not_met", "not_recorded"] as const;

type FieldSpec = { label: string; kind: FieldKind; options?: readonly string[]; weight: number; required?: boolean };
const SPECS: Record<string, FieldSpec> = {
  title: { label: "Title", kind: "text", weight: 1 },
  organizationName: { label: "Organization", kind: "text", weight: 1 },
  body: { label: "Body", kind: "enum", options: BODY_OPTIONS, weight: 4, required: true },
  bodyLabel: { label: "Body as written", kind: "text", weight: 2 },
  meetingType: { label: "Meeting type", kind: "enum", options: MEETING_TYPE_OPTIONS, weight: 3 },
  date: { label: "Meeting date", kind: "date", weight: 5, required: true },
  startTime: { label: "Start time", kind: "time", weight: 2 },
  endTime: { label: "End time", kind: "time", weight: 2 },
  location: { label: "Location", kind: "text", weight: 1 },
  electronic: { label: "Electronic meeting", kind: "boolean", weight: 2 },
  recordStatus: { label: "Record status", kind: "enum", options: RECORD_STATUS_OPTIONS, weight: 4 },
  chair: { label: "Chair", kind: "person", weight: 3 },
  recorder: { label: "Recorder", kind: "person", weight: 2 },
  calledToOrderAt: { label: "Called to order", kind: "time", weight: 2 },
  adjournedAt: { label: "Adjourned", kind: "time", weight: 2 },
  nextMeeting: { label: "Next meeting", kind: "nextMeeting", weight: 1 },
  "attendance.nameAsWritten": { label: "Name", kind: "text", weight: 3 },
  "attendance.category": { label: "Attendance", kind: "enum", options: ATTENDANCE_OPTIONS, weight: 3 },
  "attendance.role": { label: "Role", kind: "text", weight: 2 },
  "attendance.affiliation": { label: "Affiliation", kind: "text", weight: 1 },
  "attendance.proxyFor": { label: "Proxy for", kind: "text", weight: 3 },
  "attendance.arrivalOrLeave": { label: "Arrived / left", kind: "text", weight: 2 },
  "quorum.stated": { label: "Quorum", kind: "enum", options: QUORUM_OPTIONS, weight: 4 },
  "quorum.count": { label: "Quorum head-count", kind: "number", weight: 3 },
  "sections.number": { label: "Item number", kind: "text", weight: 1 },
  "sections.title": { label: "Section title", kind: "text", weight: 1 },
  "sections.presenter": { label: "Presenter", kind: "person", weight: 1 },
  "sections.reportRefs": { label: "Report", kind: "text", weight: 1 },
  "motions.text": { label: "Motion wording", kind: "longtext", weight: 5 },
  "motions.movedBy": { label: "Moved by", kind: "person", weight: 4 },
  "motions.secondedBy": { label: "Seconded by", kind: "person", weight: 4 },
  "motions.outcome": { label: "Outcome", kind: "enum", options: OUTCOME_OPTIONS, weight: 5 },
  "motions.votes": { label: "Votes", kind: "votes", weight: 4 },
  "motions.byConsensus": { label: "By consensus", kind: "boolean", weight: 3 },
  "motions.resolutionType": { label: "Resolution type", kind: "enum", options: RESOLUTION_OPTIONS, weight: 4 },
  "motions.adoptsMinutesOf": { label: "Adopts minutes of", kind: "adoptsMinutes", weight: 5 },
  "motions.adoptsPolicy": { label: "Adopts policy", kind: "text", weight: 5 },
  "motions.adoptsAgenda": { label: "Adopts agenda", kind: "boolean", weight: 2 },
  "motions.ratifies": { label: "Ratifies", kind: "text", weight: 4 },
  "motions.conditional": { label: "Conditional", kind: "boolean", weight: 3 },
  "motions.sectionRef": { label: "Agenda item", kind: "text", weight: 1 },
  "actionItems.text": { label: "Action", kind: "longtext", weight: 2 },
  "actionItems.assigneeAsWritten": { label: "Assignee", kind: "text", weight: 2 },
  "actionItems.due": { label: "Due", kind: "date", weight: 2 },
  "actionItems.statusAsWritten": { label: "Status as written", kind: "text", weight: 1 },
  "actionItems.carriedFromRef": { label: "Carried from", kind: "text", weight: 1 },
  "actionItems.sectionRef": { label: "Agenda item", kind: "text", weight: 1 },
  decisions: { label: "Decision", kind: "longtext", weight: 3 },
  attachmentsReferenced: { label: "Attachment referenced", kind: "text", weight: 1 },
  sessionSegments: { label: "Session segment", kind: "json", weight: 2 },
};

const GROUP_FOR: Record<string, ReviewGroup> = { attendance: "attendance", quorum: "quorum", sections: "sections", motions: "motions", actionItems: "actionItems", decisions: "decisions" };
const HEADER_ORDER = ["title", "body", "bodyLabel", "meetingType", "date", "startTime", "endTime", "location", "electronic", "recordStatus", "chair", "recorder", "calledToOrderAt", "adjournedAt", "nextMeeting", "organizationName"];

export function patternOf(path: string): string {
  return path.replace(/\[\d+\]/g, "");
}

function humanize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

const AGENDA_CLASSES = new Set(["agenda", "meetingPackage", "agmMaterial"]);

/** Fields a reviewer must accept (or edit) before a record of this class can be promoted. */
export function requiredFieldsFor(docClass: string | undefined, record: unknown): Array<{ path: string; label: string }> {
  const object = (record && typeof record === "object" ? record : {}) as Record<string, unknown>;
  const has = (key: string) => object[key] !== undefined && object[key] !== null;
  if (!docClass || docClass === "meetingMinutes") return [{ path: "body", label: "Body" }, { path: "date", label: "Meeting date" }];
  if (AGENDA_CLASSES.has(docClass)) return [...(has("body") ? [{ path: "body", label: "Body" }] : []), { path: has("meetingDate") && !has("date") ? "meetingDate" : "date", label: "Meeting date" }];
  if (docClass === "policy" || docClass === "bylaws" || docClass === "grant") return has("title") ? [{ path: "title", label: "Title" }] : [];
  if (docClass === "financialStatement") return [{ path: "periodEnd", label: "Period end" }];
  // An insurance policy is identified by its insurer or policy number (the import contract drops one with neither).
  if (docClass === "insurance") return [...(has("termStart") || !has("policyNumber") ? [{ path: "termStart", label: "Term start" }] : []), has("insurer") || !has("policyNumber") ? { path: "insurer", label: "Insurer" } : { path: "policyNumber", label: "Policy number" }];
  if (docClass === "registryFiling") return has("filingType") ? [{ path: "filingType", label: "Filing type" }] : [];
  if (docClass === "invoice") return [{ path: "date", label: "Invoice date" }, { path: "amount", label: "Amount" }, ...(has("vendor") ? [{ path: "vendor", label: "Vendor" }] : [])];
  return [];
}

/** Label of the `date` field: the meeting date only for meeting records. */
function dateLabelFor(docClass: string | undefined): string {
  if (!docClass || docClass === "meetingMinutes" || AGENDA_CLASSES.has(docClass)) return "Meeting date";
  if (docClass === "invoice") return "Invoice date";
  if (docClass === "correspondence") return "Sent";
  return "Date";
}

/** Every reviewable FieldValue in an extraction record, header first, then by group and item.
 * `docClass` sets class-specific labels and which fields are required (minutes by default). */
export function reviewFieldsForRecord(record: unknown, docClass?: string): ReviewField[] {
  const required = new Map(requiredFieldsFor(docClass, record).map((field) => [field.path, field.label]));
  const meetingRecord = !docClass || docClass === "meetingMinutes" || AGENDA_CLASSES.has(docClass);
  const out: ReviewField[] = [];
  const visit = (node: unknown, path: string, itemIndex?: number) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}[${index}]`, path.includes("[") ? itemIndex : index));
      return;
    }
    if (!node || typeof node !== "object") return;
    if (isFieldValue(node)) {
      const pattern = patternOf(path);
      const top = pattern.split(".")[0];
      // Minutes-specific specs (attendance, motions…) apply to meeting records; other classes use their own field names.
      const spec = meetingRecord || !["body", "meetingType", "recordStatus"].includes(pattern) ? SPECS[pattern] ?? (meetingRecord ? SPECS[top] : undefined) : undefined;
      const label = pattern === "date" ? dateLabelFor(docClass) : required.get(pattern) ?? spec?.label ?? humanize(pattern.split(".").pop() ?? pattern);
      out.push({
        path,
        pattern,
        group: (meetingRecord ? GROUP_FOR[top] : undefined) ?? (path.includes(".") || path.includes("[") ? "other" : "meeting"),
        ...(itemIndex !== undefined ? { itemIndex } : {}),
        label,
        kind: spec?.kind ?? (pattern === "date" || /(?:Date|Start|End|^effective|^expiry)$/.test(pattern) && typeof (node as FieldValue<any>).value?.iso === "string" ? "date" : typeof (node as FieldValue<unknown>).value === "object" ? "json" : typeof (node as FieldValue<unknown>).value === "boolean" ? "boolean" : "text"),
        ...(spec?.options ? { options: spec.options } : {}),
        required: required.has(path),
        legalWeight: spec?.weight ?? 1,
        field: node as FieldValue<any>,
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "personKey") continue;
      visit(child, path ? `${path}.${key}` : key, itemIndex);
    }
  };
  visit(record, "");
  const groupRank: Record<ReviewGroup, number> = { meeting: 0, quorum: 1, attendance: 2, motions: 3, actionItems: 4, sections: 5, decisions: 6, other: 7 };
  return out.sort((a, b) => {
    if (a.group !== b.group) return groupRank[a.group] - groupRank[b.group];
    if (a.group === "meeting") return (HEADER_ORDER.indexOf(a.pattern) + 1 || 99) - (HEADER_ORDER.indexOf(b.pattern) + 1 || 99);
    return (a.itemIndex ?? 0) - (b.itemIndex ?? 0);
  });
}

/** Latest review per field path (reviews are append-only; undo deletes rows). */
export function latestDecisions(reviews: readonly ReviewRow[]): Map<string, ReviewRow> {
  const sorted = [...reviews].sort((a, b) => a.reviewedAtISO.localeCompare(b.reviewedAtISO) || (a._creationTime ?? 0) - (b._creationTime ?? 0));
  const out = new Map<string, ReviewRow>();
  for (const review of sorted) out.set(review.fieldPath, review);
  return out;
}

export function isPromotedDecision(decision: string | undefined): boolean {
  return decision === "accept" || decision === "edit";
}

/** Display text for any field value. */
export function formatFieldValue(value: unknown, kind?: FieldKind): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value).replace(/_/g, kind === "enum" ? " " : "_");
  const object = value as Record<string, any>;
  if (typeof object.nameAsWritten === "string") return object.resolvedName && object.resolvedName !== object.nameAsWritten ? `${object.nameAsWritten} → ${object.resolvedName}` : object.nameAsWritten;
  if (typeof object.iso === "string") return object.precision && object.precision !== "day" ? `${object.iso} (${object.precision})` : object.iso;
  if ("for" in object || "against" in object || "abstain" in object) return [`for ${object.for ?? "?"}`, `against ${object.against ?? "?"}`, object.abstain !== undefined ? `abstain ${object.abstain}` : ""].filter(Boolean).join(", ");
  if (typeof object.text === "string") return [object.date, object.time, object.location].filter(Boolean).length ? `${object.text} (${[object.date, object.time, object.location].filter(Boolean).join(", ")})` : object.text;
  if (typeof object.type === "string") return [object.type.replace(/_/g, " "), object.title].filter(Boolean).join(": ");
  return JSON.stringify(value);
}

/** Records the promoted value of a field: edited value, accepted value, or nothing. */
function reviewedField(field: FieldValue<any>, review: ReviewRow | undefined): FieldValue<any> {
  if (!review || !isPromotedDecision(review.decision)) {
    const { value: _value, ...rest } = field;
    return { ...rest, status: "not_stated", note: review ? `Reviewer decision: ${review.decision}` : "Not reviewed; not promoted." };
  }
  if (review.decision === "edit") {
    return { ...field, value: review.editedValue, status: "stated", confidence: 1, note: `Edited by reviewer; original: ${formatFieldValue(field.value)}` };
  }
  // A reviewer who accepts a conflicting value has resolved the conflict.
  return { ...field, status: field.status === "conflicting" ? "stated" : field.status };
}

const ITEM_KEY: Record<string, string> = { attendance: "nameAsWritten", motions: "text", actionItems: "text", sections: "title" };

export type AppliedReviews = {
  record: Record<string, any>;
  promotedPaths: string[];
  /** original item index → index in the promoted record, per array group. */
  indexMap: Record<string, Record<number, number>>;
};

/** The record that is promoted: only accepted/edited fields keep a value; list items whose key field was not promoted are dropped. */
export function applyReviews(record: Record<string, any>, decisions: Map<string, ReviewRow>): AppliedReviews {
  const promotedPaths: string[] = [];
  const indexMap: Record<string, Record<number, number>> = {};
  const transform = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) {
      const key = ITEM_KEY[path];
      const out: unknown[] = [];
      node.forEach((child, index) => {
        const childPath = `${path}[${index}]`;
        if (key && !isPromotedDecision(decisions.get(`${childPath}.${key}`)?.decision)) return;
        if (!key && isFieldValue(child) && !isPromotedDecision(decisions.get(childPath)?.decision)) return;
        (indexMap[path] ??= {})[index] = out.length;
        out.push(transform(child, childPath));
      });
      return out;
    }
    if (!node || typeof node !== "object") return node;
    if (isFieldValue(node)) {
      const review = decisions.get(path);
      if (isPromotedDecision(review?.decision)) promotedPaths.push(path);
      return reviewedField(node as FieldValue<any>, review);
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, transform(child, path ? `${path}.${key}` : key)]));
  };
  return { record: transform(record, "") as Record<string, any>, promotedPaths, indexMap };
}

export type Readiness = { ready: boolean; missing: string[]; problems: string[]; reviewed: number; promoted: number; rejected: number; unreviewed: number; total: number };

/** A record can be promoted once its required fields are accepted: for minutes and agendas the
 * meeting date (to the day) and body; for other classes see requiredFieldsFor. */
export function promotionReadiness(fields: ReviewField[], decisions: Map<string, ReviewRow>, docClass?: string): Readiness {
  const missing: string[] = [];
  const problems: string[] = [];
  const meetingRecord = !docClass || docClass === "meetingMinutes" || AGENDA_CLASSES.has(docClass);
  for (const field of fields.filter((candidate) => candidate.required)) {
    const review = decisions.get(field.path);
    if (!isPromotedDecision(review?.decision)) {
      missing.push(field.label);
      continue;
    }
    const value = review!.decision === "edit" ? review!.editedValue : field.field.value;
    const exactDay = (candidate: unknown) => Boolean(candidate) && (candidate as any).precision === "day" && /^\d{4}-\d{2}-\d{2}$/.test(String((candidate as any).iso ?? ""));
    if (meetingRecord && (field.pattern === "date" || field.pattern === "meetingDate") && !exactDay(value)) problems.push("The meeting date must be an exact day (edit it to YYYY-MM-DD).");
    else if (!meetingRecord && field.kind === "date" && !exactDay(value) && docClass !== "financialStatement") problems.push(`The ${field.label.toLowerCase()} must be an exact day (edit it to YYYY-MM-DD).`);
  }
  // A missing required field (no value extracted at all) must be added before promotion.
  const present = Object.fromEntries(fields.filter((field) => !/[.[]/.test(field.path)).map((field) => [field.path, true]));
  for (const required of requiredFieldsFor(docClass, present)) {
    if (!fields.some((field) => field.path === required.path) && !missing.includes(required.label) && (meetingRecord ? required.path !== "body" : true)) missing.push(required.label);
  }
  let promoted = 0, rejected = 0;
  for (const field of fields) {
    const decision = decisions.get(field.path)?.decision;
    if (isPromotedDecision(decision)) promoted++;
    else if (decision) rejected++;
  }
  const reviewed = promoted + rejected;
  return { ready: !missing.length && !problems.length, missing, problems, reviewed, promoted, rejected, unreviewed: fields.length - reviewed, total: fields.length };
}

// ------------------------------------------------------------ bulk accept

/** Bulk-accept thresholds (τ) per class and field pattern. Defaults sit just above
 * the deterministic engine's confidence for heuristic values (0.75–0.8) and at its
 * stated-value level (0.85–0.95), so only directly quoted, verified values pass. */
export const BULK_ACCEPT_THRESHOLDS: Record<string, Record<string, number>> = {
  // Class documents (policies, statements, insurance, grants …): the class extractors quote a
  // document's title from its heading and its dates from labelled lines at 0.8; heuristic
  // guesses sit at 0.6–0.75 (organization names, funders, version labels) and stay below τ.
  default: { default: 0.85, title: 0.8, insurer: 0.8, date: 0.8, meetingDate: 0.8, periodEnd: 0.8, effective: 0.8, expiry: 0.8, effectiveDate: 0.8, adoptedDate: 0.8, filedDate: 0.8, termStart: 0.8, signedDate: 0.8 },
  meetingMinutes: {
    default: 0.85,
    // Calibrated on the private minutes golden set: stated locations and recorders were 100%
    // correct at the extractor's 0.8 (15 documents); chair (90%) stays at the default.
    location: 0.8,
    recorder: 0.8,
    // The meeting type is read from the same header label as bodyLabel (0.8): 15 of 15 golden
    // documents and 6 of 6 synthetic ones were right. File-name and default guesses stay inferred.
    meetingType: 0.8,
    date: 0.9,
    body: 0.85,
    // Header labels the extractor quotes directly (0.8): the body as written names the meeting, the location is printed.
    bodyLabel: 0.8,
    "attendance.nameAsWritten": 0.8,
    "attendance.category": 0.8,
    "attendance.affiliation": 0.9,
    "motions.text": 0.85,
    "motions.outcome": 0.85,
    "motions.movedBy": 0.85,
    "motions.secondedBy": 0.85,
    "motions.adoptsMinutesOf": 0.9,
    "motions.adoptsPolicy": 0.9,
    "actionItems.text": 0.8,
    "actionItems.assigneeAsWritten": 0.8,
    "sections.title": 0.8,
    "sections.number": 0.8,
  },
  // Class extractors (WP-L) state directly quoted values at 0.8–0.9 and heuristic ones at ≤ 0.75;
  // amounts, dates and people keep the stricter level.
  ...Object.fromEntries(["agenda", "meetingPackage", "agmMaterial", "bylaws", "policy", "directorConsent", "proxy", "roster", "financialStatement", "budget", "insurance", "agreement", "grant", "registryFiling", "correspondence", "invoice"].map((docClass) => [docClass, {
    default: 0.8, date: 0.85, meetingDate: 0.85, periodEnd: 0.85, termStart: 0.85, termEnd: 0.85, filedDate: 0.85, amount: 0.8, "entries.person": 0.85, directorsListed: 0.85,
    // Roster notes ("Left PGAIR in May 2022") are quoted but month-precise (0.7).
    "entries.termStart": 0.7, "entries.termEnd": 0.7,
    // INT-17: decisions/commitments are sentences quoted verbatim from the message (0.6 because
    // they are evidence, not recorded decisions). isBulkEligible still requires a stated value with
    // a verified span, and promotion keeps them as restricted source evidence.
    ...(docClass === "correspondence" ? { decisionsOrCommitments: 0.6 } : {}),
  }])),
};

export function thresholdFor(docClass: string, pattern: string, overrides?: Record<string, number>): number {
  if (overrides && typeof overrides[pattern] === "number") return overrides[pattern];
  if (overrides && typeof overrides.default === "number" && !(pattern in (BULK_ACCEPT_THRESHOLDS[docClass] ?? {}))) return overrides.default;
  const table = BULK_ACCEPT_THRESHOLDS[docClass] ?? BULK_ACCEPT_THRESHOLDS.default;
  return table[pattern] ?? table.default ?? 0.85;
}

export type BulkScope = { group?: ReviewGroup; itemIndex?: number };

export function isBulkEligible(field: ReviewField, docClass: string, overrides?: Record<string, number>): boolean {
  const value = field.field;
  if (value.status !== "stated") return false;
  if (value.value === undefined || value.value === null || value.value === "") return false;
  if (value.verification !== "verified_span" && value.verification !== "verified_fuzzy") return false;
  if (!value.locators?.length) return false;
  return value.confidence >= thresholdFor(docClass, field.pattern, overrides);
}

/** Unreviewed fields that are stated, span-verified, not conflicting and at or above τ. */
export function bulkAcceptCandidates(fields: ReviewField[], decisions: Map<string, ReviewRow>, docClass: string, scope: BulkScope = {}, overrides?: Record<string, number>): ReviewField[] {
  return fields.filter((field) => {
    if (decisions.has(field.path)) return false;
    if (scope.group && field.group !== scope.group) return false;
    if (scope.itemIndex !== undefined && field.itemIndex !== scope.itemIndex) return false;
    return isBulkEligible(field, docClass, overrides);
  });
}

/** Up to `size` candidates spread across the list (deterministic) for the preview. */
export function samplePreview<T>(items: readonly T[], size = 5): T[] {
  if (items.length <= size) return [...items];
  const step = items.length / size;
  return Array.from({ length: size }, (_, index) => items[Math.min(items.length - 1, Math.floor(index * step + step / 2))]);
}

// ------------------------------------------------------------ queue

export type QueueRow = { _id: string; fileId: string; fileKey: string; docClass: string; status: string; risk: number; motions: number; unsupported: number; lowConfidenceFields: number; verification?: { mismatched?: number }; date?: string; body?: string; summary?: string; promotion?: { targets?: Array<{ table: string; id: string; label: string }>; coveredByExtractionId?: string; coveredByFileKey?: string } };
export type RiskTier = "high" | "medium" | "low";
const LEGAL_CLASSES = new Set(["bylaws", "policy", "registryFiling", "directorConsent", "proxy", "financialStatement", "agreement"]);

export function riskTier(row: QueueRow): RiskTier {
  if ((row.verification?.mismatched ?? 0) > 0 || LEGAL_CLASSES.has(row.docClass) || row.motions >= 4 || row.risk >= 15) return "high";
  if (row.motions > 0 || row.lowConfidenceFields > 3 || row.unsupported > 0 || row.risk >= 5) return "medium";
  return "low";
}

export type ClusterLike = { clusterKey: string; canonicalFileId?: string; canonicalFileKey: string; members: Array<{ fileKey: string; fileId?: string; relation: string; reason?: string }> };
export type QueueGroup = { tier: RiskTier; clusters: Array<{ key: string; canonical: QueueRow; versions: Array<{ row?: QueueRow; fileKey: string; fileId?: string; relation: string; reason?: string }> }> };

/** Queue grouped by risk tier, then by cluster (canonical copy + its versions). */
export function groupQueue(rows: QueueRow[], clusters: ClusterLike[]): QueueGroup[] {
  const clusterOf = new Map<string, ClusterLike>();
  for (const cluster of clusters) for (const member of cluster.members) clusterOf.set(member.fileKey, cluster);
  const byFileKey = new Map(rows.map((row) => [row.fileKey, row]));
  const seen = new Set<string>();
  const tiers: Record<RiskTier, QueueGroup["clusters"]> = { high: [], medium: [], low: [] };
  for (const row of [...rows].sort((a, b) => b.risk - a.risk)) {
    if (seen.has(row.fileKey)) continue;
    const cluster = clusterOf.get(row.fileKey);
    if (!cluster) {
      seen.add(row.fileKey);
      tiers[riskTier(row)].push({ key: row._id, canonical: row, versions: [] });
      continue;
    }
    // The canonical copy leads; when it has no extraction (e.g. a catalogued PDF twin), the highest-risk extracted member does.
    const canonical = byFileKey.get(cluster.canonicalFileKey) ?? row;
    const versions = cluster.members.filter((member) => member.fileKey !== canonical.fileKey).map((member) => ({ row: byFileKey.get(member.fileKey), fileKey: member.fileKey, fileId: member.fileId, relation: member.relation, reason: member.reason }));
    for (const member of cluster.members) seen.add(member.fileKey);
    const tier = [canonical, ...versions.map((version) => version.row).filter(Boolean) as QueueRow[]].map(riskTier).sort((a, b) => ["high", "medium", "low"].indexOf(a) - ["high", "medium", "low"].indexOf(b))[0];
    tiers[tier].push({ key: cluster.clusterKey, canonical, versions });
  }
  return (["high", "medium", "low"] as RiskTier[]).filter((tier) => tiers[tier].length).map((tier) => ({ tier, clusters: tiers[tier] }));
}

// ------------------------------------------------------------ entities

export type NameOccurrence = { path: string; name: string; resolvedName?: string; kind: "person" | "attendance" | "assignee"; roleWord: boolean };

/** Names and role words written in a record (chair, movers, attendees, assignees). */
export function nameOccurrences(record: Record<string, any>): NameOccurrence[] {
  const out: NameOccurrence[] = [];
  for (const field of reviewFieldsForRecord(record)) {
    const value = field.field.value;
    if (value === undefined || value === null) continue;
    if (field.kind === "person" && typeof value === "object" && typeof (value as any).nameAsWritten === "string") {
      out.push({ path: field.path, name: (value as any).nameAsWritten, resolvedName: (value as any).resolvedName, kind: "person", roleWord: isRoleReference((value as any).nameAsWritten) });
    } else if (field.pattern === "attendance.nameAsWritten" && typeof value === "string") {
      out.push({ path: field.path, name: value, kind: "attendance", roleWord: isRoleReference(value) });
    } else if (field.pattern === "actionItems.assigneeAsWritten" && typeof value === "string") {
      out.push({ path: field.path, name: value, kind: "assignee", roleWord: isRoleReference(value) });
    }
  }
  return out;
}

export function isRoleReference(value: string): boolean {
  const words = tokens(value.toLowerCase()).filter((word) => word !== "the");
  return words.length > 0 && words.length <= 3 && words.every((word) => isRoleWord(word));
}

export type EntityGroup = { key: string; name: string; roleWord: boolean; occurrences: NameOccurrence[]; candidates: PersonCandidate[]; status: "matched" | "ambiguous" | "unmatched" };

/** Groups occurrences by name and ranks people-directory candidates (office holders for role words). */
export function entityGroups(occurrences: NameOccurrence[], directory: DirectoryPerson[], options: { date?: string; terms?: OfficeTerm[]; contextNames?: string[] } = {}): EntityGroup[] {
  const groups = new Map<string, EntityGroup>();
  for (const occurrence of occurrences) {
    const key = occurrence.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) continue;
    const group = groups.get(key) ?? { key, name: occurrence.name.trim(), roleWord: occurrence.roleWord, occurrences: [], candidates: [], status: "unmatched" as const };
    group.occurrences.push(occurrence);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (!group.roleWord && !looksLikePersonName(group.name) && !/^[A-Z]{2,3}$/.test(group.name) && group.name.split(/\s+/).length > 4) continue;
    const resolution = resolvePerson(group.name, directory, options);
    group.candidates = resolution.candidates.slice(0, 5);
    group.status = resolution.status;
  }
  return [...groups.values()].sort((a, b) => b.occurrences.length - a.occurrences.length || a.name.localeCompare(b.name));
}

/** The edited value that links a name occurrence to a directory person. */
export function linkedValue(occurrence: NameOccurrence, field: FieldValue<any> | undefined, person: { fullName: string; id: string }): unknown {
  if (occurrence.kind === "person") return { ...(field?.value ?? { nameAsWritten: occurrence.name }), resolvedName: person.fullName, personKey: `directory:${person.id}` };
  return person.fullName;
}

// ------------------------------------------------------------ native targets

export type NativeTarget = { table: "meetings" | "minutes" | "motions" | "agendaItems"; field: string; item?: { group: "attendance" | "motions" | "actionItems" | "sections" | "decisions"; index: number } };

const MEETING_FIELDS: Record<string, string> = { title: "title", date: "scheduledAt", startTime: "localStartText", endTime: "localEndText", location: "location", electronic: "electronic", body: "type", bodyLabel: "type", meetingType: "type" };
const MINUTES_FIELDS: Record<string, string> = { chair: "chairName", recorder: "recorderName", calledToOrderAt: "calledToOrderAt", adjournedAt: "adjournedAt", nextMeeting: "nextMeetingAt", recordStatus: "importedSourceVersions", "quorum.stated": "quorumStatus", "quorum.count": "quorumStatus", organizationName: "sourceExternalIds" };
const ATTENDANCE_FIELDS: Record<string, string> = { nameAsWritten: "name", category: "status", role: "roleTitle", affiliation: "affiliation", proxyFor: "proxyFor", arrivalOrLeave: "notes" };
const MOTION_FIELDS: Record<string, string> = { text: "text", movedBy: "movedBy", secondedBy: "secondedBy", outcome: "outcome", votes: "votesFor", byConsensus: "decidedBy", resolutionType: "resolutionTypeLabel", adoptsMinutesOf: "adoptsMinutesId", adoptsPolicy: "sourceLocator", adoptsAgenda: "sourceLocator", ratifies: "sourceLocator", conditional: "sourceLocator", sectionRef: "sourceLocator" };
const ACTION_FIELDS: Record<string, string> = { text: "text", assigneeAsWritten: "assignee", due: "dueDate", statusAsWritten: "sourceStatus", carriedFromRef: "notes", sectionRef: "notes" };
const SECTION_FIELDS: Record<string, string> = { title: "title", presenter: "presenter", reportRefs: "reportRefs" };

/** Where a reviewed field lands natively (for fieldProvenance). Item indices are original extraction indices. */
export function nativeTargetForPath(path: string): NativeTarget | null {
  const match = /^(attendance|motions|actionItems|sections|decisions)\[(\d+)\](?:\.([a-zA-Z]+))?/.exec(path);
  if (match) {
    const [, group, index, leaf] = match;
    const item = { group: group as NonNullable<NativeTarget["item"]>["group"], index: Number(index) };
    if (group === "motions") return { table: "motions", field: MOTION_FIELDS[leaf ?? "text"] ?? leaf ?? "text", item };
    if (group === "attendance") return { table: "minutes", field: `detailedAttendance.${ATTENDANCE_FIELDS[leaf ?? "nameAsWritten"] ?? leaf}`, item };
    if (group === "actionItems") return { table: "minutes", field: `actionItems.${ACTION_FIELDS[leaf ?? "text"] ?? leaf}`, item };
    if (group === "sections" && leaf === "number") return { table: "agendaItems", field: "itemNumber", item };
    if (group === "sections") return { table: "minutes", field: `sections.${SECTION_FIELDS[leaf ?? "title"] ?? leaf}`, item };
    return { table: "minutes", field: "decisions", item };
  }
  const pattern = patternOf(path);
  if (MEETING_FIELDS[pattern]) return { table: "meetings", field: MEETING_FIELDS[pattern] };
  if (MINUTES_FIELDS[pattern]) return { table: "minutes", field: MINUTES_FIELDS[pattern] };
  if (pattern.startsWith("attachmentsReferenced") || pattern.startsWith("sessionSegments")) return { table: "minutes", field: pattern.startsWith("session") ? "sessionSegments" : "appendices" };
  return null;
}

/** First locator of a field, or a filename locator when the value has none (e.g. a reviewer-typed value). */
export function primaryLocator(field: FieldValue<unknown> | undefined, fileKey: string): Locator {
  const locator = field?.locators?.[0];
  if (locator) return { ...locator, fileId: locator.fileId ?? fileKey };
  return { kind: "filename", fileId: fileKey };
}

/** Values the review form edits: what an "edit" stores for each editor kind. */
export function emptyValueFor(kind: FieldKind): unknown {
  switch (kind) {
    case "boolean": return false;
    case "number": return 0;
    case "person": return { nameAsWritten: "" };
    case "date": return { iso: "", precision: "day" };
    case "votes": return {};
    case "nextMeeting": return { text: "" };
    case "adoptsMinutes": return { text: "" };
    default: return "";
  }
}

/** Validates an edited value for its kind; returns an error message or null. */
export function validateEditedValue(kind: FieldKind, value: unknown): string | null {
  if (value === undefined) return "Enter a value.";
  if (kind === "date") {
    const iso = String((value as any)?.iso ?? "");
    if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(iso)) return "Use YYYY, YYYY-MM or YYYY-MM-DD.";
    const [y, m, d] = iso.split("-").map(Number);
    if (m !== undefined && (m < 1 || m > 12)) return "Month must be 01–12.";
    if (d !== undefined && (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate())) return "That day does not exist.";
    return null;
  }
  if (kind === "time") return /^\d{2}:\d{2}$/.test(String(value)) && Number(String(value).slice(0, 2)) < 24 && Number(String(value).slice(3)) < 60 ? null : "Use 24-hour HH:MM.";
  if (kind === "number") return typeof value === "number" && Number.isFinite(value) && value >= 0 ? null : "Enter a whole number of 0 or more.";
  if (kind === "person") return String((value as any)?.nameAsWritten ?? "").trim() ? null : "Enter a name.";
  if (kind === "votes") {
    for (const key of ["for", "against", "abstain"]) {
      const count = (value as any)?.[key];
      if (count !== undefined && (!Number.isInteger(count) || count < 0)) return "Vote counts must be whole numbers of 0 or more.";
    }
    return null;
  }
  if (kind === "boolean") return typeof value === "boolean" ? null : "Choose yes or no.";
  if (kind === "nextMeeting" || kind === "adoptsMinutes") return String((value as any)?.text ?? (value as any)?.date ?? "").trim() ? null : "Describe it as written.";
  if (kind === "json") return null;
  return String(value).trim() ? null : "Enter a value.";
}

/** Precision of an ISO date string as typed by a reviewer. */
export function datePrecisionOf(iso: string): "day" | "month" | "year" | "unknown" {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "day";
  if (/^\d{4}-\d{2}$/.test(iso)) return "month";
  if (/^\d{4}$/.test(iso)) return "year";
  return "unknown";
}
