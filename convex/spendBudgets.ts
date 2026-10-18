import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  optionsForClaimPortable,
  upsertPortable,
  setArchivedPortable,
  removePortable,
} from "../shared/functions/spendBudgets";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

// Committee spend budgets with the current cycle's spend from assigned claims.
export const list = authorizedQuery("spendBudgets:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

// Budgets a claimant may charge, with what a claim would leave in its cycle.
export const optionsForClaim = authorizedQuery("spendBudgets:optionsForClaim", query)({
  args: {
    societyId: v.id("societies"),
    claimantUserId: v.optional(v.id("users")),
    incurredAtISO: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    claimId: v.optional(v.id("expenseReports")),
  },
  returns: v.any(),
  handler: async (ctx, args) => optionsForClaimPortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = authorizedMutation("spendBudgets:upsert", mutation)({
  args: {
    id: v.optional(v.id("spendBudgets")),
    societyId: v.id("societies"),
    name: v.string(),
    limitCents: v.number(),
    cycle: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("once")),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    committeeId: v.optional(v.id("committees")),
    memberUserIds: v.optional(v.array(v.id("users"))),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

export const setArchived = authorizedMutation("spendBudgets:setArchived", mutation)({
  args: { id: v.id("spendBudgets"), archived: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => setArchivedPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("spendBudgets:remove", mutation)({
  args: { id: v.id("spendBudgets") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
