import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { listPortable, optionsPortable, previewPortable, createPortable, setStatusPortable, removePortable, summaryPortable } from "../shared/functions/dividends";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const dividendStatus = v.union(v.literal("draft"), v.literal("declared"), v.literal("paid"), v.literal("cancelled"));

// Inputs shared by preview and create. Shares outstanding come from the share
// ledger at the record date when a class is linked; the manual count is a
// fallback for classes with no posted ledger rows.
const draftArgs = {
  societyId: v.id("societies"),
  declaredOn: v.string(),
  shareClass: v.optional(v.string()),
  rightsClassId: v.optional(v.id("rightsClasses")),
  // Decimal per-share amount in currency units ("0.0125"); never rounded.
  perShareAmount: v.optional(v.string()),
  // Legacy integer cents per share, used only when perShareAmount is absent.
  perShareCents: v.optional(v.number()),
  sharesOutstanding: v.optional(v.number()),
  currency: v.string(),
  recordDate: v.optional(v.string()),
  paymentDate: v.optional(v.string()),
  excludedClassIds: v.optional(v.array(v.id("rightsClasses"))),
};

export const list = authorizedQuery("dividends:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const options = authorizedQuery("dividends:options", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => optionsPortable(await toPortableQueryCtx(ctx), args),
});

export const preview = authorizedQuery("dividends:preview", query)({
  args: draftArgs,
  returns: v.any(),
  handler: async (ctx, args) => previewPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("dividends:create", mutation)({
  args: {
    ...draftArgs,
    status: v.optional(dividendStatus),
    solvencyConfirmedAt: v.optional(v.string()),
    solvencyBasis: v.optional(v.string()),
    declaredByResolutionId: v.optional(v.id("writtenResolutions")),
    // An independently keyed/imported total to cross-check against the
    // computed total (YCN "Record - Dividends" reconciliation, warning only).
    expectedTotalCents: v.optional(v.number()),
    notes: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const setStatus = authorizedMutation("dividends:setStatus", mutation)({
  args: {
    id: v.id("dividends"),
    status: dividendStatus,
    solvencyConfirmedAt: v.optional(v.string()),
    solvencyBasis: v.optional(v.string()),
    declaredByResolutionId: v.optional(v.id("writtenResolutions")),
    paymentDate: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => setStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("dividends:remove", mutation)({
  args: { id: v.id("dividends") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

export const summary = authorizedQuery("dividends:summary", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => summaryPortable(await toPortableQueryCtx(ctx), args),
});
