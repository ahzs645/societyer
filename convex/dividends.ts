import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  computeDividend,
  reconcileDividend,
  validateDividend,
  totalDeclaredByClass,
  totalDeclaredByCurrency,
  type DividendDeclaration,
} from "../shared/dividends";

function centsToAmount(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
    // An independently keyed/imported total to cross-check against
    // perShareCents * sharesOutstanding (YCN "Record - Dividends" reconciliation).
    expectedTotalCents: v.optional(v.number()),
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

    // Surface a reconciliation warning (never block) when a keyed total disagrees.
    let notes = args.notes;
    if (typeof args.expectedTotalCents === "number") {
      const recon = reconcileDividend({ ...declaration, totalCents: args.expectedTotalCents });
      if (!recon.reconciled) {
        const warning = `⚠ Dividend total mismatch: entered ${args.currency} ${centsToAmount(recon.enteredCents)} vs computed ${args.currency} ${centsToAmount(recon.expectedCents)} (per-share × shares). Verify the rate, share count, or total.`;
        notes = [warning, notes].filter(Boolean).join("\n\n");
      }
    }

    return ctx.db.insert("dividends", {
      societyId: args.societyId,
      declaredOn: args.declaredOn,
      shareClass: args.shareClass,
      perShareCents: args.perShareCents,
      sharesOutstanding: args.sharesOutstanding,
      currency: args.currency,
      totalCents,
      notes,
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
