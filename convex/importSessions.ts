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
  applyApprovedDocumentsPortable,
  applyApprovedSectionRecordsPortable,
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
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const createFromBundle = mutation({
  args: {
    societyId: v.id("societies"),
    name: v.optional(v.string()),
    bundle: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => createFromBundlePortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => updateRecordPortable(await toPortableMutationCtx(ctx), args),
});

export const bulkSetStatus = mutation({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    recordIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => bulkSetStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const bulkSetStatusByKind = mutation({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    recordKinds: v.array(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => bulkSetStatusByKindPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => bulkSetStatusByFilterPortable(await toPortableMutationCtx(ctx), args),
});

export const refreshSessionSummaries = mutation({
  args: {
    societyId: v.id("societies"),
    sessionIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => refreshSessionSummariesPortable(await toPortableMutationCtx(ctx), args),
});

export const removeSession = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => removeSessionPortable(await toPortableMutationCtx(ctx), args),
});

export const applyApprovedToOrgHistory = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => applyApprovedToOrgHistoryPortable(await toPortableMutationCtx(ctx), args),
});

export const applyApprovedMeetings = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => applyApprovedMeetingsPortable(await toPortableMutationCtx(ctx), args),
});

export const backfillApprovedMeetingReferences = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => backfillApprovedMeetingReferencesPortable(await toPortableMutationCtx(ctx), args),
});

export const applyApprovedDocuments = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => applyApprovedDocumentsPortable(await toPortableMutationCtx(ctx), args),
});

export const applyApprovedSectionRecords = mutation({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => applyApprovedSectionRecordsPortable(await toPortableMutationCtx(ctx), args),
});
