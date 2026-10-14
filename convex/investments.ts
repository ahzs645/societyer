import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  investmentsWorkspacePortable,
  investmentsReservesPortable,
  investmentsUpsertPortable,
  investmentsRemovePortable,
} from "../shared/functions/businessRegisters";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

// Investments register: GICs, term deposits, savings and investment accounts
// held as reserves, with interest accrual and maturity reminders. Record-keeping
// only: nothing here buys, renews or redeems an investment.

export const workspace = authorizedQuery("investments:workspace", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => investmentsWorkspacePortable(await toPortableQueryCtx(ctx), args),
});

export const reserves = authorizedQuery("investments:reserves", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => investmentsReservesPortable(await toPortableQueryCtx(ctx), args),
});

export const upsert = authorizedMutation("investments:upsert", mutation)({
  args: {
    id: v.optional(v.id("investmentHoldings")),
    societyId: v.id("societies"),
    name: v.string(),
    kind: v.string(),
    institution: v.string(),
    accountLast4: v.optional(v.string()),
    principalCents: v.number(),
    ratePercent: v.optional(v.number()),
    compounding: v.optional(v.string()),
    startDate: v.string(),
    maturityDate: v.optional(v.string()),
    interestPaidCents: v.optional(v.number()),
    currentValueCents: v.optional(v.number()),
    restricted: v.optional(v.boolean()),
    fundRestrictionId: v.optional(v.id("fundRestrictions")),
    financialAccountId: v.optional(v.id("financialAccounts")),
    documentId: v.optional(v.id("documents")),
    autoRenew: v.optional(v.boolean()),
    status: v.optional(v.string()),
    redeemedOn: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => investmentsUpsertPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("investments:remove", mutation)({
  args: { id: v.id("investmentHoldings") },
  returns: v.any(),
  handler: async (ctx, args) => investmentsRemovePortable(await toPortableMutationCtx(ctx), args),
});
