import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  backfillFromSourceEvidencePortable,
  bulkSetStatusPortable,
  countForRecordPortable,
  coveragePortable,
  createPortable,
  forRecordPortable,
  getPortable,
  linkAffectedPortable,
  listPortable,
  recordPreflightPortable,
  removePortable,
  setStatusPortable,
  summaryPortable,
} from "../shared/functions/representationGaps";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { gapLocatorValidator } from "./validators/gaps";

export const list = authorizedQuery("representationGaps:list", query)({
  args: { societyId: v.id("societies"), status: v.optional(v.string()), infoType: v.optional(v.string()), reason: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = authorizedQuery("representationGaps:get", query)({
  args: { id: v.id("representationGaps") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const summary = authorizedQuery("representationGaps:summary", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => summaryPortable(await toPortableQueryCtx(ctx), args),
});

export const forRecord = authorizedQuery("representationGaps:forRecord", query)({
  args: { societyId: v.id("societies"), affectedTable: v.string(), affectedId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => forRecordPortable(await toPortableQueryCtx(ctx), args),
});

export const coverage = authorizedQuery("representationGaps:coverage", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => coveragePortable(await toPortableQueryCtx(ctx), args),
});

export const countForRecord = authorizedQuery("representationGaps:countForRecord", query)({
  args: { societyId: v.id("societies"), affectedTable: v.string(), affectedId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => countForRecordPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("representationGaps:create", mutation)({
  args: {
    societyId: v.id("societies"),
    infoType: v.string(),
    reason: v.string(),
    status: v.optional(v.string()),
    origin: v.optional(v.string()),
    title: v.optional(v.string()),
    sourceDocumentId: v.optional(v.id("documents")),
    sourceExternalId: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    locator: v.optional(gapLocatorValidator),
    excerpt: v.optional(v.string()),
    observedDate: v.optional(v.string()),
    bodyKey: v.optional(v.string()),
    affectedTable: v.optional(v.string()),
    affectedId: v.optional(v.string()),
    proposedTargetTable: v.optional(v.string()),
    proposedField: v.optional(v.string()),
    proposedValue: v.optional(v.any()),
    sensitivity: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const setStatus = authorizedMutation("representationGaps:setStatus", mutation)({
  args: { id: v.id("representationGaps"), status: v.string(), note: v.optional(v.string()), resolvedTable: v.optional(v.string()), resolvedId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => setStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const bulkSetStatus = authorizedMutation("representationGaps:bulkSetStatus", mutation)({
  args: {
    societyId: v.id("societies"),
    status: v.string(),
    note: v.optional(v.string()),
    ids: v.optional(v.array(v.id("representationGaps"))),
    infoType: v.optional(v.string()),
    reason: v.optional(v.string()),
    fromStatus: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => bulkSetStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const linkAffected = authorizedMutation("representationGaps:linkAffected", mutation)({
  args: { id: v.id("representationGaps"), affectedTable: v.string(), affectedId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => linkAffectedPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("representationGaps:remove", mutation)({
  args: { id: v.id("representationGaps") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

export const recordPreflight = authorizedMutation("representationGaps:recordPreflight", mutation)({
  args: { societyId: v.id("societies"), bundle: v.any(), importSessionId: v.optional(v.id("documents")) },
  returns: v.any(),
  handler: async (ctx, args) => recordPreflightPortable(await toPortableMutationCtx(ctx), args),
});

export const backfillFromSourceEvidence = authorizedMutation("representationGaps:backfillFromSourceEvidence", mutation)({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => backfillFromSourceEvidencePortable(await toPortableMutationCtx(ctx), args),
});
