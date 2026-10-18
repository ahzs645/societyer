import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { savePortable, journalPortable, assignTagPortable } from "../shared/functions/transactionLines";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { transactionLineValidator } from "./tables/financeTags";

// Line items (splits), tags and the journal entry of one bank transaction.
export const save = authorizedMutation("transactionLines:save", mutation)({
  args: {
    id: v.id("financialTransactions"),
    lines: v.array(transactionLineValidator),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => savePortable(await toPortableMutationCtx(ctx), args),
});

export const journal = authorizedQuery("transactionLines:journal", query)({
  args: { id: v.id("financialTransactions") },
  returns: v.any(),
  handler: async (ctx, args) => journalPortable(await toPortableQueryCtx(ctx), args),
});

// Assign a tag to every line of the selected transactions, or clear a group's tag (tagId null).
export const assignTag = authorizedMutation("transactionLines:assignTag", mutation)({
  args: {
    societyId: v.id("societies"),
    ids: v.array(v.id("financialTransactions")),
    tagId: v.union(v.id("financeTags"), v.null()),
    groupId: v.optional(v.id("financeTagGroups")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => assignTagPortable(await toPortableMutationCtx(ctx), args),
});
