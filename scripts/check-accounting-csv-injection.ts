// CSV formula-injection guard for accounting exports. The accounting CSVs
// (chart of accounts, general ledger, journal entries) carry user-entered text
// — account names, memos, line descriptions — that a treasurer opens in Excel /
// Sheets. A cell beginning with = + - @ is treated as a FORMULA, so a crafted
// value must be neutralised (leading zero-width non-joiner) the same way the
// rest of the app's exports are (src/lib/csv.ts sanitizeCsvCell). Runs on a
// MemoryDb; no live backend.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { exportCsvPortable } from "../shared/functions/accounting";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps });
const query = (name: string, handler: any) => rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) => rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

const ZWNJ = String.fromCharCode(0x200c);
const PAYLOAD = "=SUM(A1:A9)"; // a formula that would execute if opened raw

const setup: any = await mutate("setup", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "CSV Co" });
  await ctx.db.insert("financialAccounts", {
    societyId,
    code: "1000",
    name: PAYLOAD,
    accountType: "asset",
    currency: "CAD",
    normalBalance: "debit",
  });
  // A benign account to prove ordinary names are untouched.
  await ctx.db.insert("financialAccounts", {
    societyId,
    code: "2000",
    name: "Accounts Payable",
    accountType: "liability",
    currency: "CAD",
    normalBalance: "credit",
  });
  return { societyId };
});

const result: any = await query("export", (ctx: any) =>
  exportCsvPortable(ctx, { societyId: setup.societyId, kind: "chart_of_accounts" }),
);
const csv: string = result.csv;

// The dangerous name must be neutralised with a leading zero-width non-joiner...
assert.ok(csv.includes(`${ZWNJ}${PAYLOAD}`), "formula-like account name is prefixed with a zero-width non-joiner");
// ...and no raw formula cell may sit at a cell boundary (line start or after a comma).
assert.ok(!/(^|,)=SUM/m.test(csv), "no raw =SUM cell escapes into the CSV");
// Ordinary names are passed through unchanged (no over-escaping).
assert.ok(csv.includes("Accounts Payable") && !csv.includes(`${ZWNJ}Accounts Payable`), "benign names are untouched");

console.log("✓ accounting CSV exports neutralise formula-injection payloads in user text");
console.log("\naccounting CSV injection-guard check passed.");
