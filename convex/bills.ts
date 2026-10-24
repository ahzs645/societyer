import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  workspacePortable,
  upsertPortable,
  submitPortable,
  recallPortable,
  decidePortable,
  bulkApprovePortable,
  setSchedulePortable,
  recordPaymentPortable,
  recordAdjustmentPortable,
  reverseAdjustmentPortable,
  removePaymentPortable,
  markPaidPortable,
  cancelPortable,
  removePortable,
  attachDocumentPortable,
  upsertVendorPortable,
} from "../shared/functions/bills";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

// Lines arrive from the bill drawer; the handler normalises and validates them.
const clientLineValidator = v.object({
  key: v.optional(v.string()),
  accountId: v.optional(v.id("financialAccounts")),
  amountCents: v.number(),
  memo: v.optional(v.string()),
  fundRestrictionId: v.optional(v.id("fundRestrictions")),
  tagIds: v.optional(v.array(v.id("financeTags"))),
});

export const workspace = authorizedQuery("bills:workspace", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => workspacePortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = authorizedMutation("bills:upsert", mutation)({
  args: {
    id: v.optional(v.id("bills")),
    societyId: v.id("societies"),
    billNumber: v.optional(v.string()),
    vendorId: v.optional(v.id("accountingCounterparties")),
    billDate: v.string(),
    terms: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    currency: v.optional(v.string()),
    lines: v.array(clientLineValidator),
    notes: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    source: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

export const submit = authorizedMutation("bills:submit", mutation)({
  args: { id: v.id("bills") },
  returns: v.any(),
  handler: async (ctx, args) => submitPortable(await toPortableMutationCtx(ctx), args),
});

export const recall = authorizedMutation("bills:recall", mutation)({
  args: { id: v.id("bills") },
  returns: v.any(),
  handler: async (ctx, args) => recallPortable(await toPortableMutationCtx(ctx), args),
});

export const decide = authorizedMutation("bills:decide", mutation)({
  args: { id: v.id("bills"), decision: v.string(), reason: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => decidePortable(await toPortableMutationCtx(ctx), args),
});

export const bulkApprove = authorizedMutation("bills:bulkApprove", mutation)({
  args: { societyId: v.id("societies"), ids: v.array(v.id("bills")) },
  returns: v.any(),
  handler: async (ctx, args) => bulkApprovePortable(await toPortableMutationCtx(ctx), args),
});

export const setSchedule = authorizedMutation("bills:setSchedule", mutation)({
  args: { id: v.id("bills"), scheduledDate: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => setSchedulePortable(await toPortableMutationCtx(ctx), args),
});

export const recordPayment = authorizedMutation("bills:recordPayment", mutation)({
  args: {
    id: v.id("bills"),
    date: v.string(),
    amountCents: v.number(),
    method: v.string(),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    cashAccountId: v.optional(v.id("financialAccounts")),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordPaymentPortable(await toPortableMutationCtx(ctx), args),
});

// The payment is addressed by its key inside the bill (named `paymentKey`, not an id: it is not a row).
export const removePayment = authorizedMutation("bills:removePayment", mutation)({
  args: { id: v.id("bills"), paymentKey: v.string(), date: v.optional(v.string()), reason: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => removePaymentPortable(await toPortableMutationCtx(ctx), args),
});

export const markPaid = authorizedMutation("bills:markPaid", mutation)({
  args: {
    societyId: v.id("societies"),
    ids: v.array(v.id("bills")),
    date: v.string(),
    method: v.string(),
    cashAccountId: v.id("financialAccounts"),
    reference: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => markPaidPortable(await toPortableMutationCtx(ctx), args),
});

export const cancel = authorizedMutation("bills:cancel", mutation)({
  args: { societyId: v.id("societies"), ids: v.array(v.id("bills")), reason: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => cancelPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("bills:remove", mutation)({
  args: { id: v.id("bills") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

export const attachDocument = authorizedMutation("bills:attachDocument", mutation)({
  args: { id: v.id("bills"), documentId: v.optional(v.id("documents")) },
  returns: v.any(),
  handler: async (ctx, args) => attachDocumentPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertVendor = authorizedMutation("bills:upsertVendor", mutation)({
  args: {
    id: v.optional(v.id("accountingCounterparties")),
    societyId: v.id("societies"),
    name: v.string(),
    email: v.optional(v.string()),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    taxIdentifier: v.optional(v.string()),
    defaultAccountId: v.optional(v.id("financialAccounts")),
    defaultTerms: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    paymentDetails: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertVendorPortable(await toPortableMutationCtx(ctx), args),
});

export const recordAdjustment = authorizedMutation("bills:recordAdjustment", mutation)({args:{id:v.id("bills"),kind:v.union(v.literal("credit"),v.literal("write_off"),v.literal("refund")),date:v.string(),amountCents:v.number(),reason:v.string(),idempotencyKey:v.string(),adjustmentAccountId:v.optional(v.id("financialAccounts")),sourcePaymentKey:v.optional(v.string()),cashAccountId:v.optional(v.id("financialAccounts")),reference:v.optional(v.string())},returns:v.string(),handler:async(ctx,args)=>recordAdjustmentPortable(await toPortableMutationCtx(ctx),args)});
export const reverseAdjustment = authorizedMutation("bills:reverseAdjustment", mutation)({args:{id:v.id("bills"),paymentKey:v.string(),date:v.string(),reason:v.string()},returns:v.string(),handler:async(ctx,args)=>reverseAdjustmentPortable(await toPortableMutationCtx(ctx),args)});
