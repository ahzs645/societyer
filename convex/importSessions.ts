import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import {
  listPortable,
  getPortable,
  createFromBundlePortable,
  updateRecordPortable,
  bulkSetStatusPortable,
  bulkSetStatusByKindPortable,
  bulkSetStatusByFilterPortable,
  refreshSessionSummariesPortable,
  removeSessionPortable,
  applyApprovedToOrgHistoryPortable,
  applyApprovedMeetingsPortable,
  backfillApprovedMeetingReferencesPortable,
} from "../shared/functions/importSessions";
import {
  SECTION_RECORD_KINDS,
  ensureImportSourceDocuments,
  insertSectionRecord,
  patchRecordImportTarget,
  patchRecordPromotionBlocked,
  importPromotionIssues,
  patchSessionUpdatedAt,
  sessionRecords,
  sourceCatalogForRecords,
  isImportSession,
  insertSourceEvidenceForAppliedRecord,
  hydrateSession,
  unique,
  numberOrUndefined,
  cleanText,
  tagValue,
  importedLibrarySection,
  sourceSystemFromExternalId,
  sourceSystemLabel,
  sourceSystemTag,
} from "./importSessionHelpers";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => getPortable(toPortableQueryCtx(ctx), args),
});

export const createFromBundle = mutation({
  args: {
    societyId: v.id("societies"),
    name: v.optional(v.string()),
    bundle: v.any(),
  },
  returns: v.any(),
  handler: (ctx, args) => createFromBundlePortable(toPortableMutationCtx(ctx), args),
});

export const updateRecord = mutation({
  args: {
    recordId: v.id("documents"),
    status: v.optional(v.string()),
    reviewNotes: v.optional(v.string()),
    payload: v.optional(v.any()),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: (ctx, args) => updateRecordPortable(toPortableMutationCtx(ctx), args),
});

export const bulkSetStatus = mutation({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    recordIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.any(),
  handler: (ctx, args) => bulkSetStatusPortable(toPortableMutationCtx(ctx), args),
});

export const bulkSetStatusByKind = mutation({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    recordKinds: v.array(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: (ctx, args) => bulkSetStatusByKindPortable(toPortableMutationCtx(ctx), args),
});

export const bulkSetStatusByFilter = mutation({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    currentStatus: v.optional(v.string()),
    recordKinds: v.optional(v.array(v.string())),
    targetModules: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: (ctx, args) => bulkSetStatusByFilterPortable(toPortableMutationCtx(ctx), args),
});

export const refreshSessionSummaries = mutation({
  args: {
    societyId: v.id("societies"),
    sessionIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.any(),
  handler: (ctx, args) => refreshSessionSummariesPortable(toPortableMutationCtx(ctx), args),
});

export const removeSession = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => removeSessionPortable(toPortableMutationCtx(ctx), args),
});

export const applyApprovedToOrgHistory = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => applyApprovedToOrgHistoryPortable(toPortableMutationCtx(ctx), args),
});

export const applyApprovedMeetings = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => applyApprovedMeetingsPortable(toPortableMutationCtx(ctx), args),
});

export const backfillApprovedMeetingReferences = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: (ctx, args) => backfillApprovedMeetingReferencesPortable(toPortableMutationCtx(ctx), args),
});

export const applyApprovedDocuments = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { documents: 0 };
    const records = await sessionRecords(ctx, session.societyId, sessionId);
    const candidates = records.filter(
      (record) =>
        record.recordKind === "documentCandidate" &&
        record.status === "Approved" &&
        !record.importedTargets?.documents,
    );

    let documents = 0;
    for (const record of candidates) {
      const payload = record.payload ?? {};
      const sourceExternalIds = unique([
        ...(record.sourceExternalIds ?? []),
        ...(payload.sourceExternalIds ?? []),
        payload.externalId,
        payload.id != null ? `paperless:${payload.id}` : undefined,
      ]);
      const externalId = sourceExternalIds[0];
      const externalSystem = cleanText(payload.externalSystem) || sourceSystemFromExternalId(externalId);
      const paperlessId = externalSystem === "paperless" && externalId ? externalId : undefined;
      const sections = Array.isArray(payload.sections) ? payload.sections.map(String) : [];
      const sourceTags = Array.isArray(payload.tags) ? payload.tags.map(String) : [];
      const docId = await ctx.db.insert("documents", {
        societyId: session.societyId,
        title: cleanText(payload.title) || record.title || externalId || "Imported document candidate",
        category: cleanText(record.targetModule) || cleanText(sections[0]) || "Imported Document",
        fileName: cleanText(payload.fileName),
        mimeType: cleanText(payload.mimeType),
        fileSizeBytes: numberOrUndefined(payload.fileSizeBytes),
        content: JSON.stringify({
          importedFrom: `${sourceSystemLabel(externalSystem)} import session`,
          importSessionId: sessionId,
          externalSystem,
          externalId,
          sourceExternalIds,
          paperlessId,
          localPath: cleanText(payload.localPath),
          sha256: cleanText(payload.sha256),
          sections,
          confidence: payload.confidence,
          why: payload.why,
          created: payload.created,
          tags: sourceTags,
          note: `Metadata-only import. Review the original ${sourceSystemLabel(externalSystem)} source before relying on OCR or publishing content.`,
        }),
        createdAtISO: new Date().toISOString(),
        reviewStatus: "in_review",
        librarySection: importedLibrarySection(record.targetModule, sections),
        flaggedForDeletion: false,
        tags: unique([
          `${sourceSystemTag(externalSystem)}-import`,
          "import-candidate",
          externalId,
          ...sections.map(tagValue),
          ...sourceTags.map(tagValue).slice(0, 8),
        ]),
      });
      await patchRecordImportTarget(ctx, record, "documents", docId);
      documents += 1;
    }

    await patchSessionUpdatedAt(ctx, sessionId);
    return { documents };
  },
});

export const applyApprovedSectionRecords = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!isImportSession(session)) return { total: 0, byKind: {} };
    const records = await sessionRecords(ctx, session.societyId, sessionId);
    const sourceCatalog = sourceCatalogForRecords(records);
    const sectionRecords = records.filter(
      (record) =>
        SECTION_RECORD_KINDS.includes(record.recordKind) &&
        record.status === "Approved" &&
        !record.importedTargets?.sections,
    );

    const byKind: Record<string, number> = {};
    let total = 0;
    for (const record of sectionRecords) {
      const sourceDocumentIds = await ensureImportSourceDocuments(
        ctx,
        session.societyId,
        unique([...(record.sourceExternalIds ?? []), ...(record.payload?.sourceExternalIds ?? [])]),
        "Imported Source",
        `Source placeholder created while applying ${record.recordKind} from ${hydrateSession(session).name}. Pull or review the original source document before publishing content.`,
        sourceCatalog,
      );
      const promotionIssues = await importPromotionIssues(ctx, session.societyId, record);
      if (promotionIssues.length > 0) {
        await patchRecordPromotionBlocked(ctx, record, promotionIssues);
        byKind[`${record.recordKind}:blocked`] = (byKind[`${record.recordKind}:blocked`] ?? 0) + 1;
        continue;
      }
      const target = await insertSectionRecord(ctx, session.societyId, record, sourceDocumentIds);
      if (record.recordKind !== "sourceEvidence") {
        await insertSourceEvidenceForAppliedRecord(ctx, session.societyId, record, target, sourceDocumentIds);
      }
      await patchRecordImportTarget(ctx, record, "sections", target);
      byKind[record.recordKind] = (byKind[record.recordKind] ?? 0) + 1;
      total += 1;
    }

    await patchSessionUpdatedAt(ctx, sessionId);
    return { total, byKind };
  },
});
