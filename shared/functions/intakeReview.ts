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
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId } from "./access";
import { requirePermissionPortable } from "./permissions";
import { resolveFieldPath } from "./intake";
import { insertRepresentationGapFromImport } from "./representationGaps";
import {
  applyApprovedDocumentsPortable,
  applyApprovedMeetingsPortable,
  bulkSetStatusPortable,
  createFromBundlePortable,
  getPortable as getImportSessionPortable,
} from "./importSessions";
import { bodyKeyForMeeting } from "../meetingBody";
import { buildPromotionBundle, defaultInfoTypeForPath, gapLocatorFrom, matchKey, type MergeTarget, type PromotionFile, type PromotionMode } from "../intake/promotion";
import { entityGroups, formatFieldValue, isPromotedDecision, latestDecisions, linkedValue, nameOccurrences, nativeTargetForPath, primaryLocator, reviewFieldsForRecord, REVIEW_DECISIONS, type ReviewRow } from "../intake/review";
import { visibleDirectoryRows } from "./peopleDirectory";
import type { DirectoryPerson, OfficeTerm } from "../intake/entities";
import { reconcileExtractions } from "../intake/reconcile";
import { buildImportBundle, coverageReport, type IntakeRunResult } from "../intake/bundle";

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
  if (items.some((item) => item.decision === "cant_represent")) await requirePermissionPortable(ctx, societyId, "documents:write");
  const reviewerUserId = await principalUserId(ctx, societyId).catch(() => undefined);
  const extractions = new Map<string, any>();
  const reviewIds: string[] = [];
  const gapIds: string[] = [];
  const at = now();
  for (const item of items) {
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
  const sameDay = meetings.filter((meeting) => String(meeting.scheduledAt ?? "").slice(0, 10) === date);
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
  if (!file.clusterKey) return files;
  const clusters = (await ctx.db.query("intakeClusters").withIndex("by_run", (q) => q.eq("runId", extraction.runId)).collect()) as any[];
  const cluster = clusters.find((candidate) => candidate.clusterKey === file.clusterKey);
  for (const member of cluster?.members ?? []) {
    if (member.fileKey === file.fileKey || !member.fileId) continue;
    // Only exact and format copies are the same record; drafts and other versions are sources of the same meeting too.
    const memberFile = await ctx.db.get<any>(member.fileId, "intakeFiles");
    if (memberFile && memberFile.societyId === file.societyId) files.push(memberFile);
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
  return { dateKey: String(meeting.scheduledAt).slice(0, 10), meetingType: String(meeting.type ?? "Board"), ...(committee?.name ? { committeeName: committee.name } : {}) };
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
  const run = await getOwned<any>(ctx, "intakeRuns", extraction.runId, societyId);
  const file = await getOwned<any>(ctx, "intakeFiles", extraction.fileId, societyId);
  if (file.sensitivity === "restricted") await requirePermissionPortable(ctx, societyId, "settings:write");
  const reviews = await reviewsFor(ctx, extraction._id);
  const decisions = latestDecisions(reviews);
  const fields = reviewFieldsForRecord(extraction.record);
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
      if (landedValue(nativeTarget.field, (meeting as any)?.[nativeTarget.field], value, merged)) provenance.push({ targetTable: "meetings", targetId: meetingId, fieldPath: nativeTarget.field, locator, value, decision: review.decision, sourceFieldPath: path });
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
    await ctx.db.insert("fieldProvenance", compact({
      societyId, targetTable: row.targetTable, targetId: row.targetId, fieldPath: row.fieldPath.slice(0, 300), sourceFieldPath: row.sourceFieldPath?.slice(0, 300), runId: extraction.runId, extractionId: extraction._id, fileKey: extraction.fileKey,
      locator: compact({ fileId: clean(row.locator.fileId, 600), kind: row.locator.kind, blockIndex: row.locator.blockIndex, page: row.locator.page, sheet: clean(row.locator.sheet, 200), cell: clean(row.locator.cell, 40), charStart: row.locator.charStart, charEnd: row.locator.charEnd, quote: clean(row.locator.quote, 400) }),
      value: row.value, decision: row.decision, createdAtISO: at,
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

  await ctx.db.patch(extraction._id, { status: "promoted", updatedAtISO: at });
  if (run.status === "extracted" || run.status === "created") await ctx.db.patch(run._id, { status: "reviewing", updatedAtISO: at });
  return {
    meetingId, minutesId, sessionId, merged: Number(applied?.existing ?? 0) > 0, meetingTitle: meeting?.title,
    provenance: provenance.length, notLanded: notLandedPaths.length, notLandedPaths: notLandedPaths.slice(0, 50), gaps, sourceDocuments, warnings: build.warnings,
  };
}

/** Provenance rows written when an extraction was promoted (review screen "Promoted to …" link). */
export async function provenanceForExtraction(ctx: PortableQueryCtx, { societyId, extractionId }: { societyId: string; extractionId: string }) {
  await canRead(ctx, societyId);
  await getOwned(ctx, "intakeExtractions", extractionId, societyId);
  const rows = (await ctx.db.query("fieldProvenance").withIndex("by_extraction", (q) => q.eq("extractionId", extractionId)).collect()) as any[];
  return rows.filter((row) => row.societyId === societyId);
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
    const extractions = (await ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", run._id)).collect()) as any[];
    const ids = new Set(extractions.map((row) => String(row._id)));
    const systemGaps = gapKeys ? gapKeys.filter((key) => ids.has(key.split(":")[1])).length : null;
    const promoted = extractions.filter((row) => row.status === "promoted");
    // Facts extracted (fields with a value) across the run; promotedFields ÷ extractedFields is the reviewed native coverage.
    const extractedFields = extractions.reduce((sum, row) => sum + reviewFieldsForRecord(row.record ?? {}).filter((field) => field.field.value !== undefined && field.field.value !== null && field.field.status !== "not_stated").length, 0);
    let promotedFields = 0;
    for (const extraction of promoted) promotedFields += ((await ctx.db.query("fieldProvenance").withIndex("by_extraction", (q) => q.eq("extractionId", extraction._id)).collect()) as any[]).length;
    out.push({
      runId: run._id, name: run.name, status: run.status, createdAtISO: run.createdAtISO, extractions: extractions.length, promoted: promoted.length,
      rejected: extractions.filter((row) => row.status === "rejected").length, promotedFields, coverage: run.coverage?.headline ?? null, recordGaps: run.recordGaps?.length ?? 0, systemGaps, extractedFields, promotedCoverage: extractedFields ? Number((promotedFields / extractedFields).toFixed(3)) : null,
    });
  }
  return out.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)));
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
  const extractions = [...byFile.values()].map((row) => ({ fileKey: row.fileKey, fileId: row.fileKey, docClass: row.docClass, schemaVersion: row.schemaVersion, engine: row.engine, model: row.model, record: row.record, unsupported: row.unsupported ?? [], references: row.references ?? [], warnings: row.warnings, verification: row.verification }));
  const { reconciled, carry, gaps } = reconcileExtractions(files, extractions);
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
    if (extraction.status === "promoted" || extraction.status === "rejected") continue;
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
  const result = items.length ? await reviewFields(ctx, { societyId, items }) : { reviewIds: [], gapIds: [] };
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
  return rows.map((row) => {
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
