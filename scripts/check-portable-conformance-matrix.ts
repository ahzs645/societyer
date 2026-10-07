// Broad differential conformance matrix for the WHOLE portable surface.
//
// docs/portable-functions-architecture.md item 2: the convex-test oracle proves
// a handful of domains against real Convex, but nothing exercised the *breadth*
// of the registry across the two dependency-free local engines. This harness
// does: it takes every registered portable function in the authoritative
// PORTABLE_FUNCTIONS array and runs each one on
//   - MemoryDb      (the reference engine), and
//   - LocalStoreDb  (the real browser/Electron adapter, over MemoryRowStore)
// from an IDENTICAL, realistically-seeded workspace, then asserts the two engines
// agree. Same handler + same input + same data ⇒ identical output (or an
// identical throw). Any asymmetry is a portability bug.
//
// It is a SMOKE matrix, not a spec oracle: functions are invoked with a small set
// of candidate args, so an id-specific handler may just consistently return
// null/empty on both engines. That still proves the two engines never diverge,
// which is the property the local-first bet depends on. Behavioural correctness
// against real Convex stays the job of check-portable-convex-oracle.ts.

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { inspect } from "node:util";
const startedAt = performance.now();

// Freeze wall-clock + randomness BEFORE any handler runs. Many portable handlers
// stamp timestamps with `new Date()` / `Date.now()` and mint tokens with
// `Math.random()` directly (rather than an injected clock). That's a real
// determinism nuance, but it is NOT a storage-engine difference — and this
// harness compares STORAGE ENGINES. Freezing them makes both engines execute a
// handler at one logical instant, so any remaining diff is a genuine MemoryDb vs
// LocalStoreDb divergence, not the clock ticking between the two runs.
const FROZEN_MS = 1_700_000_000_000;
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    super(...((args.length === 0 ? [FROZEN_MS] : args) as []));
  }
  static now() {
    return FROZEN_MS;
  }
}
globalThis.Date = FrozenDate as DateConstructor;
Math.random = () => 0.42;

import {
  MemoryDb,
  LocalStoreDb,
  MemoryRowStore,
  PortableRuntime,
  type PortableDoc,
  type PortablePrincipal,
} from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { DEFAULT_HEAVY_FIELD_POLICY } from "../shared/portable/heavyFields";
import { runPortable as seedDemoSociety } from "../shared/functions/seed";
import { PERMISSIONS } from "../shared/functions/permissions";
import { buildLocalCapabilities } from "../src/lib/localCapabilities";

import { portableTestPrincipal, seedPortableTestMembership } from "./portable-test-fixture";

type Fixture = Record<string, PortableDoc[]>;

const FIXED_NOW = 1_700_000_000_000;
const fixedNow = () => FIXED_NOW;
// Each engine gets its OWN counter so the two produce an identical id sequence
// for any writes a mutation makes (a shared closure would interleave them).
const makeMintId = (scope = "smoke") => {
  let n = 0;
  return (table: string) => `${table}__${scope}_${n++}`;
};
const caps = buildLocalCapabilities({ runtimeLabel: "conformance-matrix" });
const clone = <T>(v: T): T => structuredClone(v);

// --- 1. Seed one realistic workspace, capture it as a shared fixture ----------
// runPortable seeds the demo society exclusively through ctx.db, so it runs on
// the local engine unchanged. We seed once, then load the SAME rows into both
// engines for every function under test.
async function buildFixture(): Promise<{ fixture: Fixture; societyId: string; principal: PortablePrincipal }> {
  const store = new MemoryRowStore();
  // Fixture ids cannot collide with a tested mutation's fresh id sequence.
  const db = new LocalStoreDb(store, { mintId: makeMintId("seed"), now: fixedNow });
  const fixturePrincipal = portableTestPrincipal();
  assert(fixturePrincipal.kind === "user", "fixture must supply a workspace user");
  const runtime = new PortableRuntime({ db, capabilities: caps, principalProvider: () => fixturePrincipal }).registerAll(PORTABLE_FUNCTIONS);
  // seed:run is intentionally unregistered (server-only), so call the handler
  // directly through a mutation transaction, exactly as the runtime would.
  const { societyId } = await db.transaction(() =>
    seedDemoSociety({ db, capabilities: caps, principal: fixturePrincipal, runQuery: (n, a) => runtime.runQuery(n, a), runMutation: (n, a) => runtime.runMutation(n, a) }),
  );
  const userId = await db.transaction(() => seedPortableTestMembership({ db }, societyId));
  const principal: PortablePrincipal = { ...fixturePrincipal, userId, societyId };
  const fixture: Fixture = {};
  for (const table of store.tableNames()) fixture[table] = store.rows(table);
  return { fixture, societyId, principal };
}

// --- state capture + normalisation for cross-engine comparison ----------------
function normalize(state: Record<string, PortableDoc[]>): Record<string, PortableDoc[]> {
  const out: Record<string, PortableDoc[]> = {};
  for (const table of Object.keys(state).sort()) {
    const rows = [...state[table]].filter((r) => r && r._id != null);
    rows.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    if (rows.length) out[table] = rows;
  }
  return out;
}
function memState(db: MemoryDb): Record<string, PortableDoc[]> {
  const s: Record<string, PortableDoc[]> = {};
  for (const t of db.tableNames()) s[t] = db.dump(t);
  return normalize(s);
}
function localState(store: MemoryRowStore): Record<string, PortableDoc[]> {
  const s: Record<string, PortableDoc[]> = {};
  for (const t of store.tableNames()) s[t] = store.fullRows(t);
  return normalize(s);
}

// Third engine: the same LocalStoreDb over a store that behaves like the
// browser vault at scale — every non-empty heavy field (documents.content,
// minutes source records, …) lives outside the row cache and is loaded lazily,
// and lookups go through the id map and equality indexes. It must agree with
// MemoryDb exactly; minLength 0 externalizes even the small seeded values.
const lazyStore = (fixture: Fixture) =>
  new MemoryRowStore(clone(fixture), { heavyFields: { ...DEFAULT_HEAVY_FIELD_POLICY, minLength: 0 }, indexed: true });

type Outcome = { threw: boolean; value?: unknown; error?: unknown };
function errorValue(error: unknown): unknown {
  return error instanceof Error
    ? { name: error.name, message: error.message, ...Object.fromEntries(Object.entries(error)) }
    : error;
}
async function settle(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { threw: false, value: await run() };
  } catch (error) {
    return { threw: true, error };
  }
}

// --- the matrix ---------------------------------------------------------------
const { fixture, societyId, principal } = await buildFixture();
// Give every document extracted text and every minutes record a verbatim source
// copy, so the lazy engine really keeps them out of its row cache and every
// handler that reads them goes through the load-on-demand path.
for (const document of fixture.documents ?? []) {
  document.content ??= `Synthetic extracted text for ${document._id}. ${"Lorem ipsum ".repeat(8)}`;
}
for (const minutes of fixture.minutes ?? []) {
  minutes.draftTranscript ??= `Synthetic transcript for ${minutes._id}.`;
}
assert.ok((fixture.documents ?? []).length > 0, "fixture must contain documents to exercise lazy content");
const CANDIDATE_ARGS: Record<string, unknown>[] = [{ societyId }, {}];

// Shared read engines: queries are read-only, so one pair serves every query.
const queryMem = new MemoryDb({ seed: clone(fixture), mintId: makeMintId(), now: fixedNow });
const queryLocal = new LocalStoreDb(new MemoryRowStore(clone(fixture)), { mintId: makeMintId(), now: fixedNow });
const queryMemRt = new PortableRuntime({ db: queryMem, capabilities: caps, principalProvider: () => principal }).registerAll(PORTABLE_FUNCTIONS);
const queryLocalRt = new PortableRuntime({ db: queryLocal, capabilities: caps, principalProvider: () => principal }).registerAll(PORTABLE_FUNCTIONS);
const queryLazyStore = lazyStore(fixture);
const queryLazyRt = new PortableRuntime({ db: new LocalStoreDb(queryLazyStore, { mintId: makeMintId(), now: fixedNow }), capabilities: caps, principalProvider: () => principal }).registerAll(PORTABLE_FUNCTIONS);
assert.equal(principal.kind, "user");
for (const runtime of [queryMemRt, queryLocalRt]) {
  const authority = await runtime.runQuery<{ role: string; permissions: string[] }>("permissions:myPermissions", { societyId, userId: principal.kind === "user" ? principal.userId : undefined });
  assert.equal(authority.role, "Owner");
  assert.deepEqual(authority.permissions, PERMISSIONS, "fixture owner must have full current permissions");
}

const tally = {
  query: { total: 0, exercised: 0, consistentThrow: 0, divergent: 0 },
  mutation: { total: 0, exercised: 0, consistentThrow: 0, divergent: 0 },
};
const divergences: string[] = [];

function compare(name: string, args: Record<string, unknown>, mem: Outcome, loc: Outcome, states?: { memory: Fixture; local: Fixture }): string {
  try {
    assert.equal(loc.threw, mem.threw, "throw/return outcome");
    if (mem.threw) assert.deepEqual(errorValue(loc.error), errorValue(mem.error), "thrown error");
    else assert.deepEqual(loc.value, mem.value, "return value");
    if (states) assert.deepEqual(states.local, states.memory, "post-state (including rollback)");
    return mem.threw ? "consistentThrow" : "exercised";
  } catch (error) {
    console.error(`${name} args=${inspect(args)}\n${error instanceof Error ? error.message : inspect(error)}`);
    return "divergent";
  }
}

function record(kind: "query" | "mutation", name: string, cells: string[]) {
  const t = tally[kind];
  t.total++;
  if (cells.includes("divergent")) {
    t.divergent++;
    divergences.push(`${name}: ${cells.join(", ")}`);
  } else if (cells.includes("exercised")) {
    t.exercised++;
  } else {
    t.consistentThrow++;
  }
}

for (const def of PORTABLE_FUNCTIONS) {
  if (def.kind === "query") {
    const cells: string[] = [];
    for (const args of CANDIDATE_ARGS) {
      const mem = await settle(() => queryMemRt.runQuery(def.name, args));
      const loc = await settle(() => queryLocalRt.runQuery(def.name, args));
      cells.push(compare(def.name, args, mem, loc));
      const lazy = await settle(() => queryLazyRt.runQuery(def.name, args));
      cells.push(compare(`${def.name} [lazy heavy fields]`, args, mem, lazy));
    }
    record("query", def.name, cells);
  } else {
    const cells: string[] = [];
    for (const args of CANDIDATE_ARGS) {
      // Fresh, identical engine pair per mutation attempt: no cross-contamination.
      const memDb = new MemoryDb({ seed: clone(fixture), mintId: makeMintId(), now: fixedNow });
      const locStore = new MemoryRowStore(clone(fixture));
      const locDb = new LocalStoreDb(locStore, { mintId: makeMintId(), now: fixedNow });
      const memRt = new PortableRuntime({ db: memDb, capabilities: caps, principalProvider: () => principal }).registerAll(PORTABLE_FUNCTIONS);
      const locRt = new PortableRuntime({ db: locDb, capabilities: caps, principalProvider: () => principal }).registerAll(PORTABLE_FUNCTIONS);
      const mem = await settle(() => memRt.runMutation(def.name, args));
      const loc = await settle(() => locRt.runMutation(def.name, args));
      cells.push(compare(def.name, args, mem, loc, { memory: memState(memDb), local: localState(locStore) }));
      const lazyRowStore = lazyStore(fixture);
      const lazyRt = new PortableRuntime({ db: new LocalStoreDb(lazyRowStore, { mintId: makeMintId(), now: fixedNow }), capabilities: caps, principalProvider: () => principal }).registerAll(PORTABLE_FUNCTIONS);
      const lazy = await settle(() => lazyRt.runMutation(def.name, args));
      cells.push(compare(`${def.name} [lazy heavy fields]`, args, mem, lazy, { memory: memState(memDb), local: localState(lazyRowStore) }));
    }
    record("mutation", def.name, cells);
  }
}

// --- report -------------------------------------------------------------------
function line(kind: "query" | "mutation") {
  const t = tally[kind];
  return `  ${kind.padEnd(9)} ${String(t.total).padStart(4)} total  |  ${String(t.exercised).padStart(4)} exercised  |  ${String(t.consistentThrow).padStart(4)} consistent-throw  |  ${t.divergent} divergent`;
}
console.log(`Portable conformance matrix — ${PORTABLE_FUNCTIONS.length} registered functions, seeded society ${societyId}`);
console.log(line("query"));
console.log(line("mutation"));

if (divergences.length) {
  console.error(`\n✗ ${divergences.length} function(s) DIVERGED between MemoryDb and LocalStoreDb:`);
  for (const d of divergences) console.error(`  - ${d}`);
  process.exit(1);
}

console.log(`  elapsed: ${((performance.now() - startedAt) / 1000).toFixed(2)}s`);
console.log(`  lazy heavy-field loads: ${queryLazyStore.externalLoads} (query engine)`);
assert.ok(queryLazyStore.externalLoads > 0, "the lazy engine must have loaded heavy fields on demand");
console.log("\n✓ MemoryDb and LocalStoreDb (eager, and lazy/indexed) agree across the entire portable surface.");
