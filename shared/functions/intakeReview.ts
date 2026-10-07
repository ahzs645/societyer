/** Portable review and promotion functions for intake runs (design §4.4,
 * stage 10–11). Registered under the `intake:` domain, so the action policy
 * gates them on settings (read for queries, write for mutations); handlers add
 * the native-record permissions they need (meetings/minutes/motions/documents
 * write to promote, documents write to record a gap).
 *
 * - `reviewFields` / `undoReviews`: batched field decisions (bulk accept,
 *   "apply to all occurrences") with an undo window. "Can't represent"
 *   records a representationGaps row at once (linked to the native record on
 *   promotion).
 * - `mergeCandidates`: existing meetings on the extraction's date.
 * - `promoteExtraction`: builds a one-meeting bundle from accepted fields,
 *   stages and applies it through the import-session handlers in the same
 *   transaction, links the source documents and writes one fieldProvenance
 *   row per promoted field.
 * - `reconcileRun`: reconciliation, record gaps and coverage for runs whose
 *   fields were extracted server-side (intakeActions:extractRun). */
import { nameDateSignature } from "../intake/cluster";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId } from "./access";
import { requirePermissionPortable } from "./permissions";
import { resolveFieldPath } from "./intake";
import { hydrateProvenance, provenanceRow, slimProvenance } from "../intake/provenance";
import { insertRepresentationGapFromImport } from "./representationGaps";
import {
  applyApprovedDocumentsPortable,
  applyApprovedMeetingsPortable,
  applyApprovedSectionRecordsPortable,
  bulkSetStatusPortable,
  createFromBundlePortable,
  getPortable as getImportSessionPortable,
  updateRecordPortable,
} from "./importSessions";
import { bodyKeyForMeeting } from "../meetingBody";
import { buildPromotionBundle, defaultInfoTypeForPath, gapLocatorFrom, matchKey, type MergeTarget, type PromotionFile, type PromotionMode } from "../intake/promotion";
import { buildClassPromotionBundle, CLASS_PROMOTION, classProvenanceTargets, directorMatchKey, RECORD_KIND_TABLE, versionPolicyRows } from "../intake/promotionClasses";
import { annotateFiscalYearEndChanges, deriveEmbeddedMinutes, linkPolicyAdoptions } from "../intake/classStages";
import { bodyKeyFor } from "../intake/entities";
import { normalizePersonKey } from "../intake/names";
import { BATCH_FIELD_PATH, encodeFieldPaths, isBatchableAccept, planReviewCompaction } from "../intake/review";
import { bulkAcceptCandidates, entityGroups, formatFieldValue, isPromotedDecision, samplePreview, latestDecisions, linkedValue, nameOccurrences, nativeTargetForPath, primaryLocator, requiredFieldsFor, reviewFieldsForRecord, REVIEW_DECISIONS, type ReviewRow } from "../intake/review";
import { visibleDirectoryRows } from "./peopleDirectory";
import type { DirectoryPerson, OfficeTerm } from "../intake/entities";
import { reconcileExtractions } from "../intake/reconcile";
import { reviewStatusAfterTransposition } from "../documentReviewStatus";
import { buildImportBundle, coverageReport, type IntakeRunResult } from "../intake/bundle";
import { meetingCalendarDate } from "../meetingDates";

const now = () => new Date().toISOString();
const clean = (value: unknown, max = 2000) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const compact = <T extends Record<string, unknown>>(row: T): T => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;

async function canRead(ctx: PortableQueryCtx, societyId: string) {
  await requirePermissionPortable(ctx, societyId, "settings:read");
}
async function canWrite(ctx: PortableQueryCtx, societyId: string) {
  await requirePermissionPortable(ctx, societyId, "settings:write");
}
async function allowed(ctx: PortableQueryCtx, societyId: string, permission: Parameters<typeof requirePermissionPortable>[2]) {
  try {
    await requirePermissionPortable(ctx, societyId, permission);
    return true;
  } catch {
    return false;
  }
}
async function reviewsFor(ctx: PortableQueryCtx, extractionId: string): Promise<ReviewRow[]> {
  return (await ctx.db.query("intakeFieldReviews").withIndex("by_extraction", (q) => q.eq("extractionId", extractionId)).collect()) as any;
}

// ---------------------------------------------------------------- reviews

type ReviewItem = { extractionId: string; fieldPath: string; decision: string; editedValue?: unknown; note?: string; gap?: { infoType?: string; reason?: string; description?: string; suggestedTarget?: string } };

/** Batched field decisions (one transaction). Returns the new review ids (for undo). */
export async function reviewFields(ctx: PortableMutationCtx, { societyId, items }: { societyId: string; items: ReviewItem[] }) {
  await canWrite(ctx, societyId);
  if (!Array.isArray(items) || !items.length) return { reviewIds: [], gapIds: [] };
  if (items.length > 1000) throw new Error("Review at most 1,000 fields per call.");
  return writeReviews(ctx, societyId, items);
}

/** Writes review decisions (callers have checked settings:write and bounded the batch). */
async function writeReviews(ctx: PortableMutationCtx, societyId: string, items: ReviewItem[]): Promise<{ reviewIds: string[]; gapIds: string[] }> {
  if (!items.length) return { reviewIds: [], gapIds: [] };
  if (items.some((item) => item.decision === "cant_represent")) await requirePermissionPortable(ctx, societyId, "documents:write");
  const reviewerUserId = await principalUserId(ctx, societyId).catch(() => undefined);
  const extractions = new Map<string, any>();
  const reviewIds: string[] = [];
  const gapIds: string[] = [];
  const at = now();
  // Plain accepts of several fields of one document with the same note (bulk accept, "accept as written
  // everywhere") are one decision: one batch row lists the fields instead of one row per field, and does
  // not copy values or locators the extraction already holds. Per-field decisions are unchanged.
  const batchKey = (item: ReviewItem) => `${item.extractionId}\u0000${clean(item.note) ?? ""}`;
  const batchable = new Map<string, ReviewItem[]>();
  for (const item of items) if (isBatchableAccept(item)) batchable.set(batchKey(item), [...(batchable.get(batchKey(item)) ?? []), item]);
  for (const [key, group] of batchable) if (group.length < 2) batchable.delete(key);
  const batched = new Set<string>();
  for (const item of items) {
    if (batchable.has(batchKey(item)) && isBatchableAccept(item)) {
      const key = batchKey(item);
      if (batched.has(key)) continue;
      batched.add(key);
      const group = batchable.get(key)!;
      let extraction = extractions.get(item.extractionId);
      if (!extraction) {
        extraction = await getOwned<any>(ctx, "intakeExtractions", item.extractionId, societyId);
        if (extraction.status === "promoted") throw new Error("Promoted extractions are final; review the native record instead.");
        extractions.set(item.extractionId, extraction);
      }
      for (const member of group) resolveFieldPath(extraction.record, member.fieldPath);
      reviewIds.push(await ctx.db.insert("intakeFieldReviews", compact({
        societyId, runId: extraction.runId, extractionId: extraction._id, fieldPath: BATCH_FIELD_PATH, fieldPaths: encodeFieldPaths(group.map((member) => member.fieldPath)),
        decision: "accept", note: clean(item.note), reviewerUserId, reviewedAtISO: at,
      })));
      continue;
    }
    if (!REVIEW_DECISIONS.includes(item.decision as any)) throw new Error("Decision must be accept, edit, reject or cant_represent.");
    let extraction = extractions.get(item.extractionId);
    if (!extraction) {
      extraction = await getOwned<any>(ctx, "intakeExtractions", item.extractionId, societyId);
      if (extraction.status === "promoted") throw new Error("Promoted extractions are final; review the native record instead.");
      extractions.set(item.extractionId, extraction);
    }
    const field = resolveFieldPath(extraction.record, item.fieldPath);
    if (item.decision === "edit" && item.editedValue === undefined) throw new Error("An edit needs the corrected value.");
    let gap: Record<string, unknown> | undefined;
    if (item.decision === "cant_represent") {
      const description = clean(item.gap?.description, 1000);
      if (!description) throw new Error("Describe what the app cannot represent.");
      const file = await ctx.db.get<any>(extraction.fileId, "intakeFiles");
      const locator = field.locators?.[0];
      const [proposedTargetTable, ...proposedField] = String(item.gap?.suggestedTarget ?? "").split(".");
      const gapId = await insertRepresentationGapFromImport(ctx, societyId, {
        infoType: clean(item.gap?.infoType, 120) ?? defaultInfoTypeForPath(item.fieldPath),
        reason: clean(item.gap?.reason, 40) ?? "no_schema_field",
        origin: "intake_review",
        title: description.slice(0, 240),
        sourceExternalId: extraction.fileKey,
        sourceTitle: file?.name,
        locator: gapLocatorFrom(locator, file?.sha256, file?.path),
        excerpt: locator?.quote ?? formatFieldValue(field.value),
        observedDate: extraction.record?.date?.value?.iso,
        bodyKey: extraction.record?.body?.value,
        proposedTargetTable: clean(proposedTargetTable, 80),
        proposedField: clean(proposedField.join("."), 120),
        proposedValue: field.value,
        dedupeKey: `intake:${extraction._id}:${item.fieldPath}`,
        sensitivity: file?.sensitivity === "restricted" ? "restricted" : undefined,
        notes: description,
      }, {});
      gapIds.push(String(gapId));
      gap = { ...item.gap, description, gapId, sourceExternalId: extraction.fileKey };
    }
    reviewIds.push(await ctx.db.insert("intakeFieldReviews", compact({
      societyId, runId: extraction.runId, extractionId: extraction._id, fieldPath: item.fieldPath, decision: item.decision,
      originalValue: field.value, editedValue: item.decision === "edit" ? item.editedValue : undefined,
      locators: (field.locators ?? []).slice(0, 20).map((locator: any) => compact({ fileId: clean(locator.fileId, 600), kind: ["block", "page_text", "cell", "email_header", "filename", "path"].includes(locator.kind) ? locator.kind : "block", blockIndex: typeof locator.blockIndex === "number" ? locator.blockIndex : undefined, page: typeof locator.page === "number" ? locator.page : undefined, sheet: clean(locator.sheet, 200), cell: clean(locator.cell, 40), charStart: typeof locator.charStart === "number" ? locator.charStart : undefined, charEnd: typeof locator.charEnd === "number" ? locator.charEnd : undefined, quote: clean(locator.quote, 400) })),
      note: clean(item.note), gap, reviewerUserId, reviewedAtISO: at,
    })));
  }
  for (const extraction of extractions.values()) if (extraction.status === "pending_review") await ctx.db.patch(extraction._id, { status: "in_review", updatedAtISO: at });
  return { reviewIds, gapIds };
}

/** Undo (delete) reviews, e.g. within the bulk-accept undo window. Gaps those reviews created are removed while still open and unlinked. */
export async function undoReviews(ctx: PortableMutationCtx, { societyId, reviewIds }: { societyId: string; reviewIds: string[] }) {
  await canWrite(ctx, societyId);
  if (!Array.isArray(reviewIds) || reviewIds.length > 1000) throw new Error("Undo at most 1,000 reviews per call.");
  let removed = 0;
  for (const id of reviewIds) {
    const review = await ctx.db.get<any>(id, "intakeFieldReviews");
    if (!review || review.societyId !== societyId) continue;
    const extraction = await ctx.db.get<any>(review.extractionId, "intakeExtractions");
    if (extraction?.status === "promoted") throw new Error("This extraction was promoted; its reviews can no longer be undone.");
    const gapId = review.gap?.gapId;
    if (gapId) {
      const gap = await ctx.db.get<any>(String(gapId), "representationGaps");
      if (gap && gap.societyId === societyId && gap.status === "open" && !gap.affectedId) await ctx.db.delete(gap._id);
    }
    await ctx.db.delete(id);
    removed++;
  }
  return { removed };
}

// ---------------------------------------------------------------- run-wide bulk accept

export type BulkScopeArgs = { extractionId?: string; clusterKey?: string; body?: string; year?: string; docClass?: string; /** Every open document of the run. */ all?: boolean };

/** Unpromoted extractions of a run within a scope: one document, a version cluster, a body-year or a class. */
async function scopedExtractions(ctx: PortableQueryCtx, societyId: string, runId: string, scope: BulkScopeArgs) {
  await getOwned(ctx, "intakeRuns", runId, societyId);
  if (!scope || !Object.values(scope).some(Boolean)) throw new Error("Choose a document, cluster, body and year, class, or the whole run.");
  const rows = (await ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[];
  const files = scope.clusterKey ? ((await ctx.db.query("intakeFiles").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[]) : [];
  const inCluster = new Set(files.filter((file) => file.clusterKey === scope.clusterKey).map((file) => String(file._id)));
  return rows.filter((row) => {
    if (row.status === "promoted" || row.status === "rejected" || row.status === "covered") return false;
    if (scope.extractionId && String(row._id) !== scope.extractionId) return false;
    if (scope.clusterKey && !inCluster.has(String(row.fileId))) return false;
    if (scope.docClass && row.docClass !== scope.docClass) return false;
    if (scope.body && String(row.record?.body?.value ?? "") !== scope.body) return false;
    if (scope.year && !String(row.record?.date?.value?.iso ?? "").startsWith(scope.year)) return false;
    return true;
  });
}

async function bulkCandidatesFor(ctx: PortableQueryCtx, extractions: any[], thresholds?: Record<string, number>) {
  const out: Array<{ extraction: any; field: ReturnType<typeof reviewFieldsForRecord>[number] }> = [];
  for (const extraction of extractions) {
    const decisions = latestDecisions(await reviewsFor(ctx, extraction._id));
    for (const field of bulkAcceptCandidates(reviewFieldsForRecord(extraction.record ?? {}, extraction.docClass), decisions, extraction.docClass, {}, thresholds)) out.push({ extraction, field });
  }
  return out;
}

/** Bulk-accept preview for a run scope: how many fields qualify and a sample of five with their quotes. */
export async function bulkAcceptPreview(ctx: PortableQueryCtx, { societyId, runId, scope }: { societyId: string; runId: string; scope: BulkScopeArgs }) {
  await canRead(ctx, societyId);
  await requirePermissionPortable(ctx, societyId, "documents:read");
  const extractions = await scopedExtractions(ctx, societyId, runId, scope);
  const candidates = await bulkCandidatesFor(ctx, extractions);
  const restricted = new Set<string>();
  for (const extraction of extractions) {
    const file = await ctx.db.get<any>(extraction.fileId, "intakeFiles");
    if (file?.sensitivity === "restricted") restricted.add(String(extraction._id));
  }
  const sample = samplePreview(candidates, 5).map(({ extraction, field }) => ({
    extractionId: extraction._id, fileKey: extraction.fileKey, path: field.path, label: field.label, kind: field.kind, confidence: field.field.confidence,
    value: restricted.has(String(extraction._id)) ? undefined : field.field.value, quote: restricted.has(String(extraction._id)) ? undefined : field.field.locators?.[0]?.quote,
  }));
  return { count: candidates.length, extractions: new Set(candidates.map(({ extraction }) => String(extraction._id))).size, scopeExtractions: extractions.length, sample };
}

export const BULK_ACCEPT_BATCH_FIELDS = 5000;

/** Whole documents, in order, until adding the next would pass `limit` fields (at least one document). */
export function takeBulkBatch(extractionIdPerField: string[], limit: number): Set<string> {
  const perExtraction = new Map<string, number>();
  for (const id of extractionIdPerField) perExtraction.set(id, (perExtraction.get(id) ?? 0) + 1);
  const taken = new Set<string>();
  let size = 0;
  for (const [id, count] of perExtraction) {
    if (taken.size && size + count > limit) break;
    taken.add(id);
    size += count;
  }
  return taken;
}

/** Accept every qualifying field in the scope; returns review ids for the undo window.
 * One transaction holds at most ~5,000 fields: whole documents are taken in queue order
 * until the batch is full and `remainingFields` reports what is left, so a client can
 * repeat the call for a class across a large run. */
export async function bulkAccept(ctx: PortableMutationCtx, { societyId, runId, scope }: { societyId: string; runId: string; scope: BulkScopeArgs }) {
  await canWrite(ctx, societyId);
  const extractions = await scopedExtractions(ctx, societyId, runId, scope);
  const all = await bulkCandidatesFor(ctx, extractions);
  const taken = takeBulkBatch(all.map(({ extraction }) => String(extraction._id)), BULK_ACCEPT_BATCH_FIELDS);
  const candidates = all.filter(({ extraction }) => taken.has(String(extraction._id)));
  const items: ReviewItem[] = candidates.map(({ extraction, field }) => ({ extractionId: extraction._id, fieldPath: field.path, decision: "accept", note: "Bulk accepted (stated, span-verified, at or above the threshold)." }));
  // One batch review row per document (not one row per field).
  const { reviewIds } = await writeReviews(ctx, societyId, items);
  return { reviewIds, fields: items.length, extractions: new Set(items.map((item) => item.extractionId)).size, remainingFields: all.length - candidates.length };
}

// ---------------------------------------------------------------- merge candidates

function reviewedDate(extraction: any, decisions: Map<string, ReviewRow>): string | undefined {
  const review = decisions.get("date");
  const value = review?.decision === "edit" ? (review.editedValue as any) : extraction.record?.date?.value;
  const iso = String(value?.iso ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : undefined;
}

/** Existing meetings on the extraction's date (same body first) that promotion could merge into. */
export async function mergeCandidates(ctx: PortableQueryCtx, { societyId, extractionId }: { societyId: string; extractionId: string }) {
  await canRead(ctx, societyId);
  const extraction = await getOwned<any>(ctx, "intakeExtractions", extractionId, societyId);
  if (!(await allowed(ctx, societyId, "meetings:read"))) return { date: undefined, candidates: [] };
  const decisions = latestDecisions(await reviewsFor(ctx, extractionId));
  const date = reviewedDate(extraction, decisions);
  if (!date) return { date: undefined, candidates: [] };
  const bodyReview = decisions.get("body");
  const body = String(bodyReview?.decision === "edit" ? bodyReview.editedValue : extraction.record?.body?.value ?? "board");
  const wantedKey = body === "board" ? "board" : body === "agm" || body === "members" ? "agm" : body === "sgm" ? "sgm" : "committee";
  const meetings = (await ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as any[];
  const sameDay = meetings.filter((meeting) => (meetingCalendarDate(meeting) ?? "") === date);
  const candidates: any[] = [];
  for (const meeting of sameDay) {
    const committee = meeting.committeeId ? await ctx.db.get<any>(meeting.committeeId, "committees") : null;
    const bodyKey = bodyKeyForMeeting(meeting, committee);
    const minutes = meeting.minutesId ? await ctx.db.get<any>(meeting.minutesId, "minutes") : null;
    candidates.push({
      meetingId: meeting._id, title: meeting.title, type: meeting.type, status: meeting.status, scheduledAt: meeting.scheduledAt, committeeName: committee?.name,
      bodyKey, sameBody: bodyKey === wantedKey || bodyKey.startsWith(`${wantedKey}:`), hasMinutes: Boolean(minutes), minutesApproved: Boolean(minutes?.approvedAt || minutes?.adoptedSnapshot),
      motionCount: Array.isArray(minutes?.motionIds) ? minutes.motionIds.length : 0, sourceExternalIds: Array.isArray(minutes?.sourceExternalIds) ? minutes.sourceExternalIds.slice(0, 5) : [],
      alreadyHasThisSource: Array.isArray(minutes?.sourceExternalIds) && minutes.sourceExternalIds.includes(extraction.fileKey),
    });
  }
  return { date, candidates: candidates.sort((a, b) => Number(b.sameBody) - Number(a.sameBody)) };
}

// ---------------------------------------------------------------- promotion

async function clusterFiles(ctx: PortableQueryCtx, extraction: any, file: any): Promise<any[]> {
  const files = [file];
  // Embedded minutes: the package is their only source; its cluster holds copies of the package, not of the minutes.
  if (extraction.parentFileKey || !file.clusterKey) return files;
  const clusters = (await ctx.db.query("intakeClusters").withIndex("by_run", (q) => q.eq("runId", extraction.runId)).collect()) as any[];
  const cluster = clusters.find((candidate) => candidate.clusterKey === file.clusterKey);
  for (const member of cluster?.members ?? []) {
    if (member.fileKey === file.fileKey || !member.fileId) continue;
    // A package that embeds these minutes is its own document (a meeting material), not a copy of the record.
    if (member.relation === "package-embedded") continue;
    // Only exact and format copies are the same record; drafts and other versions are sources of the same meeting too.
    const memberFile = await ctx.db.get<any>(member.fileId, "intakeFiles");
    if (!memberFile || memberFile.societyId !== file.societyId) continue;
    // Never cite another meeting's file: names dated differently are different records.
    const own = nameDateSignature(file.name ?? ""), theirs = nameDateSignature(memberFile.name ?? "");
    if (own && theirs && own !== theirs) continue;
    files.push(memberFile);
  }
  return files;
}

async function promotionFile(ctx: PortableQueryCtx, file: any): Promise<PromotionFile> {
  const extract = file.sensitivity === "restricted" ? null : await ctx.db.query("intakeExtracts").withIndex("by_file", (q) => q.eq("fileId", file._id)).first() as any;
  return compact({
    fileKey: file.fileKey, name: file.name, path: file.path, sha256: file.sha256, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sensitivity: file.sensitivity,
    docClass: file.docClass, driveId: file.driveId, url: file.url, recordStatus: file.classification?.recordStatus, text: extract?.text, extractionMethod: extract?.method,
  }) as PromotionFile;
}

async function mergeTargetFor(ctx: PortableMutationCtx, societyId: string, meetingId: string, fileKey: string): Promise<MergeTarget> {
  const meeting = await getOwned<any>(ctx, "meetings", meetingId, societyId);
  let minutes = meeting.minutesId ? await ctx.db.get<any>(meeting.minutesId, "minutes") : null;
  if (minutes && (minutes.approvedAt || minutes.adoptedSnapshot || Array.isArray(minutes.motionSnapshots))) throw new Error("That meeting's minutes are approved; imported content cannot be merged into adopted minutes.");
  if (!minutes) {
    // A meeting without minutes (e.g. "Held — minutes missing") gets an empty draft minutes record to merge into.
    const minutesId = await ctx.db.insert("minutes", { societyId, meetingId: meeting._id, heldAt: meeting.scheduledAt, attendees: [], absent: [], quorumMet: false, quorumStatus: "not_recorded", discussion: "", decisions: [], actionItems: [], sourceExternalIds: [fileKey], sourceReviewStatus: "imported_needs_review" });
    await ctx.db.patch(meeting._id, { minutesId });
    minutes = await ctx.db.get<any>(minutesId, "minutes");
  } else if (!(minutes.sourceExternalIds ?? []).includes(fileKey)) {
    // Identity resolution prefers the same-day candidate already carrying the source file.
    await ctx.db.patch(minutes._id, { sourceExternalIds: [...(minutes.sourceExternalIds ?? []), fileKey] });
  }
  const committee = meeting.committeeId ? await ctx.db.get<any>(meeting.committeeId, "committees") : null;
  return { dateKey: meetingCalendarDate(meeting) ?? String(meeting.scheduledAt).slice(0, 10), meetingType: String(meeting.type ?? "Board"), ...(committee?.name ? { committeeName: committee.name } : {}) };
}

type Provenance = { targetTable: string; targetId: string; fieldPath: string; sourceFieldPath?: string; locator: any; value: unknown; decision: string };

/** Promote a reviewed extraction into native records (see module comment). */
export async function promoteExtraction(ctx: PortableMutationCtx, args: { societyId: string; extractionId: string; mode?: string; targetMeetingId?: string }) {
  const { societyId } = args;
  await canWrite(ctx, societyId);
  for (const permission of ["meetings:write", "minutes:write", "motions:write", "documents:write"] as const) await requirePermissionPortable(ctx, societyId, permission);
  const extraction = await getOwned<any>(ctx, "intakeExtractions", args.extractionId, societyId);
  if (extraction.status === "promoted") throw new Error("This extraction was already promoted.");
  if (extraction.status === "rejected") throw new Error("This extraction was rejected; reopen it before promoting.");
  if (extraction.status === "covered") throw new Error("A copy of this document was already promoted; choose \"Review separately\" to promote it on its own.");
  // Nothing reviewed yet (the first decision moves it to in_review): refuse before reading anything else,
  // so "Promote all ready" passes over unreviewed documents of a large run quickly.
  if (extraction.status === "pending_review") throw new Error(extraction.docClass === "meetingMinutes" ? "Accept or edit the meeting date and body before promoting." : "Accept or edit at least one field before promoting.");
  const run = await getOwned<any>(ctx, "intakeRuns", extraction.runId, societyId);
  const file = await getOwned<any>(ctx, "intakeFiles", extraction.fileId, societyId);
  if (file.sensitivity === "restricted") await requirePermissionPortable(ctx, societyId, "settings:write");
  if (extraction.docClass !== "meetingMinutes") return promoteClassExtraction(ctx, societyId, extraction, run, file);
  const reviews = await reviewsFor(ctx, extraction._id);
  const decisions = latestDecisions(reviews);
  const fields = reviewFieldsForRecord(extraction.record, extraction.docClass);
  for (const field of fields.filter((candidate) => candidate.required)) {
    if (!isPromotedDecision(decisions.get(field.path)?.decision)) throw new Error(`Accept or edit the ${field.label.toLowerCase()} before promoting.`);
  }
  const mode: PromotionMode = args.mode === "new" || args.mode === "merge" ? args.mode : "auto";
  if (mode === "merge" && !args.targetMeetingId) throw new Error("Choose the meeting to merge into.");
  const mergeTarget = mode === "merge" ? await mergeTargetFor(ctx, societyId, args.targetMeetingId!, extraction.fileKey) : undefined;
  const files = await Promise.all((await clusterFiles(ctx, extraction, file)).map((row) => promotionFile(ctx, row)));
  const build = buildPromotionBundle({ extraction, reviews, files, runName: run.name, mode, mergeTarget });

  // Stage and apply through the import-session handlers (same transaction).
  const sessionId = String(await createFromBundlePortable(ctx, { societyId, name: `Intake: ${file.name}`, bundle: build.bundle }));
  await bulkSetStatusPortable(ctx, { sessionId, status: "Approved" });
  await applyApprovedDocumentsPortable(ctx, { sessionId });
  const applied = await applyApprovedMeetingsPortable(ctx, { sessionId }) as any;
  const session = await getImportSessionPortable(ctx, { sessionId }) as any;
  const minutesRecord = session?.records?.find((record: any) => record.recordKind === "meetingMinutes");
  const target = minutesRecord?.importedTargets?.meetings;
  if (!target?.meetingId || !target?.minutesId) throw new Error("The meeting could not be written; nothing was promoted.");
  const meetingId = String(target.meetingId);
  const minutesId = String(target.minutesId);
  if (mode === "merge" && meetingId !== String(args.targetMeetingId)) throw new Error("The import matched a different meeting than the one chosen; nothing was promoted.");

  // Source documents: link intake files to the documents the import created or reused.
  const sourceDocuments: Array<{ fileKey: string; documentId: string; name: string; sha256?: string; mimeType?: string; sizeBytes?: number }> = [];
  for (const record of session.records.filter((row: any) => row.recordKind === "documentCandidate")) {
    const documentId = record.importedTargets?.documents;
    const fileKey = record.payload?.externalId;
    if (!documentId || !fileKey) continue;
    const intakeFile = files.find((candidate) => candidate.fileKey === fileKey);
    sourceDocuments.push(compact({ fileKey, documentId: String(documentId), name: intakeFile?.name ?? fileKey, sha256: intakeFile?.sha256, mimeType: intakeFile?.mimeType, sizeBytes: intakeFile?.sizeBytes }) as any);
    const row = await ctx.db.query("intakeFiles").withIndex("by_run_file_key", (q) => q.eq("runId", extraction.runId).eq("fileKey", fileKey)).first() as any;
    if (row && !row.documentId) await ctx.db.patch(row._id, { documentId, updatedAtISO: now() });
    await markSourceDocumentTransposed(ctx, documentId);
  }

  // Merging only fills blank minutes fields and keeps action items as observations;
  // minutes that had none take the reviewed action items too.
  const mergedMinutes = await ctx.db.get<any>(minutesId, "minutes");
  if (mergedMinutes && !(mergedMinutes.actionItems ?? []).length && Array.isArray(build.payload.actionItems) && build.payload.actionItems.length) {
    await ctx.db.patch(minutesId, { actionItems: build.payload.actionItems.map((item: any) => compact({ text: String(item.text), assignee: clean(item.assignee, 200), dueDate: clean(item.dueDate, 40), done: false, status: "unknown" })) });
  }

  // Field provenance: one row per promoted field that landed natively. A merge fills
  // only blank fields, so a value the existing record already held differently is not attributed.
  const merged = Number(applied?.existing ?? 0) > 0;
  const meeting = await ctx.db.get<any>(meetingId, "meetings");
  const minutes = await ctx.db.get<any>(minutesId, "minutes");
  const motions = (await Promise.all(((minutes?.motionIds ?? []) as string[]).map((id) => ctx.db.get<any>(id, "motions")))).filter(Boolean) as any[];
  const agenda = await ctx.db.query("agendas").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).first() as any;
  const agendaItems = agenda ? ((await ctx.db.query("agendaItems").withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id)).collect()) as any[]) : [];
  const findIndex = (rows: any[] | undefined, key: string, wanted: unknown) => (rows ?? []).findIndex((row) => matchKey(row?.[key]) === matchKey(wanted) || (matchKey(wanted).length > 12 && matchKey(row?.[key]).includes(matchKey(wanted))));
  const provenance: Provenance[] = [];
  const notLandedPaths: string[] = [];
  const record = extraction.record as any;
  for (const path of build.applied.promotedPaths) {
    const nativeTarget = nativeTargetForPath(path);
    const review = decisions.get(path)!;
    const field = resolveFieldPath(record, path);
    const value = review.decision === "edit" ? review.editedValue : field.value;
    const locator = primaryLocator(field, extraction.fileKey);
    if (!nativeTarget) {
      notLandedPaths.push(path);
      continue;
    }
    const item = nativeTarget.item;
    if (nativeTarget.table === "meetings") {
      if (landedValue(nativeTarget.field, nativeTarget.field === "scheduledAt" ? meetingCalendarDate(meeting as any) : (meeting as any)?.[nativeTarget.field], value, merged)) provenance.push({ targetTable: "meetings", targetId: meetingId, fieldPath: nativeTarget.field, locator, value, decision: review.decision, sourceFieldPath: path });
      else notLandedPaths.push(path);
    } else if (nativeTarget.table === "agendaItems" && item) {
      const titleReview = decisions.get(`sections[${item.index}].title`);
      const title = titleReview?.decision === "edit" ? titleReview.editedValue : record.sections?.[item.index]?.title?.value;
      const agendaItem = agendaItems.find((row) => matchKey(row.title) === matchKey(title));
      if (agendaItem) provenance.push({ targetTable: "agendaItems", targetId: String(agendaItem._id), fieldPath: nativeTarget.field, locator, value, decision: review.decision, sourceFieldPath: path });
      else notLandedPaths.push(path);
    } else if (nativeTarget.table === "motions" && item) {
      const reviewedText = decisions.get(`motions[${item.index}].text`)?.decision === "edit" ? decisions.get(`motions[${item.index}].text`)!.editedValue : record.motions?.[item.index]?.text?.value;
      const motion = motions.find((row) => matchKey(row.text) === matchKey(reviewedText)) ?? motions.find((row) => matchKey(row.text).includes(matchKey(reviewedText)) && matchKey(reviewedText).length > 8);
      if (motion) provenance.push({ targetTable: "motions", targetId: String(motion._id), fieldPath: nativeTarget.field, locator, value, decision: review.decision, sourceFieldPath: path });
      else notLandedPaths.push(path);
    } else if (item) {
      const [listField, leaf] = nativeTarget.field.split(".");
      const keyPath = { attendance: "nameAsWritten", actionItems: "text", sections: "title", decisions: "" }[item.group as "attendance"];
      const keyReview = keyPath ? decisions.get(`${item.group}[${item.index}].${keyPath}`) : decisions.get(`${item.group}[${item.index}]`);
      const keyValue = keyReview?.decision === "edit" ? keyReview.editedValue : keyPath ? record[item.group]?.[item.index]?.[keyPath]?.value : record[item.group]?.[item.index]?.value;
      const rowKey = { detailedAttendance: "name", actionItems: "text", sections: "title" }[listField as "detailedAttendance"];
      const rows = (minutes as any)?.[listField];
      const index = listField === "decisions" ? (rows ?? []).findIndex((row: unknown) => matchKey(row) === matchKey(keyValue)) : findIndex(rows, rowKey, keyValue);
      const observation = index < 0 && listField === "actionItems" ? findIndex((minutes as any)?.actionObservations, "text", keyValue) : -1;
      if (index >= 0) provenance.push({ targetTable: "minutes", targetId: minutesId, fieldPath: `${listField}[${index}]${leaf ? `.${leaf}` : ""}`, locator, value, decision: review.decision, sourceFieldPath: path });
      else if (observation >= 0) provenance.push({ targetTable: "minutes", targetId: minutesId, fieldPath: `actionObservations[${observation}]${leaf ? `.${leaf}` : ""}`, locator, value, decision: review.decision, sourceFieldPath: path });
      else if (item.group === "attendance") provenance.push({ targetTable: "minutes", targetId: minutesId, fieldPath: "draftTranscript.nonPersonAttendance", locator, value, decision: review.decision, sourceFieldPath: path });
      else notLandedPaths.push(path);
    } else {
      if (landedValue(nativeTarget.field, (minutes as any)?.[nativeTarget.field], value, merged)) provenance.push({ targetTable: "minutes", targetId: minutesId, fieldPath: nativeTarget.field, locator, value, decision: review.decision, sourceFieldPath: path });
      else notLandedPaths.push(path);
    }
  }
  const at = now();
  for (const row of provenance) {
    await ctx.db.insert("fieldProvenance", provenanceRow({
      societyId, targetTable: row.targetTable, targetId: row.targetId, fieldPath: row.fieldPath, sourceFieldPath: row.sourceFieldPath, extraction, locator: row.locator, value: row.value, decision: row.decision, at,
    }));
  }

  // System gaps: reviewer "can't represent" gaps and the extractor's unsupported details, linked to the meeting.
  let gaps = 0;
  for (const review of decisions.values()) {
    const gapId = (review as any).gap?.gapId;
    if (review.decision !== "cant_represent" || !gapId) continue;
    const gap = await ctx.db.get<any>(String(gapId), "representationGaps");
    if (gap && gap.societyId === societyId && !gap.affectedId) {
      await ctx.db.patch(gap._id, { affectedTable: "meetings", affectedId: meetingId, updatedAtISO: at });
      gaps++;
    }
  }
  const existingKeys = new Set(((await ctx.db.query("representationGaps").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as any[]).map((row) => row.dedupeKey).filter(Boolean));
  for (const [index, detail] of (extraction.unsupported ?? []).entries()) {
    const dedupeKey = `intake:${extraction._id}:unsupported:${index}`;
    if (existingKeys.has(dedupeKey)) continue;
    const [proposedTargetTable, ...proposedField] = String(detail.suggestedTarget ?? "").split(".");
    await insertRepresentationGapFromImport(ctx, societyId, {
      infoType: detail.infoType ?? "other", reason: { no_field: "no_schema_field", no_table: "no_schema_field", no_relationship: "no_import_key", no_ui_edit: "no_ui_input", lossy_normalization: "import_dropped" }[String(detail.category)] ?? "no_schema_field",
      origin: "intake", title: clean(detail.description, 240), sourceExternalId: extraction.fileKey, sourceTitle: file.name, locator: gapLocatorFrom(detail.locators?.[0], file.sha256, file.path),
      excerpt: detail.locators?.[0]?.quote ?? detail.description, observedDate: record?.date?.value?.iso, bodyKey: record?.body?.value, affectedTable: "meetings", affectedId: meetingId,
      proposedTargetTable: clean(proposedTargetTable, 80), proposedField: clean(proposedField.join("."), 120), dedupeKey, sensitivity: file.sensitivity === "restricted" ? "restricted" : undefined, notes: detail.description,
    }, { importSessionId: sessionId });
    gaps++;
  }

  const targets = [{ table: "meetings", id: meetingId, label: meeting?.title ?? "Meeting" }];
  await ctx.db.patch(extraction._id, { status: "promoted", promotion: { sessionId, targets, atISO: at }, updatedAtISO: at });
  const covered = await markClusterCopiesCovered(ctx, extraction, file, at);
  if (run.status === "extracted" || run.status === "created") await ctx.db.patch(run._id, { status: "reviewing", updatedAtISO: at });
  return {
    meetingId, minutesId, sessionId, merged: Number(applied?.existing ?? 0) > 0, meetingTitle: meeting?.title, targets, covered,
    provenance: provenance.length, notLanded: notLandedPaths.length, notLandedPaths: notLandedPaths.slice(0, 50), gaps, sourceDocuments, warnings: build.warnings,
  };
}

/** Other copies in the promoted file's version cluster (format copies, near duplicates, drafts of
 * the same record) need no separate promotion: their source IDs are already on the record. They
 * become "covered" (reopen one to promote it separately). Returns how many were covered. */
async function markClusterCopiesCovered(ctx: PortableMutationCtx, extraction: any, file: any, at: string): Promise<number> {
  if (!file.clusterKey || extraction.parentFileKey) return 0;
  const files = (await ctx.db.query("intakeFiles").withIndex("by_run", (q) => q.eq("runId", extraction.runId)).collect()) as any[];
  const members = new Set(files.filter((row) => row.clusterKey === file.clusterKey && String(row._id) !== String(file._id)).map((row) => String(row._id)));
  if (!members.size) return 0;
  let covered = 0;
  const dateOf = (row: any) => String(row.record?.date?.value?.iso ?? row.record?.meetingDate?.value?.iso ?? row.record?.periodEnd?.value?.iso ?? "");
  // Only the cluster members' extractions are read (not every extraction of the run).
  const candidates: any[] = [];
  for (const fileId of members) candidates.push(...((await ctx.db.query("intakeExtractions").withIndex("by_file", (q) => q.eq("fileId", fileId)).collect()) as any[]));
  for (const row of candidates) {
    if (row.runId !== extraction.runId || row.parentFileKey || row.docClass !== extraction.docClass || !["pending_review", "in_review", "accepted"].includes(row.status)) continue;
    // A copy states the same date; a cluster member with another date is a different record.
    if (dateOf(row) && dateOf(extraction) && dateOf(row) !== dateOf(extraction)) continue;
    await ctx.db.patch(row._id, { status: "covered", promotion: { coveredByExtractionId: extraction._id, coveredByFileKey: extraction.fileKey, atISO: at }, updatedAtISO: at });
    covered++;
  }
  return covered;
}

const RECORD_KIND_FOR_COLLECTION: Record<string, string> = {
  policies: "policy", bylawRuleSets: "bylawRuleSet", committees: "committee", directors: "director", organizationSeats: "organizationSeat", proxies: "proxy",
  financialStatementImports: "financialStatementImport", budgetSnapshots: "budgetSnapshot", insurancePolicies: "insurancePolicy", grants: "grant", deadlines: "deadline",
  filings: "filing", sourceEvidence: "sourceEvidence", transactionCandidates: "transactionCandidate", meetingMaterials: "meetingMaterial", agreements: "agreement",
};
const TABLE_NOUN: Record<string, string> = {
  policies: "Policy", bylawRuleSets: "Bylaw rule set", committees: "Committee", directors: "Director", organizationSeats: "Seat", proxies: "Proxy", financialStatementImports: "Financial statement",
  budgetSnapshots: "Budget", insurancePolicies: "Insurance policy", grants: "Grant", deadlines: "Deadline", filings: "Filing", sourceEvidence: "Source evidence", transactionCandidates: "Transaction candidate",
  meetingMaterials: "Meeting material", meetingMinutes: "Meeting", agreements: "Agreement",
};
const IDENTIFYING_FIELDS: Record<string, string> = { insurancePolicies: "the insurer or the policy number", directors: "the person's name", policies: "the title", filings: "the filing type and date", financialStatementImports: "the period end", budgetSnapshots: "the title or fiscal year", grants: "the title and funder", transactionCandidates: "the date and amount", meetingMinutes: "the meeting date and body" };

/** The reviewed value of a top-level field (edited or accepted), or undefined. */
function reviewedValue(extraction: any, decisions: Map<string, ReviewRow>, path: string): any {
  const review = decisions.get(path);
  if (!isPromotedDecision(review?.decision)) return undefined;
  return review!.decision === "edit" ? review!.editedValue : extraction.record?.[path]?.value;
}

/** Promotion of a reviewed non-minutes extraction (agendas, policies, bylaws, people, filings,
 * statements, budgets, insurance, grants, agreements, correspondence, invoices): the class's
 * staging (bundleClasses) applied through the import-session handlers, with provenance rows. */
async function promoteClassExtraction(ctx: PortableMutationCtx, societyId: string, extraction: any, run: any, file: any) {
  const docClass = String(extraction.docClass);
  const spec = CLASS_PROMOTION[docClass];
  if (!spec) throw new Error(`There is no native record type for ${docClass} documents yet; mark their facts as system gaps instead.`);
  const agendaLike = ["agenda", "meetingPackage", "agmMaterial"].includes(docClass);
  if (agendaLike) for (const permission of ["meetings:write", "minutes:write"] as const) await requirePermissionPortable(ctx, societyId, permission);
  const reviews = await reviewsFor(ctx, extraction._id);
  const decisions = latestDecisions(reviews);
  for (const required of requiredFieldsFor(docClass, extraction.record)) {
    if (!isPromotedDecision(decisions.get(required.path)?.decision)) throw new Error(`Accept or edit the ${required.label.toLowerCase()} before promoting.`);
  }
  // A class without required fields (correspondence, agreements, consents…) still needs a reviewed value:
  // promoting a document nobody accepted anything in would write records no person looked at.
  if (![...decisions.values()].some((review) => isPromotedDecision(review?.decision))) throw new Error("Accept or edit at least one field before promoting.");
  const files = await Promise.all((await clusterFiles(ctx, extraction, file)).map((row) => promotionFile(ctx, row)));
  const at = now();

  // Context from the workspace: an existing meeting for an agenda, the adopting motion of a policy, directors on record.
  let existingMeeting: { meetingId: string; date: string; title: string } | undefined;
  if (agendaLike) {
    const date = String(reviewedValue(extraction, decisions, "date")?.iso ?? reviewedValue(extraction, decisions, "meetingDate")?.iso ?? "");
    const bodyKey = bodyKeyFor(String(reviewedValue(extraction, decisions, "bodyLabel") ?? reviewedValue(extraction, decisions, "body") ?? (docClass === "agmMaterial" ? "Annual General Meeting" : "")));
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const wanted = bodyKey === "board" ? "board" : bodyKey === "agm" || bodyKey === "members" ? "agm" : bodyKey === "sgm" ? "sgm" : "committee";
      const meetings = ((await ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as any[]).filter((meeting) => (meetingCalendarDate(meeting) ?? "") === date);
      for (const meeting of meetings) {
        const committee = meeting.committeeId ? await ctx.db.get<any>(meeting.committeeId, "committees") : null;
        const key = bodyKeyForMeeting(meeting, committee);
        if (key === wanted || key.startsWith(`${wanted}:`)) { existingMeeting = { meetingId: String(meeting._id), date, title: String(meeting.title ?? "Meeting") }; break; }
      }
    }
  }
  let policyAdoption: any;
  if (docClass === "policy" || docClass === "bylaws") {
    const minutes = ((await ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", extraction.runId)).collect()) as any[])
      .filter((row) => row.docClass === "meetingMinutes")
      .map((row) => ({ fileKey: row.fileKey, fileId: row.fileKey, docClass: row.docClass, record: row.record, unsupported: [], references: [] }));
    const links = linkPolicyAdoptions([...minutes, { fileKey: extraction.fileKey, fileId: extraction.fileKey, docClass, record: extraction.record, unsupported: [], references: [] }] as any, run.reconciliation?.meetings ?? []);
    policyAdoption = links.find((link) => link.from === extraction.fileKey);
  }
  const directors = (await allowed(ctx, societyId, "directors:read")) ? ((await ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as any[]) : [];
  const directorByKey = new Map(directors.map((row) => [directorMatchKey([row.firstName, row.lastName].filter(Boolean).join(" ")), row]));
  const society = await ctx.db.get<any>(societyId, "societies");

  const build = buildClassPromotionBundle({
    extraction, reviews, files, runName: run.name,
    context: { asOfISO: at, organizationName: society?.name, existingMeeting, policyAdoption, existingDirectorKeys: new Set(directorByKey.keys()) },
  });
  // Versions of a policy promoted one document at a time: date the later versions; a repeated version is a copy.
  if (Array.isArray(build.bundle.policies) && (build.bundle.policies as any[]).length) {
    const existingPolicies = (await ctx.db.query("policies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as any[];
    const versioned = versionPolicyRows(build.bundle.policies as any[], existingPolicies);
    if (versioned.copyOf) throw new Error(`A copy of this document is already promoted as the policy "${versioned.copyOf}".`);
    build.bundle.policies = versioned.rows;
  }

  // Stage and apply through the import-session handlers (same transaction).
  const sessionId = String(await createFromBundlePortable(ctx, { societyId, name: `Intake: ${file.name}`, bundle: build.bundle }));
  // The reviewer's field-by-field decisions are the review the import path asks for before promotion.
  const reviewNotes = `Reviewed field by field in the intake run "${run.name}" (${build.applied.promotedPaths.length} accepted field(s) with source locators) and promoted by the reviewer.`;
  const stagedRecords = (((await getImportSessionPortable(ctx, { sessionId })) as any)?.records ?? []) as any[];
  // The import contract drops records it cannot identify (an insurance policy with neither insurer nor policy number…):
  // say so instead of reporting a promotion that created nothing.
  for (const [collection, count] of Object.entries(build.collections)) {
    const kind = collection === "meetingMinutes" ? "meetingMinutes" : RECORD_KIND_FOR_COLLECTION[collection];
    if (kind && stagedRecords.filter((record) => record.recordKind === kind).length < count) {
      throw new Error(`The ${(TABLE_NOUN[collection] ?? collection).toLowerCase()} could not be staged because an identifying field was not accepted (${IDENTIFYING_FIELDS[collection] ?? "its name or date"}). Accept or edit it and promote again.`);
    }
  }
  for (const record of stagedRecords) await updateRecordPortable(ctx, { recordId: String(record._id), status: "Approved", reviewNotes });
  await applyApprovedDocumentsPortable(ctx, { sessionId });
  if (build.collections.meetingMinutes) await applyApprovedMeetingsPortable(ctx, { sessionId });
  const sectionResult = await applyApprovedSectionRecordsPortable(ctx, { sessionId, allOrNothing: true }) as any;
  const session = await getImportSessionPortable(ctx, { sessionId }) as any;
  if (sectionResult?.preflightBlocked || Object.keys(sectionResult?.byKind ?? {}).some((key) => key.endsWith(":blocked"))) {
    const issues = (session?.records ?? []).map((record: any) => /Promotion blocked: ([^\n]+)/.exec(String(record.reviewNotes ?? ""))?.[1]).filter(Boolean).slice(0, 3);
    throw new Error(`The ${spec.noun} could not be written: ${issues.join("; ") || "a staged record failed its checks"}. Nothing was promoted.`);
  }

  // What was created.
  const created: Array<{ kind: string; table: string; id: string; payload: Record<string, any>; label: string }> = [];
  const sourceDocuments: Array<{ fileKey: string; documentId: string; name: string; sha256?: string; mimeType?: string; sizeBytes?: number }> = [];
  for (const record of session?.records ?? []) {
    if (record.recordKind === "documentCandidate") {
      const documentId = record.importedTargets?.documents;
      const fileKey = record.payload?.externalId;
      if (!documentId || !fileKey) continue;
      const intakeFile = files.find((candidate) => candidate.fileKey === fileKey);
      sourceDocuments.push(compact({ fileKey, documentId: String(documentId), name: intakeFile?.name ?? fileKey, sha256: intakeFile?.sha256, mimeType: intakeFile?.mimeType, sizeBytes: intakeFile?.sizeBytes }) as any);
      const row = await ctx.db.query("intakeFiles").withIndex("by_run_file_key", (q) => q.eq("runId", extraction.runId).eq("fileKey", fileKey)).first() as any;
      if (row && !row.documentId) await ctx.db.patch(row._id, { documentId, updatedAtISO: at });
      await markSourceDocumentTransposed(ctx, documentId);
    } else if (record.recordKind === "meetingMinutes" && record.importedTargets?.meetings?.meetingId) {
      created.push({ kind: "meetingMinutes", table: "meetings", id: String(record.importedTargets.meetings.meetingId), payload: record.payload ?? {}, label: String(record.payload?.meetingTitle ?? "Meeting") });
    } else if (RECORD_KIND_TABLE[record.recordKind] && record.importedTargets?.sections) {
      const payload = record.payload ?? {};
      created.push({ kind: record.recordKind, table: RECORD_KIND_TABLE[record.recordKind], id: String(record.importedTargets.sections), payload, label: String(payload.policyName ?? payload.fullName ?? payload.title ?? payload.insurer ?? payload.name ?? payload.organizationName ?? payload.label ?? payload.kind ?? payload.description ?? record.recordKind) });
    }
  }
  const firstDocumentId = sourceDocuments.find((row) => row.fileKey === extraction.fileKey)?.documentId ?? sourceDocuments[0]?.documentId;

  // An agenda or package of a meeting already on record: a meeting material of that meeting.
  if (build.material) {
    const existing = (await ctx.db.query("meetingMaterials").withIndex("by_meeting", (q) => q.eq("meetingId", build.material!.meetingId)).collect()) as any[];
    const already = firstDocumentId ? existing.find((row) => String(row.documentId) === String(firstDocumentId)) : undefined;
    const materialId = already?._id ?? (firstDocumentId ? await ctx.db.insert("meetingMaterials", compact({
      societyId, meetingId: build.material.meetingId, documentId: firstDocumentId, agendaLabel: build.material.agendaLabel, label: build.material.label, order: existing.length,
      requiredForMeeting: false, accessLevel: "board", availabilityStatus: "available", notes: `Linked by intake review (${spec.noun}); ${build.material.agendaItems.length} agenda item(s) as circulated.`, createdAtISO: at,
    })) : undefined);
    const meeting = await ctx.db.get<any>(build.material.meetingId, "meetings");
    created.push({ kind: "meeting", table: "meetings", id: build.material.meetingId, payload: {}, label: String(meeting?.title ?? "Meeting") });
    if (materialId) created.push({ kind: "meetingMaterial", table: "meetingMaterials", id: String(materialId), payload: {}, label: build.material.label });
  }

  // Directors already in the register: consent and observed terms are added to them.
  for (const row of build.existingDirectors) {
    const director = directorByKey.get(directorMatchKey(String(row.fullName ?? "")));
    if (!director) continue;
    await requirePermissionPortable(ctx, societyId, "directors:write");
    // Consent on file, and the earliest observed term start (a 2021 consent before a 2025 filing).
    const earliest = (Array.isArray(row.terms) ? row.terms : []).map((term: any) => clean(term.termStart, 10)).filter((value: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(value))).sort()[0];
    const patch: Record<string, unknown> = {};
    if (row.consentOnFile && !director.consentOnFile) patch.consentOnFile = true;
    if (earliest && (!director.termStart || earliest < String(director.termStart))) patch.termStart = earliest;
    if (Object.keys(patch).length) await ctx.db.patch(director._id, patch);
    for (const term of Array.isArray(row.terms) ? row.terms : []) {
      await ctx.db.insert("boardRoleAssignments", compact({
        societyId, personName: String(row.fullName), personKey: normalizePersonKey(String(row.fullName)), directorId: director._id, memberId: director.memberId,
        roleTitle: clean(term.position, 120) ?? "Director", roleType: "director", startDate: clean(term.termStart, 10) ?? clean(row.termStart, 10) ?? at.slice(0, 10), endDate: clean(term.termEnd, 10),
        status: "Observed", confidence: "Review", sourceDocumentIds: firstDocumentId ? [firstDocumentId] : [], sourceExternalIds: Array.isArray(term.sourceExternalIds) ? term.sourceExternalIds : [extraction.fileKey],
        importedFrom: "Intake review", notes: clean(term.notes, 500), createdAtISO: at,
      }));
    }
    created.push({ kind: "director", table: "directors", id: String(director._id), payload: row, label: String(row.fullName) });
  }

  // Field provenance: one row per promoted field, on the record it landed on.
  const { rows, notLanded } = classProvenanceTargets(docClass, extraction.record, build.applied.promotedPaths, created);
  for (const row of rows) {
    const review = decisions.get(row.sourceFieldPath)!;
    const field = resolveFieldPath(extraction.record, row.sourceFieldPath);
    const locator = primaryLocator(field, extraction.fileKey);
    await ctx.db.insert("fieldProvenance", provenanceRow({
      societyId, targetTable: row.targetTable, targetId: row.targetId, fieldPath: row.fieldPath, sourceFieldPath: row.sourceFieldPath, extraction, locator,
      value: review?.decision === "edit" ? review.editedValue : field?.value, decision: review?.decision ?? "accept", at,
    }));
  }

  // System gaps: the extractor's unsupported details, the class stage's gaps and reviewer "can't represent" gaps.
  const main = created.find((target) => target.table !== "documents");
  let gaps = 0;
  for (const review of decisions.values()) {
    const gapId = (review as any).gap?.gapId;
    if (review.decision !== "cant_represent" || !gapId) continue;
    const gap = await ctx.db.get<any>(String(gapId), "representationGaps");
    if (gap && gap.societyId === societyId && !gap.affectedId && main) {
      await ctx.db.patch(gap._id, { affectedTable: main.table, affectedId: main.id, updatedAtISO: at });
      gaps++;
    }
  }
  const existingKeys = new Set(((await ctx.db.query("representationGaps").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as any[]).map((row) => row.dedupeKey).filter(Boolean));
  for (const [index, detail] of build.gaps.entries()) {
    const dedupeKey = `intake:${extraction._id}:${detail.fromClassStage ? "class" : "unsupported"}:${index}`;
    if (existingKeys.has(dedupeKey)) continue;
    const affectedTable = String(detail.affectedTable ?? main?.table ?? "documents");
    const affected = created.find((target) => target.table === affectedTable) ?? (affectedTable === "agreements" ? undefined : main);
    if (detail.fromClassStage) {
      const { fromClassStage: _ignored, status: _status, reviewHistory: _history, ...row } = detail as any;
      await insertRepresentationGapFromImport(ctx, societyId, { ...row, origin: "intake", sourceTitle: file.name, ...(affected ? { affectedTable: affected.table, affectedId: affected.id } : {}), dedupeKey, sensitivity: file.sensitivity === "restricted" ? "restricted" : undefined }, { importSessionId: sessionId, sourceDocumentId: firstDocumentId });
    } else {
      const locators = (detail.locators ?? []) as any[];
      const [proposedTargetTable, ...proposedField] = String(detail.suggestedTarget ?? "").split(".");
      await insertRepresentationGapFromImport(ctx, societyId, {
        infoType: detail.infoType ?? "other", reason: { no_field: "no_schema_field", no_table: "no_schema_field", no_relationship: "no_import_key", no_ui_edit: "no_ui_input", lossy_normalization: "import_dropped" }[String(detail.category)] ?? "no_schema_field",
        origin: "intake", title: clean(detail.description, 240), sourceExternalId: extraction.fileKey, sourceTitle: file.name, locator: gapLocatorFrom(locators[0], file.sha256, file.path),
        excerpt: locators[0]?.quote ?? detail.description, observedDate: detail.observedDate, bodyKey: extraction.record?.body?.value, affectedTable: affected?.table ?? affectedTable, ...(affected ? { affectedId: affected.id } : {}),
        proposedTargetTable: clean(proposedTargetTable, 80), proposedField: clean(proposedField.join("."), 120), dedupeKey, sensitivity: file.sensitivity === "restricted" ? "restricted" : undefined, notes: detail.description,
      }, { importSessionId: sessionId, sourceDocumentId: firstDocumentId });
    }
    gaps++;
  }

  const targets = created.filter((target, index) => created.findIndex((other) => other.table === target.table && other.id === target.id) === index).slice(0, 200).map((target) => ({ table: target.table, id: target.id, label: target.label.slice(0, 200) }));
  await ctx.db.patch(extraction._id, { status: "promoted", promotion: { sessionId, targets, atISO: at }, updatedAtISO: at });
  const covered = await markClusterCopiesCovered(ctx, extraction, file, at);
  if (run.status === "extracted" || run.status === "created") await ctx.db.patch(run._id, { status: "reviewing", updatedAtISO: at });
  const meetingId = created.find((target) => target.table === "meetings")?.id;
  return {
    docClass, sessionId, targets, covered, ...(meetingId ? { meetingId } : {}), merged: Boolean(build.material),
    provenance: rows.length, notLanded: notLanded.length, notLandedPaths: notLanded.slice(0, 50), gaps, sourceDocuments, warnings: build.warnings,
  };
}

/** Provenance rows written when an extraction was promoted (review screen "Promoted to …" link). */
export async function provenanceForExtraction(ctx: PortableQueryCtx, { societyId, extractionId }: { societyId: string; extractionId: string }) {
  await canRead(ctx, societyId);
  await getOwned(ctx, "intakeExtractions", extractionId, societyId);
  const rows = (await ctx.db.query("fieldProvenance").withIndex("by_extraction", (q) => q.eq("extractionId", extractionId)).collect()) as any[];
  return hydrateProvenance(ctx, rows.filter((row) => row.societyId === societyId));
}

/** Native coverage per run: how many extractions/fields became native records. */
export async function runSummaries(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await canRead(ctx, societyId);
  const runs = (await ctx.db.query("intakeRuns").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as any[];
  const gapKeys = (await allowed(ctx, societyId, "documents:read"))
    ? ((await ctx.db.query("representationGaps").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as any[]).map((row) => String(row.dedupeKey ?? "")).filter((key) => key.startsWith("intake:"))
    : null;
  const out: any[] = [];
  for (const run of runs) {
    const extractions = (await ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", run._id)).omitFields("record", "unsupported", "references", "verification").collect()) as any[];
    const ids = new Set(extractions.map((row) => String(row._id)));
    const systemGaps = gapKeys ? gapKeys.filter((key) => ids.has(key.split(":")[1])).length : null;
    const promoted = extractions.filter((row) => row.status === "promoted");
    // Facts extracted (fields with a value) across the run; promotedFields ÷ extractedFields is the reviewed native coverage.
    const factCounts = await ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", run._id)).collectProjected("intake.extractedFacts/v1", extractedFactCount);
    const extractedFields = factCounts.reduce((sum, row) => sum + row.facts, 0);
    let promotedFields = 0;
    for (const extraction of promoted) promotedFields += ((await ctx.db.query("fieldProvenance").withIndex("by_extraction", (q) => q.eq("extractionId", extraction._id)).collect()) as any[]).length;
    out.push({
      runId: run._id, name: run.name, status: run.status, createdAtISO: run.createdAtISO, extractions: extractions.length, promoted: promoted.length,
      rejected: extractions.filter((row) => row.status === "rejected").length, promotedFields, coverage: run.coverage?.headline ?? null, recordGaps: run.recordGaps?.length ?? 0, systemGaps, extractedFields, promotedCoverage: extractedFields ? Number((promotedFields / extractedFields).toFixed(3)) : null,
    });
  }
  return out.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)));
}

/** Extracted facts of one extraction (pure: memoized per extraction revision). */
function extractedFactCount(row: any) {
  return { id: String(row._id), facts: reviewFieldsForRecord(row.record ?? {}, row.docClass).filter((field) => field.field.value !== undefined && field.field.value !== null && field.field.status !== "not_stated").length };
}

/** Recompute reconciliation, record gaps and coverage from the stored files and extractions (after server-side field extraction). */
export async function reconcileRun(ctx: PortableMutationCtx, { societyId, runId }: { societyId: string; runId: string }) {
  await canWrite(ctx, societyId);
  const run = await getOwned<any>(ctx, "intakeRuns", runId, societyId);
  const files = (await ctx.db.query("intakeFiles").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[];
  const rows = (await ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[];
  // One extraction per file: the model's when present, else the deterministic one.
  const byFile = new Map<string, any>();
  for (const row of rows) {
    const current = byFile.get(row.fileKey);
    if (!current || (current.engine === "deterministic" && row.engine !== "deterministic")) byFile.set(row.fileKey, row);
  }
  const extractions: any[] = [...byFile.values()].map((row) => ({ fileKey: row.fileKey, fileId: row.fileKey, ...(row.parentFileKey ? { parentFileKey: row.parentFileKey } : {}), docClass: row.docClass, schemaVersion: row.schemaVersion, engine: row.engine, model: row.model, record: row.record, unsupported: row.unsupported ?? [], references: row.references ?? [], warnings: row.warnings, verification: row.verification }));
  // Minutes embedded in packages are derived records (never stored): derive them again from the stored
  // extracts, as the in-browser pipeline does, so hosted runs see the same meetings and record gaps.
  const storedDerived = new Set(rows.filter((row) => row.parentFileKey).map((row) => row.fileKey));
  for (const row of [...byFile.values()].filter((candidate) => ["agenda", "meetingPackage", "agmMaterial"].includes(candidate.docClass) && !candidate.parentFileKey)) {
    const extract = await ctx.db.query("intakeExtracts").withIndex("by_file", (q) => q.eq("fileId", row.fileId)).first() as any;
    const file = files.find((candidate) => String(candidate._id) === String(row.fileId));
    if (!extract?.text || !file) continue;
    try {
      extractions.push(...deriveEmbeddedMinutes(extractions.find((candidate) => candidate.fileKey === row.fileKey), { method: extract.method, methodVersion: extract.methodVersion, blocks: extract.blocks, text: extract.text, warnings: extract.warnings ?? [] } as any, file).filter((derived) => !storedDerived.has(derived.fileKey)));
    } catch {
      // A truncated extract (very large package) cannot be split; its embedded minutes are skipped.
    }
  }
  const fiscalChanges = annotateFiscalYearEndChanges(extractions);
  const { reconciled, carry, gaps } = reconcileExtractions(files, extractions, { fiscalChanges });
  const clusters = (await ctx.db.query("intakeClusters").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[];
  const result: IntakeRunResult = {
    runId, name: run.name, sourceKind: run.sourceKind, sourceRoot: run.sourceRoot ?? "", startedAtISO: run.createdAtISO, engine: run.engine ?? { minutes: "deterministic" },
    files: files.map((file) => ({ ...file, extractMethod: undefined })),
    clusters: clusters.map((cluster) => ({ clusterKey: cluster.clusterKey, canonicalId: cluster.canonicalFileKey, members: cluster.members.map((member: any) => ({ fileId: member.fileKey, relation: member.relation, score: member.score, reason: member.reason })), method: cluster.method })),
    extractions: extractions as any,
    reconciliation: { meetings: reconciled.meetings, links: [...reconciled.links, ...carry.links], gaps, actionChains: carry.chains },
    processingLog: [],
  };
  const build = buildImportBundle(result);
  const coverage = coverageReport(result, build);
  await ctx.db.patch(runId, {
    status: run.status === "created" || run.status === "running" ? "extracted" : run.status,
    recordGaps: gaps,
    reconciliation: { meetings: reconciled.meetings, links: [...reconciled.links, ...carry.links].slice(0, 2000), actionChains: carry.chains.slice(0, 500) },
    coverage: { headline: coverage.headline, byClass: coverage.byClass, byBody: coverage.byBody, byYear: coverage.byYear, dispositions: coverage.dispositions, hallucinationRate: coverage.hallucinationRate },
    updatedAtISO: now(),
  });
  return { meetings: reconciled.meetings.length, recordGaps: gaps.length, coverage: coverage.headline };
}

// ---------------------------------------------------------------- entities

const nameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

async function directoryFor(ctx: PortableQueryCtx, societyId: string): Promise<{ directory: DirectoryPerson[]; terms: OfficeTerm[]; readable: boolean }> {
  if (!(await allowed(ctx, societyId, "members:read"))) return { directory: [], terms: [], readable: false };
  const rows = await visibleDirectoryRows(ctx, societyId);
  const directory = rows.map((row: any) => ({ id: String(row._id), fullName: String(row.fullName ?? [row.firstName, row.lastName].filter(Boolean).join(" ")), aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [] })).filter((person) => person.fullName.trim());
  const terms: OfficeTerm[] = [];
  if (await allowed(ctx, societyId, "directors:read")) {
    const holders = (await ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as any[];
    for (const holder of holders) if (holder.directoryPersonId && holder.officerTitle) terms.push({ personId: String(holder.directoryPersonId), title: String(holder.officerTitle), start: holder.startDate, end: holder.endDate });
  }
  return { directory, terms, readable: true };
}

/** Names and role words in one extraction, grouped, with people-directory candidates (office holders on the meeting date for role words). */
export async function entityCandidates(ctx: PortableQueryCtx, { societyId, extractionId }: { societyId: string; extractionId: string }) {
  await canRead(ctx, societyId);
  const extraction = await getOwned<any>(ctx, "intakeExtractions", extractionId, societyId);
  const { directory, terms, readable } = await directoryFor(ctx, societyId);
  const record = extraction.record ?? {};
  const contextNames = (record.attendance ?? []).map((entry: any) => entry?.nameAsWritten?.value).filter(Boolean);
  const groups = entityGroups(nameOccurrences(record), directory, { date: record.date?.value?.iso, terms, contextNames });
  return { directoryReadable: readable, directorySize: directory.length, groups };
}

/** One identity decision applied to every occurrence of a name across the run's unpromoted extractions:
 * link it to a people-directory person (edit reviews carrying the resolved name) or accept it as written. */
export async function linkNameAcrossRun(ctx: PortableMutationCtx, { societyId, runId, name, personId, mode }: { societyId: string; runId: string; name: string; personId?: string; mode?: string }) {
  await canWrite(ctx, societyId);
  await getOwned(ctx, "intakeRuns", runId, societyId);
  const wanted = nameKey(String(name ?? ""));
  if (!wanted) throw new Error("Choose a name.");
  const linking = mode !== "accept";
  let person: { id: string; fullName: string } | undefined;
  if (linking) {
    if (!personId) throw new Error("Choose the person to link.");
    const { directory } = await directoryFor(ctx, societyId);
    const match = directory.find((candidate) => candidate.id === personId);
    if (!match) throw new Error("Directory person not found.");
    person = { id: match.id, fullName: match.fullName };
  }
  const extractions = (await ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[];
  const items: ReviewItem[] = [];
  let touched = 0;
  for (const extraction of extractions) {
    if (extraction.status === "promoted" || extraction.status === "rejected" || extraction.status === "covered") continue;
    const decisions = latestDecisions(await reviewsFor(ctx, extraction._id));
    const occurrences = nameOccurrences(extraction.record ?? {}).filter((occurrence) => nameKey(occurrence.name) === wanted);
    if (!occurrences.length) continue;
    touched++;
    for (const occurrence of occurrences) {
      if (!linking && decisions.has(occurrence.path)) continue;
      const field = resolveFieldPath(extraction.record, occurrence.path);
      items.push(linking
        ? { extractionId: extraction._id, fieldPath: occurrence.path, decision: "edit", editedValue: linkedValue(occurrence, field, person!), note: `Linked to ${person!.fullName} (applied to all occurrences of "${name}").` }
        : { extractionId: extraction._id, fieldPath: occurrence.path, decision: "accept", note: `Accepted "${name}" as written (applied to all occurrences).` });
    }
  }
  const result = await writeReviews(ctx, societyId, items);
  return { reviewIds: result.reviewIds, occurrences: items.length, extractions: touched };
}

/** One file's stored text/layout extract (version diffs, and the viewer for files without an extraction). */
export async function getFileExtract(ctx: PortableQueryCtx, { societyId, fileId }: { societyId: string; fileId: string }) {
  await canRead(ctx, societyId);
  const file = await getOwned<any>(ctx, "intakeFiles", fileId, societyId);
  await requirePermissionPortable(ctx, societyId, "documents:read");
  if (file.sensitivity === "restricted") await requirePermissionPortable(ctx, societyId, "settings:write");
  const extract = await ctx.db.query("intakeExtracts").withIndex("by_file", (q) => q.eq("fileId", file._id)).first();
  return { file, extract };
}

/** Provenance for several records at once; a meeting also brings its minutes and motions. Rows carry the source file name for display. */
export async function provenanceForRecords(ctx: PortableQueryCtx, { societyId, targets }: { societyId: string; targets: Array<{ targetTable: string; targetId: string }> }) {
  await canRead(ctx, societyId);
  if (!Array.isArray(targets) || targets.length > 50) throw new Error("Ask for at most 50 records.");
  const wanted: Array<{ targetTable: string; targetId: string }> = [];
  for (const target of targets) {
    wanted.push(target);
    if (target.targetTable !== "meetings") continue;
    const meeting = await ctx.db.get<any>(target.targetId, "meetings");
    if (!meeting || meeting.societyId !== societyId || !meeting.minutesId) continue;
    wanted.push({ targetTable: "minutes", targetId: String(meeting.minutesId) });
    const minutes = await ctx.db.get<any>(meeting.minutesId, "minutes");
    for (const motionId of (minutes?.motionIds ?? []) as string[]) wanted.push({ targetTable: "motions", targetId: String(motionId) });
  }
  const rows: any[] = [];
  for (const target of wanted) {
    const found = (await ctx.db.query("fieldProvenance").withIndex("by_target", (q) => q.eq("targetTable", target.targetTable).eq("targetId", target.targetId)).collect()) as any[];
    rows.push(...found.filter((row) => row.societyId === societyId));
  }
  const names = new Map<string, { name: string; runName?: string; sensitivity?: string }>();
  for (const row of rows) {
    const key = `${row.runId}|${row.fileKey}`;
    if (names.has(key) || !row.runId || !row.fileKey) continue;
    const file = await ctx.db.query("intakeFiles").withIndex("by_run_file_key", (q) => q.eq("runId", row.runId).eq("fileKey", row.fileKey)).first() as any;
    const run = await ctx.db.get<any>(row.runId, "intakeRuns");
    names.set(key, { name: file?.name ?? String(row.fileKey).replace(/^local:/, ""), runName: run?.name, sensitivity: file?.sensitivity });
  }
  const seesRestricted = await allowed(ctx, societyId, "settings:write");
  const seesContent = await allowed(ctx, societyId, "documents:read");
  return (await hydrateProvenance(ctx, rows)).map((row) => {
    const meta = names.get(`${row.runId}|${row.fileKey}`);
    const restricted = meta?.sensitivity === "restricted";
    // Quotes from restricted files are shown only to people who could read the file itself.
    const hide = !seesContent || (restricted && !seesRestricted);
    return { ...row, ...(hide ? { value: undefined, locator: { ...row.locator, quote: undefined } } : {}), fileName: meta?.name, runName: meta?.runName, restricted };
  });
}

/** Whether a promoted value is what the native field now holds (scalar header fields). */
export function landedValue(field: string, native: unknown, value: unknown, merged: boolean): boolean {
  if (native === undefined || native === null || native === "") return false;
  const v: any = value;
  switch (field) {
    case "scheduledAt": return String(native).slice(0, 10) === String(v?.iso ?? v ?? "").slice(0, 10);
    case "electronic": return Boolean(native) === Boolean(v);
    case "type": return !merged; // body → meeting type/committee is a mapping, attributed only when this import set it
    case "chairName": case "recorderName": return matchKey(native) === matchKey(v?.resolvedName ?? v?.nameAsWritten ?? v) || matchKey(native) === matchKey(v?.nameAsWritten ?? v);
    case "quorumStatus": return !merged || String(native) !== "not_recorded";
    case "nextMeetingAt": return !merged || (typeof v?.date === "string" ? String(native).startsWith(v.date) : true);
    case "importedSourceVersions": case "sourceExternalIds": case "sessionSegments": case "appendices": return true;
    default: {
      const a = matchKey(native);
      const b = matchKey(v?.text ?? v?.resolvedName ?? v?.nameAsWritten ?? v);
      return Boolean(b) && (a === b || a.includes(b) || (!merged && b.includes(a)));
    }
  }
}

async function markSourceDocumentTransposed(ctx: PortableMutationCtx, documentId: unknown) {
  const document = await ctx.db.get(documentId as any, "documents") as any;
  const next = document ? reviewStatusAfterTransposition(document.reviewStatus) : undefined;
  if (next) await ctx.db.patch(document._id, { reviewStatus: next });
}
