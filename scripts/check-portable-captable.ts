// Cap-table conformance: the MULTI-ROW atomic write (upsertRightsholdingTransfer
// + syncRightsHoldings) across all three engines.
//
// Each transfer re-derives every rightsHolding from the ledger — a delete/patch/
// insert across multiple rows in one mutation. This asserts:
//   - identical materialization on MemoryDb and LocalStoreDb (same logical ids),
//   - the same invariants on the REAL Convex stack (convex-test), and
//   - atomicity: an invalid transfer (negative holding) throws and leaves the
//     prior cap table completely unchanged (no half-applied multi-row write).

import assert from "node:assert/strict";
import { convexTest } from "convex-test";

import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import {
  MemoryDb,
  LocalStoreDb,
  MemoryRowStore,
  PortableRuntime,
  definePortableMutation,
  definePortableQuery,
  makeCapabilities,
  type TransactionalDb,
} from "../shared/portable/index";
import { upsertRightsholdingTransferPortable } from "../shared/functions/rightsholdingTransfers";

interface Ids {
  societyId: string;
  classId: string;
  alice: string;
  bob: string;
}
type Holding = { holderKey: string; quantity: number; status: string };
interface Exec {
  transfer: (args: Record<string, any>) => Promise<unknown>;
  holdings: () => Promise<Holding[]>;
}

const sortHoldings = (rows: Holding[]) =>
  rows.map((h) => ({ holderKey: h.holderKey, quantity: h.quantity, status: h.status })).sort((a, b) => a.holderKey.localeCompare(b.holderKey));
const quantities = (rows: Holding[]) => rows.map((h) => h.quantity).sort((a, b) => a - b);

// The scenario every engine runs: issue 100 to alice, move 25 to bob, then try an
// invalid cancellation of 200 (must throw and roll back).
async function capTableScenario(ids: Ids, exec: Exec) {
  await exec.transfer({ transferType: "issuance", status: "posted", rightsClassId: ids.classId, destinationRoleHolderId: ids.alice, quantity: 100, transferDate: "2026-01-02" });
  const afterIssue = await exec.holdings();

  await exec.transfer({ transferType: "transfer", status: "posted", rightsClassId: ids.classId, sourceRoleHolderId: ids.alice, destinationRoleHolderId: ids.bob, quantity: 25, transferDate: "2026-01-03" });
  const afterTransfer = await exec.holdings();

  let threw = false;
  try {
    await exec.transfer({ transferType: "cancellation", status: "posted", rightsClassId: ids.classId, sourceRoleHolderId: ids.alice, quantity: 200, transferDate: "2026-01-05" });
  } catch (error) {
    threw = true;
    assert.match(String(error), /negative holding/, "invalid cancellation should fail validateLedger");
  }
  assert.ok(threw, "invalid cancellation must throw");
  const afterInvalid = await exec.holdings();

  return { afterIssue, afterTransfer, afterInvalid };
}

// --- local engines (MemoryDb, LocalStoreDb over MemoryRowStore) ----------------
const transferDef = definePortableMutation({ name: "legalOperations:upsertRightsholdingTransfer", handler: upsertRightsholdingTransferPortable });
function localExec(db: TransactionalDb, ids: Ids): Exec {
  const rt = new PortableRuntime({ db, capabilities: makeCapabilities({}) })
    .register(transferDef)
    .register(definePortableQuery({
      name: "_holdings",
      handler: async (c) =>
        (await c.db.query("rightsHoldings").withIndex("by_society", (q) => q.eq("societyId", ids.societyId)).collect()) as any,
    }));
  return {
    transfer: (args) => rt.runMutation("legalOperations:upsertRightsholdingTransfer", { societyId: ids.societyId, ...args }),
    holdings: async () => sortHoldings((await rt.runQuery<Holding[]>("_holdings")) ?? []),
  };
}

const localIds: Ids = { societyId: "soc_cap", classId: "classA", alice: "alice", bob: "bob" };
const memResult = await capTableScenario(localIds, localExec(new MemoryDb(), localIds));
const locResult = await capTableScenario(localIds, localExec(new LocalStoreDb(new MemoryRowStore()), localIds));

assert.deepEqual(quantities(memResult.afterIssue), [100], "issuance -> one 100-share holding");
assert.deepEqual(quantities(memResult.afterTransfer), [25, 75], "transfer -> alice 75, bob 25");
assert.deepEqual(memResult.afterInvalid, memResult.afterTransfer, "invalid transfer rolled back (MemoryDb)");
assert.deepEqual(locResult.afterInvalid, locResult.afterTransfer, "invalid transfer rolled back (LocalStoreDb)");
assert.deepEqual(memResult, locResult, "MemoryDb and LocalStoreDb diverged on the cap table");
console.log("✓ multi-row sync: MemoryDb == LocalStoreDb (issue, transfer, atomic rollback on invalid)");

// --- the real Convex stack (convex-test) --------------------------------------
const modules = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./legalOperations.js": () => import("../convex/legalOperations"),
};
const t = convexTest(schema, modules as any);
const cids: Ids = await t.run(async (ctx: any) => {
  const iso = "2026-01-01T00:00:00.000Z";
  const societyId = await ctx.db.insert("societies", { name: "Cap", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const classId = await ctx.db.insert("rightsClasses", {
    societyId, className: "Class A", classType: "share", status: "active",
    sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: iso, updatedAtISO: iso,
  });
  const role = (fullName: string) => ctx.db.insert("roleHolders", {
    societyId, roleType: "member", status: "current", fullName,
    citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [],
    sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: iso, updatedAtISO: iso,
  });
  return { societyId, classId, alice: await role("Alice"), bob: await role("Bob") };
});
const convexExec: Exec = {
  transfer: (args) => t.mutation(api.legalOperations.upsertRightsholdingTransfer, { societyId: cids.societyId, ...args }),
  holdings: () => t.run(async (ctx: any) =>
    sortHoldings(await ctx.db.query("rightsHoldings").withIndex("by_society", (q: any) => q.eq("societyId", cids.societyId)).collect())),
};
const convexResult = await capTableScenario(cids, convexExec);
assert.deepEqual(quantities(convexResult.afterIssue), [100], "Convex issuance");
assert.deepEqual(quantities(convexResult.afterTransfer), [25, 75], "Convex transfer");
assert.deepEqual(convexResult.afterInvalid, convexResult.afterTransfer, "invalid transfer rolled back (real Convex)");
console.log("✓ multi-row sync: real Convex stack matches the same invariants (and atomic rollback)");

console.log("\nPortable cap-table conformance passed.");
