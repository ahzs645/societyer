import { v } from "convex/values";
import { query } from "./lib/untypedServer";
import {
  annualStatementPortable,
  orgRevenueExpensePortable,
  restrictedFundStatementPortable,
  readinessPortable,
} from "../shared/functions/yearEnd";
import { toPortableQueryCtx } from "./lib/portable";

/**
 * Year-end reporting queries. These are DERIVED from existing finance/grant
 * data — the annual financial statement, the statement of restricted funds, and
 * the year-end readiness checklist all read live tables rather than storing a
 * separate copy. The one stored year-end report (the Program Actuals & Budget
 * statement) lives in convex/programStatements.ts.
 */

export const annualStatement = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => annualStatementPortable(await toPortableQueryCtx(ctx), args),
});

export const orgRevenueExpense = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => orgRevenueExpensePortable(await toPortableQueryCtx(ctx), args),
});

export const restrictedFundStatement = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => restrictedFundStatementPortable(await toPortableQueryCtx(ctx), args),
});

export const readiness = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => readinessPortable(await toPortableQueryCtx(ctx), args),
});
