import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Finance workflow tables: transaction categorisation rules, bank statement
 * reconciliation periods, expense-claim approval rules and approval settings.
 */

export const transactionRuleConditionValidator = v.object({
  field: v.string(), // description | payee | amount | direction | account | category
  operator: v.optional(v.string()), // contains | equals | starts_with | in | lt | lte | eq | gte | gt | between
  value: v.optional(v.string()),
  values: v.optional(v.array(v.string())), // "in" (is any of): up to 25 exact values
  amountCents: v.optional(v.number()),
  amountMaxCents: v.optional(v.number()),
  accountId: v.optional(v.id("financialAccounts")),
});

export const transactionRuleActionsValidator = v.object({
  category: v.optional(v.string()),
  accountingAccountId: v.optional(v.id("financialAccounts")),
  fundRestrictionId: v.optional(v.id("fundRestrictions")),
  markReviewed: v.optional(v.boolean()),
});

export const financeWorkflowTables = {
  transactionRules: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    // True when nobody typed a name: `name` was generated from the rule and is regenerated on save.
    autoNamed: v.optional(v.boolean()),
    priority: v.number(), // 1 = evaluated first
    enabled: v.boolean(),
    conditions: v.array(transactionRuleConditionValidator),
    actions: transactionRuleActionsValidator,
    createdByUserId: v.optional(v.id("users")),
    lastAppliedAtISO: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_priority", ["societyId", "priority"]),

  reconciliationPeriods: defineTable({
    societyId: v.id("societies"),
    accountId: v.id("financialAccounts"),
    startDate: v.string(),
    endDate: v.string(),
    // Only the first period for an account stores its opening balance; later
    // periods begin at the previous period's statement ending balance.
    openingBalanceCents: v.optional(v.number()),
    endingBalanceCents: v.number(),
    statementDocumentId: v.optional(v.id("documents")),
    status: v.string(), // in_progress | completed | auto_reconciled | out_of_balance
    completedAtISO: v.optional(v.string()),
    completedByUserId: v.optional(v.id("users")),
    completedByName: v.optional(v.string()),
    // Snapshot taken at completion; a later difference flags the period.
    clearedFingerprint: v.optional(v.string()),
    clearedCount: v.optional(v.number()),
    clearedBalanceCents: v.optional(v.number()),
    outOfBalanceAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_account", ["accountId"])
    .index("by_society_status", ["societyId", "status"]),

  expenseApprovalRules: defineTable({
    societyId: v.id("societies"),
    order: v.number(),
    minAmountCents: v.number(),
    requiredApprovals: v.number(),
    approverRoles: v.array(v.string()),
    approverUserIds: v.array(v.id("users")),
    blockSelfApproval: v.boolean(),
    enabled: v.boolean(),
    label: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  // One row per workspace at most; no row means the defaults
  // (approverAccess "finance_writers": approving needs finance edit access).
  expenseApprovalSettings: defineTable({
    societyId: v.id("societies"),
    approverAccess: v.string(), // finance_writers | rule_roles
    updatedByUserId: v.optional(v.id("users")),
    updatedByName: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),
};
