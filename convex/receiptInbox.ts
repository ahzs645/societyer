import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  addPortable,
  updatePortable,
  confirmMatchPortable,
  unmatchPortable,
  setDiscardedPortable,
  matchAllHighConfidencePortable,
} from "../shared/functions/receiptInbox";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

// Receipt inbox: uploaded receipt documents with suggested bank transactions.
export const list = authorizedQuery("receiptInbox:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const add = authorizedMutation("receiptInbox:add", mutation)({
  args: {
    societyId: v.id("societies"),
    items: v.array(v.object({
      documentId: v.id("documents"),
      fileName: v.string(),
      merchant: v.optional(v.string()),
      amountCents: v.optional(v.number()),
      date: v.optional(v.string()),
    })),
  },
  returns: v.any(),
  handler: async (ctx, args) => addPortable(await toPortableMutationCtx(ctx), args),
});

export const update = authorizedMutation("receiptInbox:update", mutation)({
  args: {
    id: v.id("receiptInboxItems"),
    merchant: v.optional(v.union(v.string(), v.null())),
    amountCents: v.optional(v.union(v.number(), v.null())),
    date: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

// Attaches the receipt through the same logic as the transaction panel.
export const confirmMatch = authorizedMutation("receiptInbox:confirmMatch", mutation)({
  args: { id: v.id("receiptInboxItems"), transactionId: v.id("financialTransactions") },
  returns: v.any(),
  handler: async (ctx, args) => confirmMatchPortable(await toPortableMutationCtx(ctx), args),
});

export const unmatch = authorizedMutation("receiptInbox:unmatch", mutation)({
  args: { id: v.id("receiptInboxItems") },
  returns: v.any(),
  handler: async (ctx, args) => unmatchPortable(await toPortableMutationCtx(ctx), args),
});

export const setDiscarded = authorizedMutation("receiptInbox:setDiscarded", mutation)({
  args: { id: v.id("receiptInboxItems"), discarded: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => setDiscardedPortable(await toPortableMutationCtx(ctx), args),
});

export const matchAllHighConfidence = authorizedMutation("receiptInbox:matchAllHighConfidence", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => matchAllHighConfidencePortable(await toPortableMutationCtx(ctx), args),
});
