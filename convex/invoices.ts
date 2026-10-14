import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  workspacePortable,
  upsertPortable,
  markSentPortable,
  voidInvoicesPortable,
  restoreVoidedPortable,
  duplicatePortable,
  removePortable,
  recordPaymentPortable,
  removePaymentPortable,
  revertToUnpaidPortable,
  sendRemindersPortable,
  billMemberDuesPortable,
  generateDuesInvoicesPortable,
  undoDuesBatchPortable,
  upsertCatalogItemPortable,
  setCatalogItemActivePortable,
  removeCatalogItemPortable,
  upsertSeriesPortable,
  setSeriesStatusPortable,
  issueFromSeriesPortable,
  saveSettingsPortable,
} from "../shared/functions/invoices";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { invoiceDiscountValidator } from "./tables/invoices";

// Lines arrive from the builder; the handler normalises and validates them.
const clientLineValidator = v.object({
  key: v.optional(v.string()),
  catalogItemId: v.optional(v.id("invoiceCatalogItems")),
  item: v.string(),
  description: v.optional(v.string()),
  quantity: v.number(),
  unitPriceCents: v.number(),
  taxRatePercent: v.optional(v.number()),
  taxLabel: v.optional(v.string()),
});

const partyArgs = {
  partyKind: v.string(),
  memberId: v.optional(v.id("members")),
  counterpartyId: v.optional(v.id("accountingCounterparties")),
  billToName: v.string(),
  billToEmail: v.optional(v.string()),
  billToAddress: v.optional(v.string()),
};

export const workspace = authorizedQuery("invoices:workspace", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => workspacePortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = authorizedMutation("invoices:upsert", mutation)({
  args: {
    id: v.optional(v.id("invoices")),
    societyId: v.id("societies"),
    ...partyArgs,
    issueDate: v.string(),
    terms: v.string(),
    dueDate: v.optional(v.string()),
    reference: v.optional(v.string()),
    currency: v.optional(v.string()),
    lines: v.array(clientLineValidator),
    discount: v.optional(invoiceDiscountValidator),
    memo: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

export const markSent = authorizedMutation("invoices:markSent", mutation)({
  args: { societyId: v.id("societies"), ids: v.array(v.id("invoices")), draftEmail: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, args) => markSentPortable(await toPortableMutationCtx(ctx), args),
});

export const voidInvoices = authorizedMutation("invoices:voidInvoices", mutation)({
  args: { societyId: v.id("societies"), ids: v.array(v.id("invoices")), reason: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => voidInvoicesPortable(await toPortableMutationCtx(ctx), args),
});

export const restoreVoided = authorizedMutation("invoices:restoreVoided", mutation)({
  args: { id: v.id("invoices") },
  returns: v.any(),
  handler: async (ctx, args) => restoreVoidedPortable(await toPortableMutationCtx(ctx), args),
});

export const duplicate = authorizedMutation("invoices:duplicate", mutation)({
  args: { id: v.id("invoices") },
  returns: v.any(),
  handler: async (ctx, args) => duplicatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("invoices:remove", mutation)({
  args: { id: v.id("invoices") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

export const recordPayment = authorizedMutation("invoices:recordPayment", mutation)({
  args: {
    id: v.id("invoices"),
    date: v.string(),
    amountCents: v.number(),
    method: v.string(),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    financialTransactionId: v.optional(v.id("financialTransactions")),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordPaymentPortable(await toPortableMutationCtx(ctx), args),
});

export const removePayment = authorizedMutation("invoices:removePayment", mutation)({
  args: { id: v.id("invoices"), paymentKey: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => removePaymentPortable(await toPortableMutationCtx(ctx), args),
});

export const revertToUnpaid = authorizedMutation("invoices:revertToUnpaid", mutation)({
  args: { id: v.id("invoices") },
  returns: v.any(),
  handler: async (ctx, args) => revertToUnpaidPortable(await toPortableMutationCtx(ctx), args),
});

export const sendReminders = authorizedMutation("invoices:sendReminders", mutation)({
  args: { societyId: v.id("societies"), ids: v.array(v.id("invoices")) },
  returns: v.any(),
  handler: async (ctx, args) => sendRemindersPortable(await toPortableMutationCtx(ctx), args),
});

export const billMemberDues = authorizedMutation("invoices:billMemberDues", mutation)({
  args: { societyId: v.id("societies"), memberId: v.id("members") },
  returns: v.any(),
  handler: async (ctx, args) => billMemberDuesPortable(await toPortableMutationCtx(ctx), args),
});

export const generateDuesInvoices = authorizedMutation("invoices:generateDuesInvoices", mutation)({
  args: { societyId: v.id("societies"), subscriptionIds: v.array(v.id("memberSubscriptions")) },
  returns: v.any(),
  handler: async (ctx, args) => generateDuesInvoicesPortable(await toPortableMutationCtx(ctx), args),
});

// The batch key is opaque (named `batch`, not `batchId`): it is not a row reference.
export const undoDuesBatch = authorizedMutation("invoices:undoDuesBatch", mutation)({
  args: { societyId: v.id("societies"), batch: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => undoDuesBatchPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertCatalogItem = authorizedMutation("invoices:upsertCatalogItem", mutation)({
  args: {
    id: v.optional(v.id("invoiceCatalogItems")),
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    unitPriceCents: v.number(),
    taxRatePercent: v.optional(v.number()),
    taxLabel: v.optional(v.string()),
    category: v.optional(v.string()),
    accountingAccountId: v.optional(v.id("financialAccounts")),
    active: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertCatalogItemPortable(await toPortableMutationCtx(ctx), args),
});

export const setCatalogItemActive = authorizedMutation("invoices:setCatalogItemActive", mutation)({
  args: { id: v.id("invoiceCatalogItems"), active: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => setCatalogItemActivePortable(await toPortableMutationCtx(ctx), args),
});

export const removeCatalogItem = authorizedMutation("invoices:removeCatalogItem", mutation)({
  args: { id: v.id("invoiceCatalogItems") },
  returns: v.any(),
  handler: async (ctx, args) => removeCatalogItemPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertSeries = authorizedMutation("invoices:upsertSeries", mutation)({
  args: {
    id: v.optional(v.id("invoiceSeries")),
    societyId: v.id("societies"),
    name: v.string(),
    frequency: v.string(),
    startDate: v.string(),
    endKind: v.string(),
    endAfterCount: v.optional(v.number()),
    endDate: v.optional(v.string()),
    autoSend: v.optional(v.boolean()),
    ...partyArgs,
    terms: v.string(),
    reference: v.optional(v.string()),
    currency: v.optional(v.string()),
    lines: v.array(clientLineValidator),
    discount: v.optional(invoiceDiscountValidator),
    memo: v.optional(v.string()),
    fromInvoiceId: v.optional(v.id("invoices")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertSeriesPortable(await toPortableMutationCtx(ctx), args),
});

export const setSeriesStatus = authorizedMutation("invoices:setSeriesStatus", mutation)({
  args: { id: v.id("invoiceSeries"), status: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => setSeriesStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const issueFromSeries = authorizedMutation("invoices:issueFromSeries", mutation)({
  args: { id: v.id("invoiceSeries") },
  returns: v.any(),
  handler: async (ctx, args) => issueFromSeriesPortable(await toPortableMutationCtx(ctx), args),
});

export const saveSettings = authorizedMutation("invoices:saveSettings", mutation)({
  args: {
    societyId: v.id("societies"),
    prefix: v.string(),
    nextNumber: v.number(),
    defaultTerms: v.string(),
    paymentInstructions: v.optional(v.string()),
    defaultMemo: v.optional(v.string()),
    replyToEmail: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => saveSettingsPortable(await toPortableMutationCtx(ctx), args),
});
