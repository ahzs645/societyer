import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  createPortable,
  signPortable,
  markFailedPortable,
  removePortable,
  previewPortable,
  recordNoticePortable,
} from "../shared/functions/writtenResolutions";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const body = v.optional(v.union(v.literal("members"), v.literal("shareholders"), v.literal("directors")));
const kind = v.union(v.literal("Ordinary"), v.literal("Special"));
const specialMajority = v.optional(v.union(v.literal("two_thirds"), v.literal("three_quarters")));

export const preview = authorizedQuery("writtenResolutions:preview", query)({
  args: { societyId: v.id("societies"), body, kind: v.optional(kind), recordDateISO: v.optional(v.string()), specialMajority },
  returns: v.any(),
  handler: async (ctx, args) => previewPortable(await toPortableQueryCtx(ctx), args),
});

export const list = authorizedQuery("writtenResolutions:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("writtenResolutions:create", mutation)({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    text: v.string(),
    kind,
    body,
    recordDateISO: v.optional(v.string()),
    specialMajority,
    requiredCount: v.optional(v.number()),
    governingInstrumentEvidence: v.string(),
    electorateEvidence: v.string(),
    circulationEvidence: v.string(),
    circulatedAtISO: v.string(),
    authorityReviewed: v.boolean(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const sign = authorizedMutation("writtenResolutions:sign", mutation)({
  args: {
    id: v.id("writtenResolutions"),
    electorKey: v.string(),
    signedAtISO: v.string(),
    consentEvidence: v.string(),
    consentDocumentId: v.optional(v.id("documents")),
    signerName: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
  },
  returns: v.any(),
  handler: async (ctx, args) => signPortable(await toPortableMutationCtx(ctx), args),
});

export const recordNotice = authorizedMutation("writtenResolutions:recordNotice", mutation)({
  args: { id: v.id("writtenResolutions"),
    notices: v.array(v.object({ electorKey: v.string(), givenAtISO: v.string(), evidence: v.string(), documentId: v.optional(v.id("documents")) })),
    dueDateISO: v.optional(v.string()), calendarEvidence: v.optional(v.string()),
    timeZone: v.optional(v.union(v.literal("America/Toronto"), v.literal("America/Winnipeg"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordNoticePortable(await toPortableMutationCtx(ctx), args),
});

export const markFailed = authorizedMutation("writtenResolutions:markFailed", mutation)({
  args: { id: v.id("writtenResolutions"), note: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => markFailedPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("writtenResolutions:remove", mutation)({
  args: { id: v.id("writtenResolutions") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
