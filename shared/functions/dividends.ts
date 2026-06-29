/**
 * PORTABLE FUNCTIONS: the dividends domain (list / create / remove / summary).
 *
 * Reads/writes the `dividends` table over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle. The
 * dividend math (compute/validate/reconcile/totals) lives in the framework-free
 * `../dividends` module; only the `centsToAmount` display helper is local.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  computeDividend,
  reconcileDividend,
  validateDividend,
  totalDeclaredByClass,
  totalDeclaredByCurrency,
  type DividendDeclaration,
} from "../dividends";

function centsToAmount(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("dividends")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.sort((a, b) => String(a.declaredOn).localeCompare(String(b.declaredOn)));
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    declaredOn: string;
    shareClass: string;
    perShareCents: number;
    sharesOutstanding: number;
    currency: string;
    expectedTotalCents?: number;
    notes?: string;
    nowISO: string;
  },
): Promise<string> {
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
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}

export async function summaryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
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
}
