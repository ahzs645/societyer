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
  handler: (ctx, args) => profitAndLossPortable(toPortableQueryCtx(ctx), args),
});

export const budgetVariance = query({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => budgetVariancePortable(toPortableQueryCtx(ctx), args),
});

export const restrictedFunds = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => restrictedFundsPortable(toPortableQueryCtx(ctx), args),
});
