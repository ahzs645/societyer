import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  computeDividend,
  validateDividend,
  totalDeclaredByClass,
  totalDeclaredByCurrency,
  type DividendDeclaration,
} from "../shared/dividends";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("dividends")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows.sort((a, b) => String(a.declaredOn).localeCompare(String(b.declaredOn)));
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    declaredOn: v.string(),
    shareClass: v.string(),
    perShareCents: v.number(),
    sharesOutstanding: v.number(),
    currency: v.string(),
    notes: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const declaration: DividendDeclaration = {
      declaredOn: args.declaredOn,
      shareClass: args.shareClass,
      perShareCents: args.perShareCents,
      sharesOutstanding: args.sharesOutstanding,
      currency: args.currency,
    };

    const validation = validateDividend(declaration);
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }

    const { totalCents } = computeDividend(declaration);

    return ctx.db.insert("dividends", {
      societyId: args.societyId,
      declaredOn: args.declaredOn,
      shareClass: args.shareClass,
      perShareCents: args.perShareCents,
      sharesOutstanding: args.sharesOutstanding,
      currency: args.currency,
      totalCents,
      notes: args.notes,
      createdAtISO: args.nowISO,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("dividends") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const summary = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("dividends")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();

    const declarations: DividendDeclaration[] = rows.map((r) => ({
      declaredOn: String(r.declaredOn),
      shareClass: String(r.shareClass),
      perShareCents: Number(r.perShareCents),
      sharesOutstanding: Number(r.sharesOutstanding),
      currency: String(r.currency),
    }));

    return {
      byClass: totalDeclaredByClass(declarations),
      byCurrency: totalDeclaredByCurrency(declarations),
    };
  },
});
