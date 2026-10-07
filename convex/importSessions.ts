import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
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
  reviewQueuePortable,
  getRecordPortable,
  removalImpactPortable,
  pendingByTargetPortable,
} from "../shared/functions/importReviewQueue";
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

export const list = authorizedQuery("importSessions:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = authorizedQuery("importSessions:get", query)({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const createFromBundle = authorizedMutation("importSessions:createFromBundle", mutation)({
  args: {
    societyId: v.id("societies"),
    name: v.optional(v.string()),
    bundle: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => createFromBundlePortable(await toPortableMutationCtx(ctx), args),
});

export const updateRecord = authorizedMutation("importSessions:updateRecord", mutation)({
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

export const bulkSetStatus = authorizedMutation("importSessions:bulkSetStatus", mutation)({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    recordIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => bulkSetStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const bulkSetStatusByKind = authorizedMutation("importSessions:bulkSetStatusByKind", mutation)({
  args: {
    sessionId: v.id("documents"),
    status: v.string(),
    recordKinds: v.array(v.string()),
    sourceExternalIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => bulkSetStatusByKindPortable(await toPortableMutationCtx(ctx), args),
});

export const bulkSetStatusByFilter = authorizedMutation("importSessions:bulkSetStatusByFilter", mutation)({
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

export const refreshSessionSummaries = authorizedMutation("importSessions:refreshSessionSummaries", mutation)({
  args: {
    societyId: v.id("societies"),
    sessionIds: v.optional(v.array(v.id("documents"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => refreshSessionSummariesPortable(await toPortableMutationCtx(ctx), args),
});

export const removeSession = authorizedMutation("importSessions:removeSession", mutation)({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => removeSessionPortable(await toPortableMutationCtx(ctx), args),
});

export const applyApprovedToOrgHistory = authorizedMutation("importSessions:applyApprovedToOrgHistory", mutation)({
  args: { sessionId: v.id("documents"), recordIds: v.optional(v.array(v.id("documents"))) },
  returns: v.any(),
  handler: async (ctx, args) => applyApprovedToOrgHistoryPortable(await toPortableMutationCtx(ctx), args),
});

export const applyApprovedMeetings = authorizedMutation("importSessions:applyApprovedMeetings", mutation)({
  args: { sessionId: v.id("documents"), recordIds: v.optional(v.array(v.id("documents"))) },
  returns: v.any(),
  handler: async (ctx, args) => applyApprovedMeetingsPortable(await toPortableMutationCtx(ctx), args),
});

export const backfillApprovedMeetingReferences = authorizedMutation("importSessions:backfillApprovedMeetingReferences", mutation)({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => backfillApprovedMeetingReferencesPortable(await toPortableMutationCtx(ctx), args),
});

export const applyApprovedDocuments = authorizedMutation("importSessions:applyApprovedDocuments", mutation)({
  args: { sessionId: v.id("documents"), recordIds: v.optional(v.array(v.id("documents"))) },
  returns: v.any(),
  handler: async (ctx, args) => applyApprovedDocumentsPortable(await toPortableMutationCtx(ctx), args),
});

export const applyApprovedSectionRecords = authorizedMutation("importSessions:applyApprovedSectionRecords", mutation)({
  args: { sessionId: v.id("documents"), recordIds: v.optional(v.array(v.id("documents"))) },
  returns: v.any(),
  handler: async (ctx, args) => applyApprovedSectionRecordsPortable(await toPortableMutationCtx(ctx), args),
});

/* ------------------------- cross-session review queue ------------------------- */

export const reviewQueue = authorizedQuery("importSessions:reviewQueue", query)({
  args: {
    societyId: v.id("societies"),
    status: v.optional(v.string()),
    recordKind: v.optional(v.string()),
    targetModule: v.optional(v.string()),
    sessionId: v.optional(v.id("documents")),
    risk: v.optional(v.string()),
    source: v.optional(v.string()),
    search: v.optional(v.string()),
    sort: v.optional(v.string()),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => reviewQueuePortable(await toPortableQueryCtx(ctx), args),
});

export const getRecord = authorizedQuery("importSessions:getRecord", query)({
  args: { recordId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => getRecordPortable(await toPortableQueryCtx(ctx), args),
});

export const removalImpact = authorizedQuery("importSessions:removalImpact", query)({
  args: { sessionId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => removalImpactPortable(await toPortableQueryCtx(ctx), args),
});

export const pendingByTarget = authorizedQuery("importSessions:pendingByTarget", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => pendingByTargetPortable(await toPortableQueryCtx(ctx), args),
});
