import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  workspacePortable,
  upsertPortable,
  removePortable,
  reorderPortable,
  setEnabledPortable,
  applyToUncategorizedPortable,
  undoBatchPortable,
  removeApplicationPortable,
} from "../shared/functions/transactionRules";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { transactionRuleActionsValidator, transactionRuleConditionValidator } from "./tables/financeWorkflows";

export const workspace = authorizedQuery("transactionRules:workspace", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => workspacePortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = authorizedMutation("transactionRules:upsert", mutation)({
  args: {
    id: v.optional(v.id("transactionRules")),
    societyId: v.id("societies"),
    // Optional: a blank name is generated from the rule's conditions and actions.
    name: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    conditions: v.array(transactionRuleConditionValidator),
    actions: transactionRuleActionsValidator,
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("transactionRules:remove", mutation)({
  args: { id: v.id("transactionRules") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

export const reorder = authorizedMutation("transactionRules:reorder", mutation)({
  args: { societyId: v.id("societies"), orderedIds: v.array(v.id("transactionRules")) },
  returns: v.any(),
  handler: async (ctx, args) => reorderPortable(await toPortableMutationCtx(ctx), args),
});

export const setEnabled = authorizedMutation("transactionRules:setEnabled", mutation)({
  args: { id: v.id("transactionRules"), enabled: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => setEnabledPortable(await toPortableMutationCtx(ctx), args),
});

// Apply rules to every uncategorised transaction, or only the matches of one rule.
export const applyToUncategorized = authorizedMutation("transactionRules:applyToUncategorized", mutation)({
  args: { societyId: v.id("societies"), ruleId: v.optional(v.id("transactionRules")) },
  returns: v.any(),
  handler: async (ctx, args) => applyToUncategorizedPortable(await toPortableMutationCtx(ctx), args),
});

export const undoBatch = authorizedMutation("transactionRules:undoBatch", mutation)({
  args: { societyId: v.id("societies"), batch: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => undoBatchPortable(await toPortableMutationCtx(ctx), args),
});

export const removeApplication = authorizedMutation("transactionRules:removeApplication", mutation)({
  args: { txnId: v.id("financialTransactions") },
  returns: v.any(),
  handler: async (ctx, args) => removeApplicationPortable(await toPortableMutationCtx(ctx), args),
});
