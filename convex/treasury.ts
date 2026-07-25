import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  profitAndLossPortable,
  budgetVariancePortable,
  restrictedFundsPortable,
} from "../shared/functions/treasury";
import { toPortableQueryCtx } from "./lib/portable";

export const profitAndLoss = query({
  args: {
    societyId: v.id("societies"),
    from: v.string(),
    to: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => profitAndLossPortable(await toPortableQueryCtx(ctx), args),
});

export const budgetVariance = query({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => budgetVariancePortable(await toPortableQueryCtx(ctx), args),
});

export const restrictedFunds = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => restrictedFundsPortable(await toPortableQueryCtx(ctx), args),
});
