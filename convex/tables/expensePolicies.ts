import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Expense-claim policy and approval-policy change control.
 *
 * - `expenseClaimPolicy`: at most one row per workspace (no row = no policy).
 *   Thresholds left unset are switched off. Enforced when a claim is
 *   submitted (shared/expensePolicy.ts).
 * - `approvalPolicyChanges`: proposed approval-rule changes waiting for a
 *   second approver when the workspace turns on change control
 *   (expenseApprovalSettings.rulesChangeControl).
 */

const approvalRuleSnapshot = v.object({
  minAmountCents: v.number(),
  requiredApprovals: v.number(),
  approverRoles: v.array(v.string()),
  approverUserIds: v.array(v.id("users")),
  blockSelfApproval: v.boolean(),
  enabled: v.boolean(),
  label: v.optional(v.string()),
});

export const expensePolicyTables = {
  expenseClaimPolicy: defineTable({
    societyId: v.id("societies"),
    receiptOverCents: v.optional(v.number()),
    noteOverCents: v.optional(v.number()),
    maxAgeDays: v.optional(v.number()),
    enforcement: v.string(), // warn | block
    updatedByUserId: v.optional(v.id("users")),
    updatedByName: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  approvalPolicyChanges: defineTable({
    societyId: v.id("societies"),
    kind: v.string(), // rules | change_control_off
    status: v.string(), // pending | approved | declined | withdrawn
    // For kind "rules": the rule set that applies once approved (empty = the defaults).
    proposedRules: v.optional(v.array(approvalRuleSnapshot)),
    // The rules in force when the change was proposed, for the diff view.
    previousRules: v.optional(v.array(approvalRuleSnapshot)),
    proposedByUserId: v.optional(v.id("users")),
    proposedByName: v.string(),
    decidedByUserId: v.optional(v.id("users")),
    decidedByName: v.optional(v.string()),
    decidedAtISO: v.optional(v.string()),
    declineReason: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),
};
