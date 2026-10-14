import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  upsertPortable,
  setStatusPortable,
  removePortable,
  approvalQueuePortable,
  decidePortable,
  bulkApprovePortable,
  saveApprovalRulesPortable,
  saveApproverAccessPortable,
  saveClaimPolicyPortable,
  attachReceiptPortable,
  remindApproversPortable,
  setRulesChangeControlPortable,
  decidePolicyChangePortable,
} from "../shared/functions/expenseReports";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = authorizedQuery("expenseReports:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = authorizedMutation("expenseReports:upsert", mutation)({
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
    // Required to submit a claim that misses a blocking claim policy.
    policyExceptionReason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

export const setStatus = authorizedMutation("expenseReports:setStatus", mutation)({
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
    policyExceptionReason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => setStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("expenseReports:remove", mutation)({
  args: { id: v.id("expenseReports") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

// Approvals queue: every claim with its applicable approval rule, progress and
// whether the current person may approve it.
export const approvalQueue = authorizedQuery("expenseReports:approvalQueue", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => approvalQueuePortable(await toPortableQueryCtx(ctx), args),
});

// Approve (a vote under the approval rules) or decline (reason required).
export const decide = authorizedMutation("expenseReports:decide", mutation)({
  args: {
    id: v.id("expenseReports"),
    decision: v.union(v.literal("approve"), v.literal("decline")),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => decidePortable(await toPortableMutationCtx(ctx), args),
});

export const bulkApprove = authorizedMutation("expenseReports:bulkApprove", mutation)({
  args: { societyId: v.id("societies"), ids: v.array(v.id("expenseReports")) },
  returns: v.any(),
  handler: async (ctx, args) => bulkApprovePortable(await toPortableMutationCtx(ctx), args),
});

export const saveApprovalRules = authorizedMutation("expenseReports:saveApprovalRules", mutation)({
  args: {
    societyId: v.id("societies"),
    rules: v.array(
      v.object({
        minAmountCents: v.number(),
        requiredApprovals: v.number(),
        approverRoles: v.optional(v.array(v.string())),
        approverUserIds: v.optional(v.array(v.id("users"))),
        blockSelfApproval: v.optional(v.boolean()),
        enabled: v.optional(v.boolean()),
        label: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => saveApprovalRulesPortable(await toPortableMutationCtx(ctx), args),
});

// Who may approve claims: people with finance edit access (the default) or
// anyone named in the matching approval rule. Needs finance edit access; the
// change is recorded in the workspace activity log.
export const saveApproverAccess = authorizedMutation("expenseReports:saveApproverAccess", mutation)({
  args: {
    societyId: v.id("societies"),
    approverAccess: v.union(v.literal("finance_writers"), v.literal("rule_roles")),
  },
  returns: v.any(),
  handler: async (ctx, args) => saveApproverAccessPortable(await toPortableMutationCtx(ctx), args),
});

// Expense-claim policy: receipt and note thresholds and a submission window,
// warning approvers or blocking submission. Needs finance edit access; the
// change is recorded in the workspace activity log.
export const saveClaimPolicy = authorizedMutation("expenseReports:saveClaimPolicy", mutation)({
  args: {
    societyId: v.id("societies"),
    receiptOverCents: v.optional(v.number()),
    noteOverCents: v.optional(v.number()),
    maxAgeDays: v.optional(v.number()),
    enforcement: v.union(v.literal("warn"), v.literal("block")),
  },
  returns: v.any(),
  handler: async (ctx, args) => saveClaimPolicyPortable(await toPortableMutationCtx(ctx), args),
});

// Link an uploaded receipt document to a claim without resetting its approvals.
export const attachReceipt = authorizedMutation("expenseReports:attachReceipt", mutation)({
  args: { id: v.id("expenseReports"), receiptDocumentId: v.id("documents") },
  returns: v.any(),
  handler: async (ctx, args) => attachReceiptPortable(await toPortableMutationCtx(ctx), args),
});

// Notify the remaining approvers of a submitted claim (in-app and an Outbox
// draft), at most once per claim per 24 hours.
export const remindApprovers = authorizedMutation("expenseReports:remindApprovers", mutation)({
  args: { id: v.id("expenseReports") },
  returns: v.any(),
  handler: async (ctx, args) => remindApproversPortable(await toPortableMutationCtx(ctx), args),
});

// "Changes to approval rules need a second approver". Turning it off while it
// is on is itself a change another approver must accept.
export const setRulesChangeControl = authorizedMutation("expenseReports:setRulesChangeControl", mutation)({
  args: { societyId: v.id("societies"), enabled: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => setRulesChangeControlPortable(await toPortableMutationCtx(ctx), args),
});

// Approve or decline a pending approval-policy change (never the proposer's
// own), or withdraw your own proposal.
export const decidePolicyChange = authorizedMutation("expenseReports:decidePolicyChange", mutation)({
  args: {
    id: v.id("approvalPolicyChanges"),
    decision: v.union(v.literal("approve"), v.literal("decline"), v.literal("withdraw")),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => decidePolicyChangePortable(await toPortableMutationCtx(ctx), args),
});
