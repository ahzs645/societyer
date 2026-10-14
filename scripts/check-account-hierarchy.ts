/**
 * Gate: chart-of-accounts hierarchy (financialAccounts.parentAccountId).
 *  - the shared rules reject cycles, cross-section and cross-currency parents
 *    and nesting deeper than MAX_ACCOUNT_DEPTH;
 *  - statement rows roll sub-accounts up into their parent;
 *  - the in-browser demo seeds sub-accounts and `accounting:setAccountParent`
 *    applies the same rules there.
 */
import assert from "node:assert/strict";
import {
  MAX_ACCOUNT_DEPTH,
  accountParentError,
  buildAccountTree,
  descendantIds,
  eligibleParents,
} from "../shared/accountHierarchy";
import { rollupAccounts } from "../src/features/financials/lib/accountRollup";
import { StaticConvexClient } from "../src/lib/staticConvex";

const chart = [
  { _id: "cash", code: "1000", name: "Cash", accountType: "Bank", currency: "CAD" },
  { _id: "ar", code: "1100", name: "Receivables", accountType: "Asset", currency: "CAD" },
  { _id: "fac", code: "5200", name: "Facilities", accountType: "Expense", currency: "CAD" },
  { _id: "rent", code: "5210", name: "Rent", accountType: "Expense", currency: "CAD", parentAccountId: "fac" },
  { _id: "hall", code: "5211", name: "Hall", accountType: "Expense", currency: "CAD", parentAccountId: "rent" },
  { _id: "util", code: "5220", name: "Utilities", accountType: "Expense", currency: "CAD", parentAccountId: "fac" },
  { _id: "usd", code: "5300", name: "US costs", accountType: "Expense", currency: "USD" },
  { _id: "rev", code: "4000", name: "Donations", accountType: "Income", currency: "CAD" },
];

// --- Rules ------------------------------------------------------------------
assert.equal(accountParentError(chart, "ar", "cash"), null, "Bank and Asset share the assets section");
assert.equal(accountParentError(chart, "util", null), null, "moving to the top level is always allowed");
assert.match(accountParentError(chart, "fac", "fac") ?? "", /own parent/);
assert.match(accountParentError(chart, "fac", "hall") ?? "", /already under/, "no cycles");
assert.match(accountParentError(chart, "rev", "fac") ?? "", /revenue account/, "no cross-section parents");
assert.match(accountParentError(chart, "usd", "fac") ?? "", /same currency/, "no cross-currency parents");
assert.match(accountParentError(chart, "util", "hall") ?? "", new RegExp(`${MAX_ACCOUNT_DEPTH} levels`), "depth is capped");
assert.match(accountParentError(chart, "fac", "missing") ?? "", /Choose a parent/);
assert.deepEqual([...descendantIds(chart, "fac")].sort(), ["hall", "rent", "util"]);
assert.deepEqual(eligibleParents(chart, "util").map((row) => row._id), ["fac", "rent"], "only same-section, non-descendant accounts within the depth cap");
const tree = buildAccountTree(chart);
const fac = tree.find((node) => node.account._id === "fac")!;
assert.deepEqual(fac.children.map((node) => node.account._id), ["rent", "util"]);
assert.equal(fac.children[0].children[0].depth, 3);
// A malformed cycle still renders every account once.
const cyclic = [{ _id: "a", name: "A", accountType: "Expense", parentAccountId: "b" }, { _id: "b", name: "B", accountType: "Expense", parentAccountId: "a" }];
const flat: string[] = [];
const walk = (nodes: ReturnType<typeof buildAccountTree>) => nodes.forEach((node) => { flat.push(node.account._id); walk(node.children); });
walk(buildAccountTree(cyclic));
assert.deepEqual(flat.sort(), ["a", "b"]);

// --- Statement roll-up --------------------------------------------------------
const rolled = rollupAccounts(
  [
    { accountId: "fac", code: "5200", name: "Facilities", values: { current: 100, prior: 0 } },
    { accountId: "hall", code: "5211", name: "Hall", values: { current: 40, prior: 10 } },
    { accountId: "util", code: "5220", name: "Utilities", values: { current: 5, prior: 5 } },
    { accountId: "usd", code: "5300", name: "US costs", values: { current: 7, prior: 0 } },
  ],
  chart,
);
assert.deepEqual(rolled.map((node) => node.accountId), ["fac", "usd"]);
const facNode = rolled[0];
assert.deepEqual(facNode.total, { current: 145, prior: 15 }, "parent total = own + every sub-account");
assert.deepEqual(facNode.own, { current: 100, prior: 0 });
const rent = facNode.children.find((node) => node.accountId === "rent")!;
assert.equal(rent.own, null, "a parent with no lines of its own still appears");
assert.deepEqual(rent.total, { current: 40, prior: 10 });
assert.deepEqual(facNode.accountIds.sort(), ["fac", "hall", "rent", "util"], "drilldown covers the whole subtree");
// A parent in another section is ignored rather than moving amounts across sections.
const crossed = rollupAccounts([{ accountId: "x", name: "X", values: { current: 1 } }], [{ _id: "x", name: "X", accountType: "Income", parentAccountId: "fac" }, ...chart]);
assert.deepEqual(crossed.map((node) => node.accountId), ["x"]);

// --- Demo data and the local mutation -----------------------------------------
const client = new StaticConvexClient({ databaseName: `societyer-coa-${Date.now()}-${Math.random().toString(36).slice(2)}` });
const [society] = await client.query("society:list", {});
const accounts: any[] = await client.query("accounting:chartAccounts", { societyId: society._id });
const facilities = accounts.find((row) => row.code === "5200");
const subs = accounts.filter((row) => row.parentAccountId && String(row.parentAccountId) === String(facilities?._id));
assert.ok(facilities && subs.length >= 2, "the demo seeds sub-accounts under facilities");
const venue = subs.find((row) => row.code === "5210")!;
await assert.rejects(client.mutation("accounting:setAccountParent", { id: facilities._id, parentAccountId: venue._id }), /already under/, "the local mutation rejects cycles");
const revenue = accounts.find((row) => row.accountType === "Income");
await assert.rejects(client.mutation("accounting:setAccountParent", { id: venue._id, parentAccountId: revenue._id }), /expense account/, "and cross-section parents");
await client.mutation("accounting:setAccountParent", { id: venue._id });
let after: any[] = await client.query("accounting:chartAccounts", { societyId: society._id });
assert.equal(after.find((row) => row._id === venue._id)?.parentAccountId, undefined, "omitting the parent moves it to the top level");
await client.mutation("accounting:setAccountParent", { id: venue._id, parentAccountId: facilities._id });
after = await client.query("accounting:chartAccounts", { societyId: society._id });
assert.equal(String(after.find((row) => row._id === venue._id)?.parentAccountId), String(facilities._id));
const csv: any = await client.query("accounting:exportCsv", { societyId: society._id, kind: "chart_of_accounts" });
assert.match(csv.csv.split(/\r?\n/)[0], /parent_code/);
assert.ok(csv.csv.split(/\r?\n/).some((line: string) => line.startsWith("5210,") && line.endsWith(",5200")), "the export names each sub-account's parent");

console.log(`Account hierarchy checks passed (${accounts.length} demo accounts, ${subs.length} sub-accounts).`);
