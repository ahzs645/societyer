import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  financialsList,
  detailByFiscalYearPortable,
  financialCreate,
  financialUpdate,
  financialRemove,
} from "../shared/functions/financials";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const remItem = v.object({ role: v.string(), amountCents: v.number() });

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => financialsList(await toPortableQueryCtx(ctx), args),
});

export const detailByFiscalYear = query({
  args: { societyId: v.id("societies"), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => detailByFiscalYearPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    periodEnd: v.string(),
    revenueCents: v.number(),
    expensesCents: v.number(),
    netAssetsCents: v.number(),
    restrictedFundsCents: v.optional(v.number()),
    auditStatus: v.string(),
    auditorName: v.optional(v.string()),
    remunerationDisclosures: v.array(remItem),
  },
  returns: v.any(),
  handler: async (ctx, args) => financialCreate(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("financials"),
    patch: v.object({
      fiscalYear: v.optional(v.string()),
      periodEnd: v.optional(v.string()),
      revenueCents: v.optional(v.number()),
      expensesCents: v.optional(v.number()),
      netAssetsCents: v.optional(v.number()),
      restrictedFundsCents: v.optional(v.number()),
      auditStatus: v.optional(v.string()),
      auditorName: v.optional(v.string()),
      approvedByBoardAt: v.optional(v.string()),
      presentedAtMeetingId: v.optional(v.id("meetings")),
      remunerationDisclosures: v.optional(v.array(remItem)),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => financialUpdate(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("financials") },
  returns: v.any(),
  handler: async (ctx, args) => financialRemove(await toPortableMutationCtx(ctx), args),
});
