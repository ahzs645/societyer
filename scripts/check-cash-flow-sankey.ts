/**
 * Cash-flow Sankey model: transfers are left out, refunds net against their
 * category, the long tail folds into "Other", and every column balances.
 */
import assert from "node:assert/strict";
import { buildCashFlowSankey, OTHER_OUT_ID } from "../src/features/financials/insights/cashFlowSankey";

const range = { start: "2026-01-01", end: "2026-12-31" };
const txns = [
  { date: "2026-02-01", amountCents: 100_000, category: "Donations", accountId: "op" },
  { date: "2026-02-02", amountCents: 50_000, category: "Grant revenue", accountId: "grant" },
  { date: "2026-02-03", amountCents: -30_000, category: "Rent", accountId: "op" },
  { date: "2026-02-04", amountCents: -20_000, category: "Supplies", accountId: "op" },
  { date: "2026-02-05", amountCents: 2_000, category: "Supplies", accountId: "op" }, // refund
  { date: "2026-02-06", amountCents: -60_000, category: "Program delivery", accountId: "grant" },
  { date: "2026-02-07", amountCents: -5_000, category: "Transfer", accountId: "op" },
  { date: "2026-02-07", amountCents: 5_000, category: "Transfer to card", accountId: "card" },
  { date: "2026-02-08", amountCents: -100, category: "Bank fees", accountId: "op" },
  { date: "2026-02-08", amountCents: -200, category: "Postage", accountId: "op" },
  { date: "2025-12-31", amountCents: -999_999, category: "Rent", accountId: "op" }, // out of range
];

const model = buildCashFlowSankey(txns, range, { restrictedAccountIds: new Set(["grant"]) });
assert.equal(model.excludedTransfers, 2, "both transfer legs are left out");
assert.equal(model.totalIn, 150_000);
assert.equal(model.totalOut, 30_000 + 18_000 + 60_000 + 100 + 200);
const supplies = model.allOutflows.find((flow) => flow.category === "Supplies")!;
assert.equal(supplies.cents, 18_000, "the refund nets against Supplies");
assert.equal(supplies.offsetCents, 2_000);
assert.ok(model.outflows.some((flow) => flow.id === OTHER_OUT_ID), "small categories fold into Other");
assert.deepEqual(model.funds, ["unrestricted", "restricted"]);

// Each column carries the same total once the balancing nodes are added.
const columnTotals = [0, 1, 2].map((column) => {
  const ids = new Set(model.nodes.filter((node) => node.column === column).map((node) => node.id));
  const field = column === 2 ? "target" : "source";
  return model.links.filter((link) => ids.has(link[field])).reduce((sum, link) => sum + link.value, 0);
});
assert.equal(columnTotals[0], columnTotals[2], "money in (plus cash on hand) equals money out (plus net increase)");

const combined = buildCashFlowSankey(txns, range, { restrictedAccountIds: new Set(["grant"]), splitFunds: false });
assert.deepEqual(combined.funds, ["all"]);
assert.equal(combined.nodes.filter((node) => node.column === 1).length, 1);

console.log("PASS: cash-flow Sankey nets refunds, skips transfers, folds the tail and balances");
