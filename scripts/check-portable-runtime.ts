// Differential conformance harness for the portable `ctx.db` runtime.
//
// Proves the core thesis of docs/portable-functions-architecture.md: ONE handler
// written against the portable contract produces IDENTICAL results on multiple
// `ctx.db` engines. Here we diff two dependency-free engines —
//   - MemoryDb            (the oracle: simplest correct implementation)
//   - LocalStoreDb        (the real browser/Electron adapter, over MemoryRowStore)
// — against each other and against the shared marshaller the static mirror uses.
// On hosted Convex the same handler runs on the real ctx.db (convex/lib/portable.ts);
// convex-test would slot in here as a third, higher-fidelity engine (see the doc).
//
// Also covers: atomic mutation + rollback, injected capabilities with structured
// CAPABILITY_UNAVAILABLE errors, and stable application ids.

import assert from "node:assert/strict";

import {
  MemoryDb,
  LocalStoreDb,
  MemoryRowStore,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
  CapabilityUnavailableError,
  isCapabilityUnavailable,
  createEntityIdFactory,
  EntityIdMap,
  looksLikeEntityId,
  type PortableDoc,
  type TransactionalDb,
} from "../shared/portable/index";
import { votingPowerPortable, summarizeVotingPower } from "../shared/functions/votingPower";
import { searchPortable } from "../shared/functions/firm";
import { getPortable as societyGetPortable, setLogoPortable, clearLogoPortable } from "../shared/functions/society";
import { buildLocalCapabilities } from "../src/lib/localCapabilities";

// --- deterministic injection so both engines produce byte-identical writes ----
const fixedNow = () => 1000;
const fixedInsertId = () => "rightsHoldings_new";

// --- cap-table fixture (mirrors scripts/check-voting-power.ts expectations) ----
const societyId = "soc_riverside";
function buildFixture(): Record<string, PortableDoc[]> {
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

function memoryEngine(): TransactionalDb {
  return new MemoryDb({ seed: buildFixture(), mintId: fixedInsertId, now: fixedNow });
}
function localEngine(): TransactionalDb {
  return new LocalStoreDb(new MemoryRowStore(buildFixture()), { mintId: fixedInsertId, now: fixedNow });
}

function votingRuntime(db: TransactionalDb): PortableRuntime {
  return new PortableRuntime({ db, capabilities: makeCapabilities({}) }).register(
    definePortableQuery({ name: "legalOperations:votingPower", handler: votingPowerPortable }),
  );
}

// === 1. votingPower runs IDENTICALLY on both engines + the shared marshaller ===
{
  const fromMemory: any = await votingRuntime(memoryEngine()).runQuery("legalOperations:votingPower", { societyId });
  const fromLocal: any = await votingRuntime(localEngine()).runQuery("legalOperations:votingPower", { societyId });

  // Same portable handler, two storage engines -> byte-identical output.
  assert.deepEqual(fromLocal, fromMemory, "MemoryDb and LocalStoreDb diverged for votingPower");

  // Both equal the marshaller the static mirror calls (src/lib/staticConvex.ts).
  const fx = buildFixture();
  const fromMirrorPath = summarizeVotingPower({
    classes: fx.rightsClasses,
    holdings: fx.rightsHoldings,
    roleHolders: fx.roleHolders,
    directory: fx.peopleDirectory,
  });
  assert.deepEqual(fromMemory, fromMirrorPath, "portable handler diverged from the static-mirror marshaller");

  // Pin the actual numbers (same invariants as the legacy check-voting-power.ts).
  assert.equal(fromMemory.totalVotes, 1600, "totalVotes");
  assert.deepEqual(fromMemory.voting.map((h: any) => h.holderKey), ["alice", "vane", "tim"], "voting order");
  assert.deepEqual(fromMemory.nonVoting.map((h: any) => h.holderKey), ["carol"], "nonVoting");
  assert.deepEqual(fromMemory.eligibleSigners.map((h: any) => h.holderKey), ["alice"], "eligible signatories");
  console.log("✓ votingPower: MemoryDb == LocalStoreDb == static-mirror marshaller (totalVotes=1600)");
}

// === 2. an atomic mutation commits identically; a throw rolls everything back ===
const issueHolding = definePortableMutation({
  name: "demo:issueHolding",
  handler: async (ctx, args: { boom?: boolean }) => {
    await ctx.db.insert("rightsHoldings", {
      societyId,
      holderKey: "dana",
      rightsClassId: "classA",
      quantity: 25,
      status: "current",
    });
    const cls = await ctx.db.get("classA");
    await ctx.db.patch("classA", { highestAssignedNumber: Number(cls?.highestAssignedNumber ?? 0) + 1 });
    if (args.boom) throw new Error("injected failure AFTER writes");
    return { ok: true };
  },
});

async function holdingsAndClass(db: TransactionalDb) {
  const ctxQ = new PortableRuntime({ db, capabilities: makeCapabilities({}) });
  ctxQ.register(definePortableQuery({ name: "demo:dump", handler: async (c) => {
    const holdings = (await c.db.query("rightsHoldings").collect()).sort((a, b) => a._id.localeCompare(b._id));
    const classA = await c.db.get("classA");
    return { holdings, classA };
  } }));
  return ctxQ.runQuery("demo:dump");
}

{
  // Successful commit: both engines reach the same state.
  const mem = memoryEngine();
  const loc = localEngine();
  await new PortableRuntime({ db: mem, capabilities: makeCapabilities({}) }).register(issueHolding).runMutation("demo:issueHolding", {});
  await new PortableRuntime({ db: loc, capabilities: makeCapabilities({}) }).register(issueHolding).runMutation("demo:issueHolding", {});

  const memState: any = await holdingsAndClass(mem);
  const locState: any = await holdingsAndClass(loc);
  assert.deepEqual(locState, memState, "MemoryDb and LocalStoreDb diverged after a mutation");
  assert.equal(memState.holdings.length, 5, "new holding should be inserted");
  assert.equal(memState.classA.highestAssignedNumber, 1, "class should be patched");
  console.log("✓ mutation: MemoryDb == LocalStoreDb after commit (insert + patch in one transaction)");
}

{
  // Injected failure: the insert AND the patch must both roll back, on both engines.
  for (const [label, db] of [["MemoryDb", memoryEngine()], ["LocalStoreDb", localEngine()]] as const) {
    const before: any = await holdingsAndClass(db);
    await assert.rejects(
      () => new PortableRuntime({ db, capabilities: makeCapabilities({}) }).register(issueHolding).runMutation("demo:issueHolding", { boom: true }),
      /injected failure/,
      `${label} should propagate the error`,
    );
    const after: any = await holdingsAndClass(db);
    assert.deepEqual(after, before, `${label}: mutation did not roll back atomically`);
  }
  console.log("✓ rollback: a throw mid-mutation leaves NO partial writes (atomic) on both engines");
}

// === 3. injected capabilities: present works, absent fails LOUDLY + structured ==
{
  const sent: string[] = [];
  const caps = makeCapabilities(
    { email: { async sendEmail(input) { sent.push(input.to); return { id: "e1", accepted: true }; } } },
    (cap) => `No ${cap} provider connected to this workspace.`,
  );

  assert.equal(caps.has("email"), true);
  assert.equal(caps.has("sms"), false);
  const res = await caps.email.sendEmail({ to: "board@example.org", subject: "Notice" });
  assert.deepEqual(res, { id: "e1", accepted: true });
  assert.deepEqual(sent, ["board@example.org"]);

  let captured: unknown;
  try {
    await caps.sms.sendSms({ to: "+15551234567", body: "hi" });
    assert.fail("absent capability should have thrown");
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof CapabilityUnavailableError, "should throw CapabilityUnavailableError");
  assert.deepEqual((captured as CapabilityUnavailableError).toJSON(), {
    code: "CAPABILITY_UNAVAILABLE",
    capability: "sms",
    reason: "No sms provider connected to this workspace.",
  });
  assert.ok(isCapabilityUnavailable((captured as CapabilityUnavailableError).toJSON()));
  console.log("✓ capabilities: present capability runs; absent one throws structured CAPABILITY_UNAVAILABLE");
}

// === 4. stable application ids: sortable, monotonic, round-trippable ===========
{
  let t = 1_700_000_000_000;
  const factory = createEntityIdFactory({ now: () => t, random: () => 0.42 });
  const a = factory.mint("meeting");
  const b = factory.mint("meeting"); // same ms -> counter keeps it monotonic
  t += 1;
  const c = factory.mint("meeting");
  assert.ok(a < b && b < c, "entity ids must be lexicographically monotonic");
  assert.ok(a.startsWith("meeting_"));
  assert.ok(looksLikeEntityId(a, "meeting"), "should be recognizable as an entity id");

  const map = new EntityIdMap();
  const minted = map.ensureEntityFor("convex_native_123", () => factory.mint());
  assert.equal(map.nativeFor(minted), "convex_native_123");
  assert.equal(map.entityFor("convex_native_123"), minted);
  assert.equal(map.ensureEntityFor("convex_native_123", () => "SHOULD_NOT_MINT"), minted, "idempotent");
  console.log("✓ ids: monotonic sortable entityIds + bidirectional native<->entity map");
}

// === 5. full-text search (withSearchIndex) parity + semantics =================
{
  const searchFixture = (): Record<string, PortableDoc[]> => ({
    societies: [{ _id: "soc_a", legalName: "Riverside Society", _creationTime: 1 }],
    deadlines: [
      { _id: "dl_1", societyId: "soc_a", title: "Annual Report Filing", _creationTime: 2 },
      { _id: "dl_2", societyId: "soc_a", title: "Quarterly Budget Review", _creationTime: 3 },
    ],
    documents: [
      { _id: "doc_1", societyId: "soc_a", title: "Annual General Meeting Minutes", _creationTime: 4 },
      { _id: "doc_2", societyId: "soc_a", title: "Lease Agreement", _creationTime: 5 },
    ],
    peopleDirectory: [
      { _id: "p_1", fullName: "Annabelle Stone", _creationTime: 6 },
      { _id: "p_2", fullName: "Bob Jones", _creationTime: 7 },
    ],
  });
  const ctxFor = (db: TransactionalDb) => ({ db, capabilities: makeCapabilities({}), runQuery: async () => undefined });

  const memCtx = ctxFor(new MemoryDb({ seed: searchFixture() }));
  const localCtx = ctxFor(new LocalStoreDb(new MemoryRowStore(searchFixture())));

  // Prefix-on-last-term: "ann" hits "Annual…" and "Annabelle".
  const memHits = await searchPortable(memCtx, { query: "ann" });
  const localHits = await searchPortable(localCtx, { query: "ann" });
  assert.deepEqual(localHits, memHits, "MemoryDb and LocalStoreDb diverged for withSearchIndex");
  const ids = new Set(memHits.map((r: any) => r.id));
  assert.ok(ids.has("dl_1") && ids.has("doc_1") && ids.has("p_1"), "search 'ann' should hit annual/Annabelle rows");
  assert.ok(!ids.has("dl_2") && !ids.has("doc_2") && !ids.has("p_2"), "search 'ann' must not hit non-matching rows");

  // Multi-term is AND: "annual report" keeps the deadline, drops the AGM doc.
  const andHits = (await searchPortable(memCtx, { query: "annual report" })).map((r: any) => r.id);
  assert.ok(andHits.includes("dl_1"), "multi-term AND should keep 'Annual Report Filing'");
  assert.ok(!andHits.includes("doc_1"), "multi-term AND should drop a row missing a term");

  // The <2-char guard returns nothing.
  assert.deepEqual(await searchPortable(memCtx, { query: "a" }), [], "search guard: <2 chars returns []");
  console.log("✓ search: withSearchIndex MemoryDb == LocalStoreDb (prefix + multi-term AND + guard)");
}

// === 6. storage capability: read handlers resolve blobs via ctx.capabilities ==
{
  const caps = buildLocalCapabilities({ runtimeLabel: "test" });

  // The local storage capability: passthrough for self-contained URLs, null for
  // a Convex _storage id (no local blob), and uploads decline loudly.
  assert.deepEqual(await caps.storage.getDownloadUrl({ storageKey: "data:image/png;base64,AAA" }), { url: "data:image/png;base64,AAA" });
  assert.deepEqual(await caps.storage.getDownloadUrl({ storageKey: "kg9_storage_id" }), { url: null });
  await assert.rejects(() => caps.storage.createUploadUrl({}), /CAPABILITY_UNAVAILABLE/);

  // society:get resolves logo/letterhead through the capability — identical on
  // both local engines (inline logo resolves; an unresolvable id → undefined).
  const seed = (): Record<string, PortableDoc[]> => ({
    societies: [{ _id: "soc_1", legalName: "Riverbend", logoStorageId: "data:image/png;base64,AAA", letterheadStorageId: "kg9_storage_id", _creationTime: 1 }],
  });
  const ctxFor = (db: TransactionalDb) => ({ db, capabilities: caps, runQuery: async () => undefined });
  const fromMem = await societyGetPortable(ctxFor(new MemoryDb({ seed: seed() })) as any, {} as any);
  const fromLocal = await societyGetPortable(ctxFor(new LocalStoreDb(new MemoryRowStore(seed()))) as any, {} as any);
  assert.deepEqual(fromLocal, fromMem, "MemoryDb and LocalStoreDb diverged for society:get");
  assert.equal(fromMem.logoUrl, "data:image/png;base64,AAA", "inline logo resolves via storage capability");
  assert.equal(fromMem.letterheadUrl, undefined, "unresolvable _storage id → undefined (no local blob)");

  // Write side: setLogo persists the field (the old-blob delete is a capability
  // no-op locally) and clearLogo removes it — offline logo lifecycle, option A.
  const wdb = new MemoryDb({ seed: { societies: [{ _id: "soc_w", legalName: "W", _creationTime: 1 }] } });
  const wctx: any = { db: wdb, capabilities: caps, runQuery: async () => undefined, runMutation: async () => undefined };
  await wdb.transaction(() => setLogoPortable(wctx, { societyId: "soc_w", storageId: "data:image/png;base64,Z" }));
  assert.equal((await societyGetPortable(wctx, {} as any)).logoUrl, "data:image/png;base64,Z", "setLogo persists + read resolves it");
  await wdb.transaction(() => clearLogoPortable(wctx, { societyId: "soc_w" }));
  assert.equal((await societyGetPortable(wctx, {} as any)).logoUrl, undefined, "clearLogo removes the logo");
  console.log("✓ storage: read passthrough/null + society:get parity + setLogo/clearLogo persist offline");
}

console.log("\nAll portable-runtime conformance checks passed.");
