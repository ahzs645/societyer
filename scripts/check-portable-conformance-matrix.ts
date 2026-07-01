// Broad differential conformance matrix for the WHOLE portable surface.
//
// docs/portable-functions-architecture.md item 2: the convex-test oracle proves
// a handful of domains against real Convex, but nothing exercised the *breadth*
// of the registry across the two dependency-free local engines. This harness
// does: it takes the generated manifest's work-list (every registered portable
// function — the authoritative PORTABLE_FUNCTIONS array) and runs each one on
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
  constructor(...args: any[]) {
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
} from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { runPortable as seedDemoSociety } from "../shared/functions/seed";
import { buildLocalCapabilities } from "../src/lib/localCapabilities";

type Fixture = Record<string, PortableDoc[]>;

const FIXED_NOW = 1_700_000_000_000;
const fixedNow = () => FIXED_NOW;
// Each engine gets its OWN counter so the two produce an identical id sequence
// for any writes a mutation makes (a shared closure would interleave them).
const makeMintId = () => {
  let n = 0;
  return (table: string) => `${table}__smoke_${n++}`;
};
const caps = buildLocalCapabilities({ runtimeLabel: "conformance-matrix" });
const clone = <T>(v: T): T => structuredClone(v);

// --- 1. Seed one realistic workspace, capture it as a shared fixture ----------
// runPortable seeds the demo society exclusively through ctx.db, so it runs on
// the local engine unchanged. We seed once, then load the SAME rows into both
// engines for every function under test.
async function buildFixture(): Promise<{ fixture: Fixture; societyId: string }> {
  const store = new MemoryRowStore();
  const db = new LocalStoreDb(store, { mintId: makeMintId(), now: fixedNow });
  const runtime = new PortableRuntime({ db, capabilities: caps }).registerAll(PORTABLE_FUNCTIONS);
  // seed:run is intentionally unregistered (server-only), so call the handler
  // directly through a mutation transaction, exactly as the runtime would.
  const { societyId } = await db.transaction(() =>
    seedDemoSociety({ db, capabilities: caps, runQuery: (n, a) => runtime.runQuery(n, a), runMutation: (n, a) => runtime.runMutation(n, a) }),
  );
  const fixture: Fixture = {};
  for (const table of store.tableNames()) fixture[table] = store.rows(table);
  return { fixture, societyId };
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
  for (const t of store.tableNames()) s[t] = store.rows(t);
  return normalize(s);
}

type Outcome = { threw: boolean; value?: unknown; error?: unknown };
async function settle(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { threw: false, value: await run() };
  } catch (error) {
    return { threw: true, error };
  }
}

// --- the matrix ---------------------------------------------------------------
const { fixture, societyId } = await buildFixture();
const CANDIDATE_ARGS: Record<string, any>[] = [{ societyId }, {}];

// Shared read engines: queries are read-only, so one pair serves every query.
const queryMem = new MemoryDb({ seed: clone(fixture), mintId: makeMintId(), now: fixedNow });
const queryLocal = new LocalStoreDb(new MemoryRowStore(clone(fixture)), { mintId: makeMintId(), now: fixedNow });
const queryMemRt = new PortableRuntime({ db: queryMem, capabilities: caps }).registerAll(PORTABLE_FUNCTIONS);
const queryLocalRt = new PortableRuntime({ db: queryLocal, capabilities: caps }).registerAll(PORTABLE_FUNCTIONS);

const tally = {
  query: { total: 0, exercised: 0, consistentThrow: 0, divergent: 0 },
  mutation: { total: 0, exercised: 0, consistentThrow: 0, divergent: 0 },
};
const divergences: string[] = [];

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
      if (mem.threw !== loc.threw) cells.push("divergent");
      else if (mem.threw) cells.push("consistentThrow");
      else {
        try {
          assert.deepEqual(loc.value, mem.value);
          cells.push("exercised");
        } catch {
          cells.push("divergent");
        }
      }
    }
    record("query", def.name, cells);
  } else {
    const cells: string[] = [];
    for (const args of CANDIDATE_ARGS) {
      // Fresh, identical engine pair per mutation attempt: no cross-contamination.
      const memDb = new MemoryDb({ seed: clone(fixture), mintId: makeMintId(), now: fixedNow });
      const locStore = new MemoryRowStore(clone(fixture));
      const locDb = new LocalStoreDb(locStore, { mintId: makeMintId(), now: fixedNow });
      const memRt = new PortableRuntime({ db: memDb, capabilities: caps }).registerAll(PORTABLE_FUNCTIONS);
      const locRt = new PortableRuntime({ db: locDb, capabilities: caps }).registerAll(PORTABLE_FUNCTIONS);
      const mem = await settle(() => memRt.runMutation(def.name, args));
      const loc = await settle(() => locRt.runMutation(def.name, args));
      if (mem.threw !== loc.threw) cells.push("divergent");
      else if (mem.threw) cells.push("consistentThrow");
      else {
        try {
          assert.deepEqual(loc.value, mem.value, "return value");
          assert.deepEqual(localState(locStore), memState(memDb), "post-state");
          cells.push("exercised");
        } catch {
          cells.push("divergent");
        }
      }
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

console.log("\n✓ MemoryDb and LocalStoreDb agree across the entire portable surface.");
