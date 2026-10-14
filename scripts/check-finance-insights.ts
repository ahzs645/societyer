/**
 * Gate: Financials overview insights.
 *  - top payees / categories: biggest first, per direction, transfers left
 *    out, payee falls back to the description, uncategorised filters on empty;
 *  - months of operating reserve: unrestricted cash ÷ average monthly money
 *    out over the last 12 (or 6) complete months;
 *  - overview → Transactions deep links round-trip through the URL.
 */
import assert from "node:assert/strict";
import { MIN_RESERVE_MONTHS, formatReserveMonths, operatingReserve, topFlows } from "../src/features/financials/insights/topFlows";
import { readTransactionLink, transactionFilterHref, withoutTransactionLink } from "../src/features/financials/insights/transactionFilterLink";

const txns = [
  { date: "2026-01-05", amountCents: -10000, counterparty: "Hydro", category: "Facilities" },
  { date: "2026-01-20", amountCents: -5000, counterparty: "Hydro", category: "Facilities" },
  { date: "2026-02-03", amountCents: -30000, description: "RENT FEB", category: "Rent" },
  { date: "2026-02-10", amountCents: -2000, counterparty: "Bank", category: "" },
  { date: "2026-02-11", amountCents: -99999, counterparty: "Visa", category: "Transfer" },
  { date: "2026-02-12", amountCents: 50000, counterparty: "Donor", category: "Donations" },
  { date: "2025-12-31", amountCents: -77777, counterparty: "Hydro", category: "Facilities" },
];
const range = { start: "2026-01-01", end: "2026-02-28" };

const payees = topFlows(txns, range, "payee", "out");
assert.deepEqual(payees.rows.map((row) => [row.label, row.cents, row.count]), [["RENT FEB", 30000, 1], ["Hydro", 15000, 2], ["Bank", 2000, 1]], "biggest first; outside the range and transfers left out");
assert.equal(payees.total, 47000);
assert.deepEqual(payees.rows[0].filter, { field: "description", value: "RENT FEB" }, "payee falls back to the bank description");
assert.deepEqual(payees.rows[1].filter, { field: "counterparty", value: "Hydro" });
assert.ok(Math.abs(payees.rows.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-9);
const categories = topFlows(txns, range, "category", "out", 2);
assert.deepEqual(categories.rows.map((row) => row.label), ["Rent", "Facilities"]);
assert.equal(categories.groupCount, 3);
assert.equal(categories.otherCents, 2000, "the rest of the total is reported as other");
const uncategorised = topFlows(txns, range, "category", "out").rows.find((row) => row.filter.value === null);
assert.equal(uncategorised?.label, "Uncategorised");
assert.deepEqual(topFlows(txns, range, "payee", "in").rows.map((row) => row.label), ["Donor"]);

// --- Operating reserve ----------------------------------------------------------
const monthly = Array.from({ length: 14 }, (_, i) => {
  const month = String(((i + 8) % 12) + 1).padStart(2, "0");
  const year = i + 8 < 12 ? 2025 : 2026;
  return { date: `${year}-${month}-15`, amountCents: -100000, category: "Rent" };
});
// Sep 2025 .. Oct 2026; today is in Oct 2026, so Oct is incomplete.
const reserve = operatingReserve([...monthly, { date: "2026-03-01", amountCents: -500000, category: "Transfer" }], 600000, "2026-10-14");
assert.equal(reserve.windowMonths, 12);
assert.equal(reserve.window?.start, "2025-10-01");
assert.equal(reserve.window?.end, "2026-09-30");
assert.equal(reserve.averageMonthlyOutflowCents, 100000, "transfers are not spending");
assert.equal(reserve.months, 6);
assert.equal(formatReserveMonths(2.44), "2.4");
assert.equal(formatReserveMonths(14.6), "15");
const short = operatingReserve(monthly.slice(-4), 300000, "2026-10-14");
assert.equal(short.windowMonths, 3, "with less than 6 months, every complete month is used");
assert.equal(short.months, 3);
const tooShort = operatingReserve(monthly.slice(-2), 300000, "2026-10-14");
assert.equal(tooShort.months, null, `needs ${MIN_RESERVE_MONTHS} complete months`);
assert.equal(operatingReserve(monthly, -5000, "2026-10-14").months, 0, "negative unrestricted cash is zero months");

// --- Deep links --------------------------------------------------------------------
const href = transactionFilterHref({ field: "category", value: "Wages & benefits", flow: "out", from: "2026-01-01", to: "2026-02-28" });
const params = new URL(href, "https://example.test").searchParams;
assert.equal(params.get("tab"), "transactions");
assert.deepEqual(readTransactionLink(params), { field: "category", value: "Wages & benefits", flow: "out", from: "2026-01-01", to: "2026-02-28" });
assert.deepEqual(readTransactionLink(new URLSearchParams("txnField=category")), { field: "category", value: null, flow: undefined, from: undefined, to: undefined }, "no value means is empty");
assert.equal(readTransactionLink(new URLSearchParams("tab=transactions")), null);
assert.equal(readTransactionLink(new URLSearchParams("txnField=amountCents&txnFrom=bad"))?.field, undefined, "unknown fields and bad dates are ignored");
assert.equal(withoutTransactionLink(params).toString(), "tab=transactions");

console.log("Finance insights checks passed.");
