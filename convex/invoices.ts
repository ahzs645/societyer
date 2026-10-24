import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  upsertTemplatePortable, upsertPriceListPortable, upsertRepairJobPortable, setRepairStatusPortable, invoiceRepairJobPortable,
  workspacePortable,
  documentTemplatesPortable,
  upsertPortable,
  markSentPortable,
  voidInvoicesPortable,
  restoreVoidedPortable,
  duplicatePortable,
  removePortable,
  recordPaymentPortable, recordAdjustmentPortable, reverseAdjustmentPortable, revaluePortable,
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
  linkDepositPortable,
  saveAccountMappingPortable,
  postingPreviewPortable,
  postExistingPortable,
} from "../shared/functions/invoices";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { invoiceMoneyValidator, invoiceDocumentExtrasValidator, invoiceTaxModeValidator } from "./tables/invoiceMoney";
import { invoiceTemplateValidator, invoicePriceEntryValidator, repairStatusValidator, invoiceDiscountValidator } from "./tables/invoices";

// Lines arrive from the builder; the handler normalises and validates them.
const clientLineValidator = v.object({
  key: v.optional(v.string()),
  catalogItemId: v.optional(v.id("invoiceCatalogItems")),
  item: v.string(),
  description: v.optional(v.string()),
  sku: v.optional(v.string()),
  taxMode: v.optional(invoiceTaxModeValidator), rateOverridden: v.optional(v.boolean()),
  imageUrl: v.optional(v.string()), manufacturer: v.optional(v.string()), partNumber: v.optional(v.string()), upc: v.optional(v.string()), ean: v.optional(v.string()), isbn: v.optional(v.string()), customField: v.optional(v.string()), batchNumber: v.optional(v.string()), serialNumbers: v.optional(v.array(v.string())),
  unit: v.optional(v.string()),
  quantity: v.number(),
  unitPriceCents: v.number(),
  taxRatePercent: v.optional(v.number()),
  taxLabel: v.optional(v.string()),
  tagIds: v.optional(v.array(v.id("financeTags"))),
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

export const documentTemplates = authorizedQuery("invoices:documentTemplates", query)({
  args: { societyId: v.id("societies"), templateId: v.optional(v.id("invoiceTemplates")) },
  returns: v.any(),
  handler: async (ctx, args) => documentTemplatesPortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = authorizedMutation("invoices:upsert", mutation)({
  args: {
    id: v.optional(v.id("invoices")),
    societyId: v.id("societies"),
    ...partyArgs,
    shipToName: v.optional(v.string()),
    shipToAddress: v.optional(v.string()),
    documentTemplate: v.optional(invoiceTemplateValidator),
    money: v.optional(invoiceMoneyValidator), documentExtras: v.optional(invoiceDocumentExtrasValidator),
    priceListId: v.optional(v.union(v.id("invoicePriceLists"), v.null())),
    repairJobId: v.optional(v.id("repairJobs")),
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
    idempotencyKey: v.optional(v.string()), fxRateMicros: v.optional(v.number()), fxSource: v.optional(v.string()),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    depositAccountId: v.optional(v.id("financialAccounts")),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordPaymentPortable(await toPortableMutationCtx(ctx), args),
});

export const recordAdjustment = authorizedMutation("invoices:recordAdjustment", mutation)({
  args: { id: v.id("invoices"), kind: v.union(v.literal("credit"), v.literal("write_off"), v.literal("refund")), date: v.string(), amountCents: v.number(), method: v.optional(v.string()), note: v.string(), reference: v.optional(v.string()), idempotencyKey: v.string(), sourcePaymentKey: v.optional(v.string()), fxRateMicros: v.optional(v.number()), fxSource: v.optional(v.string()), financialTransactionId: v.optional(v.id("financialTransactions")), depositAccountId: v.optional(v.id("financialAccounts")) },
  returns: v.any(), handler: async (ctx, args) => recordAdjustmentPortable(await toPortableMutationCtx(ctx), args),
});
export const reverseAdjustment = authorizedMutation("invoices:reverseAdjustment", mutation)({
  args: { id: v.id("invoices"), paymentKey: v.string(), date: v.optional(v.string()), reason: v.optional(v.string()) }, returns: v.any(), handler: async (ctx, args) => reverseAdjustmentPortable(await toPortableMutationCtx(ctx), args),
});
export const revalue = authorizedMutation("invoices:revalue", mutation)({
  args: { id: v.id("invoices"), date: v.string(), rateMicros: v.number(), source: v.string(), idempotencyKey: v.string() }, returns: v.any(), handler: async (ctx, args) => revaluePortable(await toPortableMutationCtx(ctx), args),
});

export const removePayment = authorizedMutation("invoices:removePayment", mutation)({
  args: { id: v.id("invoices"), paymentKey: v.string(), date: v.optional(v.string()), reason: v.optional(v.string()) },
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
    kind: v.optional(v.union(v.literal("item"), v.literal("service"))),
    sku: v.optional(v.string()),
    taxMode: v.optional(invoiceTaxModeValidator),
    imageUrl: v.optional(v.string()), manufacturer: v.optional(v.string()), partNumber: v.optional(v.string()), upc: v.optional(v.string()), ean: v.optional(v.string()), isbn: v.optional(v.string()), customField: v.optional(v.string()), batchNumber: v.optional(v.string()), serialNumbers: v.optional(v.array(v.string())), unit: v.optional(v.string()), currency: v.optional(v.string()),
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

// The payment is addressed by its key inside the invoice (named `paymentKey`, not an id: it is not a row).
export const linkDeposit = authorizedMutation("invoices:linkDeposit", mutation)({
  args: {
    id: v.id("invoices"),
    paymentKey: v.string(),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    depositAccountId: v.optional(v.id("financialAccounts")),
  },
  returns: v.any(),
  handler: async (ctx, args) => linkDepositPortable(await toPortableMutationCtx(ctx), args),
});

export const saveAccountMapping = authorizedMutation("invoices:saveAccountMapping", mutation)({
  args: {
    societyId: v.id("societies"),
    receivableAccountId: v.optional(v.id("financialAccounts")),
    taxPayableAccountId: v.optional(v.id("financialAccounts")),
    defaultRevenueAccountId: v.optional(v.id("financialAccounts")),
    depositAccountId: v.optional(v.id("financialAccounts")),
    categoryAccounts: v.array(v.object({ category: v.string(), accountId: v.optional(v.id("financialAccounts")) })),
    itemAccounts: v.optional(v.array(v.object({ catalogItemId: v.id("invoiceCatalogItems"), accountId: v.optional(v.id("financialAccounts")) }))),
  },
  returns: v.any(),
  handler: async (ctx, args) => saveAccountMappingPortable(await toPortableMutationCtx(ctx), args),
});

export const postingPreview = authorizedQuery("invoices:postingPreview", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => postingPreviewPortable(await toPortableQueryCtx(ctx), args),
});

export const postExisting = authorizedMutation("invoices:postExisting", mutation)({
  args: { societyId: v.id("societies"), ids: v.optional(v.array(v.id("invoices"))), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => postExistingPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertTemplate = authorizedMutation("invoices:upsertTemplate", mutation)({
  args: { societyId: v.id("societies"), id: v.optional(v.id("invoiceTemplates")), config: invoiceTemplateValidator, active: v.optional(v.boolean()), makeDefault: v.optional(v.boolean()) },
  returns: v.any(), handler: async (ctx, args) => upsertTemplatePortable(await toPortableMutationCtx(ctx), args),
});
export const upsertPriceList = authorizedMutation("invoices:upsertPriceList", mutation)({
  args: { societyId: v.id("societies"), id: v.optional(v.id("invoicePriceLists")), name: v.string(), currency: v.string(), active: v.optional(v.boolean()), entries: v.array(invoicePriceEntryValidator) },
  returns: v.any(), handler: async (ctx, args) => upsertPriceListPortable(await toPortableMutationCtx(ctx), args),
});
export const upsertRepairJob = authorizedMutation("invoices:upsertRepairJob", mutation)({
  args: { societyId: v.id("societies"), id: v.optional(v.id("repairJobs")), ...partyArgs, asset: v.string(), serialNumber: v.optional(v.string()), problem: v.string(), notes: v.optional(v.string()), receivedDate: v.string(), targetDate: v.optional(v.string()), currency: v.string(), lines: v.array(clientLineValidator) },
  returns: v.any(), handler: async (ctx, args) => upsertRepairJobPortable(await toPortableMutationCtx(ctx), args),
});
export const setRepairStatus = authorizedMutation("invoices:setRepairStatus", mutation)({
  args: { id: v.id("repairJobs"), status: repairStatusValidator },
  returns: v.any(), handler: async (ctx, args) => setRepairStatusPortable(await toPortableMutationCtx(ctx), args),
});
export const invoiceRepairJob = authorizedMutation("invoices:invoiceRepairJob", mutation)({
  args: { id: v.id("repairJobs") }, returns: v.any(),
  handler: async (ctx, args) => invoiceRepairJobPortable(await toPortableMutationCtx(ctx), args),
});
