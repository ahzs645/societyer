import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  overviewPortable,
  createManualAccountPortable,
  updateAccountPortable,
  linkLedgerAccountPortable,
  setArchivedPortable,
} from "../shared/functions/bankAccounts";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

// The Accounts page: money accounts with their source, feed health, balance
// and linked ledger account.
export const overview = authorizedQuery("bankAccounts:overview", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => overviewPortable(await toPortableQueryCtx(ctx), args),
});

// Add a manual account; it becomes its own ledger account under the next free chart code.
export const createManualAccount = authorizedMutation("bankAccounts:createManualAccount", mutation)({
  args: {
    societyId: v.id("societies"),
    name: v.string(),
    kind: v.union(v.literal("bank"), v.literal("credit"), v.literal("payments"), v.literal("cash")),
    openingBalanceCents: v.number(),
    openingDate: v.string(),
    institution: v.optional(v.string()),
    lastFour: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createManualAccountPortable(await toPortableMutationCtx(ctx), args),
});

export const updateAccount = authorizedMutation("bankAccounts:updateAccount", mutation)({
  args: {
    id: v.id("financialAccounts"),
    name: v.optional(v.string()),
    institution: v.optional(v.string()),
    lastFour: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateAccountPortable(await toPortableMutationCtx(ctx), args),
});

export const linkLedgerAccount = authorizedMutation("bankAccounts:linkLedgerAccount", mutation)({
  args: {
    id: v.id("financialAccounts"),
    ledgerAccountId: v.optional(v.id("financialAccounts")),
    createLedgerAccount: v.optional(v.boolean()),
    unlink: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => linkLedgerAccountPortable(await toPortableMutationCtx(ctx), args),
});

export const setArchived = authorizedMutation("bankAccounts:setArchived", mutation)({
  args: { id: v.id("financialAccounts"), archived: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => setArchivedPortable(await toPortableMutationCtx(ctx), args),
});
