// @ts-nocheck
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  overviewPortable,
  matchPortable,
  markManualPortable,
  addManualTransactionPortable,
  unmatchPortable,
} from "../shared/functions/reconciliation";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Returns every bank transaction with reconciliation status, plus a candidate
 * list of internal records (filings, donation receipts, employee payroll) that
 * could match each unreconciled line. Matching is heuristic — exact amount
 * within ±7 days for cash records, then string-similarity on counterparty.
 */
export const overview = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => overviewPortable(await toPortableQueryCtx(ctx), args),
});

export const match = mutation({
  args: {
    txnId: v.id("financialTransactions"),
    matchedKind: v.string(),
    matchedId: v.string(),
    note: v.optional(v.string()),
    actor: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => matchPortable(await toPortableMutationCtx(ctx), args),
});

export const markManual = mutation({
  args: {
    txnId: v.id("financialTransactions"),
    note: v.string(),
    actor: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => markManualPortable(await toPortableMutationCtx(ctx), args),
});

// Manually add a bank transaction so reconciliation is usable without a Wave/
// browser-connector sync. Ensures a "manual" connection + bank account exist
// (created once) so the financialTransactions row has the required references.
export const addManualTransaction = mutation({
  args: {
    societyId: v.id("societies"),
    date: v.string(),
    description: v.string(),
    amountCents: v.number(),
    counterparty: v.optional(v.string()),
    category: v.optional(v.string()),
    accountId: v.optional(v.id("financialAccounts")),
  },
  returns: v.any(),
  handler: async (ctx, args) => addManualTransactionPortable(await toPortableMutationCtx(ctx), args),
});

export const unmatch = mutation({
  args: { txnId: v.id("financialTransactions") },
  returns: v.any(),
  handler: async (ctx, args) => unmatchPortable(await toPortableMutationCtx(ctx), args),
});
