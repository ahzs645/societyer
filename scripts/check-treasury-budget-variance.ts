// Regression guard for treasury.budgetVariance: actuals must be summed over the
// society's real fiscal-year window (anchored on its fiscalYearEnd), not a
// naive calendar year, and a hyphenated "YYYY-YYYY" label must resolve to a
// real span instead of an empty range.
//
// Before the fix, budgetVariancePortable derived the window with ad-hoc string
// math: a 4-digit label used Jan 1–Dec 31 (wrong for an Apr–Mar society), and a
// hyphenated label produced yearStart > yearEnd (matched no transaction at all,
// so every category showed $0 / "on track"). Runs on a MemoryDb.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { budgetVariancePortable } from "../shared/functions/treasury";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps });
const query = (name: string, handler: any) =>
  rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) =>
  rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

// --- 4-digit label on a March-31 society: FY "2027" = Apr 1 2026 … Mar 31 2027 ---
const { societyId } = await mutate("setup", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "Fiscal Co", fiscalYearEnd: "03-31" });
  await ctx.db.insert("budgets", { societyId, fiscalYear: "2027", category: "Rent", plannedCents: 1_200_000 });
  // Two transactions inside the fiscal window (sign is irrelevant — Math.abs):
  await ctx.db.insert("financialTransactions", { societyId, date: "2026-07-01", category: "Rent", amountCents: -100_000 });
  await ctx.db.insert("financialTransactions", { societyId, date: "2027-02-15", category: "Rent", amountCents: -50_000 });
  // Two just outside it — prior FY (before Apr 1 2026) and next FY (after Mar 31 2027):
  await ctx.db.insert("financialTransactions", { societyId, date: "2026-02-01", category: "Rent", amountCents: -999_999 });
  await ctx.db.insert("financialTransactions", { societyId, date: "2027-06-01", category: "Rent", amountCents: -999_999 });
  return { societyId };
});

const variance: any[] = await query("variance", (ctx: any) =>
  budgetVariancePortable(ctx, { societyId, fiscalYear: "2027" }),
);
const rent = variance.find((r) => r.category === "Rent");
assert.ok(rent, "Rent budget row present");
// Only the two in-fiscal-year transactions count (100_000 + 50_000). The old
// Jan–Dec 2027 window would instead have summed Feb + June 2027 = 1_049_999.
assert.equal(
  rent.actualCents,
  150_000,
  `actuals summed over the Apr–Mar fiscal window, not a calendar year (got ${rent.actualCents})`,
);
assert.equal(rent.varianceCents, 150_000 - 1_200_000, "variance = actual - planned");
console.log("✓ 4-digit fiscal-year label sums actuals over the society's fiscal window (Apr–Mar)");

// --- Hyphenated label "2024-2025" must resolve to Apr 1 2024 … Mar 31 2025 ---
const { societyId: soc2 } = await mutate("setup2", async (ctx: any) => {
  const soc2 = await ctx.db.insert("societies", { name: "Span Co", fiscalYearEnd: "03-31" });
  await ctx.db.insert("budgets", { societyId: soc2, fiscalYear: "2024-2025", category: "Rent", plannedCents: 600_000 });
  await ctx.db.insert("financialTransactions", { societyId: soc2, date: "2024-07-01", category: "Rent", amountCents: -100_000 });
  await ctx.db.insert("financialTransactions", { societyId: soc2, date: "2025-04-01", category: "Rent", amountCents: -999_999 });
  return { societyId: soc2 };
});
const v2: any[] = await query("variance2", (ctx: any) =>
  budgetVariancePortable(ctx, { societyId: soc2, fiscalYear: "2024-2025" }),
);
const rent2 = v2.find((r) => r.category === "Rent");
assert.ok(rent2, "Rent budget row present (hyphenated FY)");
assert.equal(
  rent2.actualCents,
  100_000,
  `hyphenated FY label resolves to a real Apr–Mar window, not an empty range (got ${rent2.actualCents})`,
);
console.log("✓ hyphenated fiscal-year label resolves to a non-empty Apr–Mar window");

console.log("\ntreasury budget-variance fiscal-window checks passed.");
