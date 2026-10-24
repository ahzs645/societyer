import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import {
  remittancePlanFieldsValidator,
  remittanceReadinessFieldsValidator,
} from "./tables/payrollRemittance";
import * as handlers from "../shared/functions/payrollRemittance";
const societyId = v.id("societies"),
  id = v.id("payrollRemittancePlans");
export const workspace = authorizedQuery(
  "payrollRemittance:workspace",
  query,
)({
  args: {
    societyId,
    collection: v.union(
      v.literal("obligations"),
      v.literal("plans"),
      v.literal("settlements"),
      v.literal("banks"),
      v.literal("transactions"),
      v.literal("liabilities"),
      v.literal("expenses"),
      v.literal("credentials"),
      v.literal("readiness"),
      v.literal("plan"),
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
    id: v.optional(id),
    bankAccountId: v.optional(v.id("financialAccounts")),
  },
  returns: v.any(),
  handler: async (ctx, args) =>
    handlers.workspacePortable(await toPortableQueryCtx(ctx), args),
});
export const preview = authorizedQuery(
  "payrollRemittance:preview",
  query,
)({
  args: { societyId, obligationId: v.id("payrollRemittances") },
  returns: v.any(),
  handler: async (ctx, args) =>
    handlers.previewPortable(await toPortableQueryCtx(ctx), args),
});
export const saveDraft = authorizedMutation(
  "payrollRemittance:saveDraft",
  mutation,
)({
  args: {
    societyId,
    id: v.optional(id),
    expectedVersion: v.optional(v.number()),
    fields: remittancePlanFieldsValidator,
  },
  returns: id,
  handler: async (ctx, args) =>
    handlers.saveDraftPortable(await toPortableMutationCtx(ctx), args),
});
export const approve = authorizedMutation(
  "payrollRemittance:approve",
  mutation,
)({
  args: { societyId, id, expectedVersion: v.number() },
  returns: id,
  handler: async (ctx, args) =>
    handlers.approvePortable(await toPortableMutationCtx(ctx), args),
});
export const recordPreparedExport = authorizedMutation(
  "payrollRemittance:recordPreparedExport",
  mutation,
)({
  args: { societyId, id, expectedVersion: v.number() },
  returns: v.string(),
  handler: async (ctx, args) =>
    handlers.recordPreparedExportPortable(
      await toPortableMutationCtx(ctx),
      args,
    ),
});
export const recordManualSubmission = authorizedMutation(
  "payrollRemittance:recordManualSubmission",
  mutation,
)({
  args: { societyId, id, expectedVersion: v.number(), reference: v.string() },
  returns: id,
  handler: async (ctx, args) =>
    handlers.recordManualSubmissionPortable(
      await toPortableMutationCtx(ctx),
      args,
    ),
});
export const reject = authorizedMutation(
  "payrollRemittance:reject",
  mutation,
)({
  args: { societyId, id, expectedVersion: v.number(), reason: v.string() },
  returns: id,
  handler: async (ctx, args) =>
    handlers.rejectPortable(await toPortableMutationCtx(ctx), args),
});
export const reconcilePayment = authorizedMutation(
  "payrollRemittance:reconcilePayment",
  mutation,
)({
  args: {
    societyId,
    id,
    date: v.string(),
    amountCents: v.number(),
    evidence: v.string(),
    destinationConfirmed: v.boolean(),
    idempotencyKey: v.string(),
    transactionId: v.optional(v.id("financialTransactions")),
    craConfirmationNumber: v.optional(v.string()),
    postToLedger: v.boolean(),
  },
  returns: v.id("payrollRemittanceSettlements"),
  handler: async (ctx, args) =>
    handlers.reconcilePaymentPortable(await toPortableMutationCtx(ctx), args),
});
export const saveReadiness = authorizedMutation(
  "payrollRemittance:saveReadiness",
  mutation,
)({
  args: { societyId, fields: remittanceReadinessFieldsValidator },
  returns: v.id("payrollRemittanceReadiness"),
  handler: async (ctx, args) =>
    handlers.saveReadinessPortable(await toPortableMutationCtx(ctx), args),
});
export const confirmLegacyAccount = authorizedMutation(
  "payrollRemittance:confirmLegacyAccount",
  mutation,
)({
  args: {
    societyId,
    obligationId: v.id("payrollRemittances"),
    payrollAccountNumber: v.string(),
    evidence: v.string(),
  },
  returns: v.id("payrollRemittances"),
  handler: async (ctx, args) =>
    handlers.confirmLegacyAccountPortable(
      await toPortableMutationCtx(ctx),
      args,
    ),
});
