// Phase 1 live-runtime test: the REAL StaticConvexClient executes the async
// portable handler against its Dexie-backed ctx.db, with React-style reactivity.
//
// Unlike check-portable-runtime.ts (which drives the engines directly), this
// drives the actual client the app uses — proving query()/watchQuery() route a
// registered portable function (legalOperations:votingPower) through the
// PortableRuntime, cache the result synchronously for useQuery, and recompute
// when the store changes.

import assert from "node:assert/strict";

import { StaticConvexClient } from "../src/lib/staticConvex";
import type { PortableDoc } from "../shared/portable/index";

const societyId = "soc_riverside";
function buildSeed(): Record<string, PortableDoc[]> {
  return {
    rightsClasses: [
      { _id: "classA", societyId, className: "Class A", votesPerShare: 10 },
      { _id: "classB", societyId, className: "Class B", votingRights: "Non-Voting" },
    ],
    roleHolders: [
      { _id: "rh_alice", societyId, fullName: "Alice Stone", directoryPersonId: "p_alice" },
      { _id: "rh_vane", societyId, fullName: "Vane Holdings Ltd.", directoryPersonId: "p_vane" },
      { _id: "rh_tim", societyId, fullName: "Tim Young", directoryPersonId: "p_tim" },
      { _id: "rh_carol", societyId, fullName: "Carol Reed", directoryPersonId: "p_carol" },
    ],
    peopleDirectory: [
      { _id: "p_alice", isIndividual: true, atAgeOfMajority: true },
      { _id: "p_vane", isIndividual: false },
      { _id: "p_tim", isIndividual: true, atAgeOfMajority: false },
      { _id: "p_carol", isIndividual: true, atAgeOfMajority: true },
    ],
    rightsHoldings: [
      { _id: "h1", societyId, holderKey: "alice", holderRoleHolderId: "rh_alice", rightsClassId: "classA", quantity: 100, status: "current" },
      { _id: "h2", societyId, holderKey: "vane", holderRoleHolderId: "rh_vane", rightsClassId: "classA", quantity: 50, status: "current" },
      { _id: "h3", societyId, holderKey: "tim", holderRoleHolderId: "rh_tim", rightsClassId: "classA", quantity: 10, status: "current" },
      { _id: "h4", societyId, holderKey: "carol", holderRoleHolderId: "rh_carol", rightsClassId: "classB", quantity: 300, status: "current" },
    ],
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const client = new StaticConvexClient({ seed: buildSeed(), databaseName: "portable-live-test" });

// === 1. one-shot query() routes through the portable runtime (async) ==========
{
  const result: any = await client.query("legalOperations:votingPower", { societyId });
  assert.equal(result.totalVotes, 1600, "query() should return the portable handler's roll-up");
  assert.deepEqual(result.eligibleSigners.map((h: any) => h.holderKey), ["alice"]);
  console.log("✓ client.query() executes the async portable handler live (totalVotes=1600)");
}

// === 2. watchQuery(): sync fallback now, async portable result + notify next ===
const watch = client.watchQuery("legalOperations:votingPower", { societyId });
{
  // Synchronous first read: the mirror fallback gives an instant value (no flash).
  const initial: any = watch.localQueryResult();
  assert.equal(initial?.totalVotes, 1600, "synchronous fallback should be immediate");

  const seen: any[] = [];
  const unsub = watch.onUpdate(() => seen.push(watch.localQueryResult()));

  await tick(); // let the async portable handler resolve

  assert.ok(seen.length >= 1, "the async portable result should notify subscribers");
  assert.equal(watch.localQueryResult().totalVotes, 1600, "async result is now authoritative");
  console.log("✓ client.watchQuery() bridges async portable execution to a sync last-result cache");

  // === 3. reactivity: a store change recomputes the portable handler ==========
  const reduced = buildSeed();
  reduced.rightsHoldings = reduced.rightsHoldings.filter((h) => h._id !== "h1"); // drop Alice's 1000 votes
  await client.importLocalWorkspaceSnapshot({ tables: reduced } as any);
  await tick();

  assert.equal(watch.localQueryResult().totalVotes, 600, "watch should recompute after a store change");
  // With Alice gone, the remaining voters are Vane (corp) and Tim (minor) — both
  // ineligible — and Carol is non-voting, so no eligible signatories remain.
  assert.deepEqual(watch.localQueryResult().eligibleSigners, [], "no eligible signatories after Alice is removed");
  console.log("✓ store change triggers a live portable recompute (totalVotes 1600 -> 600)");
  unsub();
}

// === 4. a portable MUTATION runs through the live client and persists ==========
{
  const createdId: any = await client.mutation("legalOperations:upsertRightsClass", {
    societyId, className: "Class C", classType: "share", status: "active", votesPerShare: 5,
  });
  assert.ok(createdId, "mutation returns the new id");

  // Read it back through the (non-portable) mirror query — proving the portable
  // write landed in the same store the rest of the runtime reads from.
  const ledger: any = await client.query("legalOperations:rightsLedger", { societyId });
  assert.ok(ledger.classes.some((c: any) => c.className === "Class C"), "new class persisted to the live store");

  await client.mutation("legalOperations:upsertRightsClass", {
    id: createdId, societyId, className: "Class C2", classType: "share", status: "inactive",
  });
  const ledger2: any = await client.query("legalOperations:rightsLedger", { societyId });
  const updated = ledger2.classes.find((c: any) => c._id === createdId);
  assert.equal(updated?.className, "Class C2", "update persisted in place");
  assert.equal(updated?.status, "inactive");
  console.log("✓ client.mutation() runs the portable upsertRightsClass live (create + update persist)");
}

await client.close();
console.log("\nAll portable LIVE-runtime checks passed.");
