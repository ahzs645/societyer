// @ts-nocheck
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  overviewPortable,
  matchPortable,
  markManualPortable,
  addManualTransactionPortable,
  unmatchPortable,
  periodsPortable,
  startPeriodPortable,
  updatePeriodPortable,
  completePeriodPortable,
  reopenPeriodPortable,
  removePeriodPortable,
} from "../shared/functions/reconciliation";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Returns every bank transaction with reconciliation status, plus a candidate
 * list of internal records (filings, donation receipts, employee payroll) that
 * could match each unreconciled line. Matching is heuristic — exact amount
 * within ±7 days for cash records, then string-similarity on counterparty.
 */
export const overview = authorizedQuery("reconciliation:overview", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => overviewPortable(await toPortableQueryCtx(ctx), args),
});

export const match = authorizedMutation("reconciliation:match", mutation)({
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

export const markManual = authorizedMutation("reconciliation:markManual", mutation)({
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
export const addManualTransaction = authorizedMutation("reconciliation:addManualTransaction", mutation)({
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

export const unmatch = authorizedMutation("reconciliation:unmatch", mutation)({
  args: { txnId: v.id("financialTransactions") },
  returns: v.any(),
  handler: async (ctx, args) => unmatchPortable(await toPortableMutationCtx(ctx), args),
});

// Statement reconciliation periods: per bank account, statement start/end
// dates, beginning/ending balances and an in_progress → completed lifecycle.
// Closed periods whose lines later change read "out_of_balance".
export const periods = authorizedQuery("reconciliation:periods", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => periodsPortable(await toPortableQueryCtx(ctx), args),
});

export const startPeriod = authorizedMutation("reconciliation:startPeriod", mutation)({
  args: {
    societyId: v.id("societies"),
    accountId: v.id("financialAccounts"),
    startDate: v.optional(v.string()),
    endDate: v.string(),
    endingBalanceCents: v.number(),
    openingBalanceCents: v.optional(v.number()),
    statementDocumentId: v.optional(v.id("documents")),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => startPeriodPortable(await toPortableMutationCtx(ctx), args),
});

export const updatePeriod = authorizedMutation("reconciliation:updatePeriod", mutation)({
  args: {
    id: v.id("reconciliationPeriods"),
    endingBalanceCents: v.optional(v.number()),
    openingBalanceCents: v.optional(v.number()),
    statementDocumentId: v.optional(v.id("documents")),
    clearStatementDocument: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePeriodPortable(await toPortableMutationCtx(ctx), args),
});

export const completePeriod = authorizedMutation("reconciliation:completePeriod", mutation)({
  args: { id: v.id("reconciliationPeriods") },
  returns: v.any(),
  handler: async (ctx, args) => completePeriodPortable(await toPortableMutationCtx(ctx), args),
});

export const reopenPeriod = authorizedMutation("reconciliation:reopenPeriod", mutation)({
  args: { id: v.id("reconciliationPeriods") },
  returns: v.any(),
  handler: async (ctx, args) => reopenPeriodPortable(await toPortableMutationCtx(ctx), args),
});

export const removePeriod = authorizedMutation("reconciliation:removePeriod", mutation)({
  args: { id: v.id("reconciliationPeriods") },
  returns: v.any(),
  handler: async (ctx, args) => removePeriodPortable(await toPortableMutationCtx(ctx), args),
});
