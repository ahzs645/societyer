import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { listPortable, upsertPortable, setStatusPortable, removePortable } from "../shared/functions/expenseReports";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("expenseReports")),
    societyId: v.id("societies"),
    claimantName: v.string(),
    claimantUserId: v.optional(v.id("users")),
    title: v.string(),
    category: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    incurredAtISO: v.string(),
    submittedAtISO: v.optional(v.string()),
    status: v.string(),
    receiptDocumentId: v.optional(v.id("documents")),
    paymentReference: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertPortable(toPortableMutationCtx(ctx), args),
});

export const setStatus = mutation({
  args: {
    id: v.id("expenseReports"),
    status: v.string(),
    actingUserId: v.optional(v.id("users")),
    paymentReference: v.optional(v.string()),
    // When marking Paid, supplying both accounts posts the reimbursement to the
    // double-entry ledger (debit expense, credit the bank/cash account it was
    // paid from). Omit them to just record the payment without a journal entry.
    expenseAccountId: v.optional(v.id("financialAccounts")),
    bankAccountId: v.optional(v.id("financialAccounts")),
  },
  returns: v.any(),
  handler: (ctx, args) => setStatusPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("expenseReports") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
