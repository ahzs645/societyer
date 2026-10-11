// Scale gate for the local runtime (WP-K). Runs in Node, no browser:
//
//  1. Lazy heavy fields: a LocalStoreDb over a store that keeps heavy fields out
//     of its row cache answers exactly like an eager one, never loads a field a
//     query projected away (`omitFields`, `get(..., { omitFields })`), and loads
//     only the rows whose predicate actually touched a lazy field.
//  2. Memoized projections: `collectProjected` re-projects only rows whose
//     revision changed, and never reloads heavy fields on a hit.
//  3. Equality indexes: compound eq constraints return the same rows as a scan.
//  4. Table-scoped reactivity: the query cache re-runs only the queries whose
//     read set intersects the tables a write touched.
//  5. Synthetic large workspace (scripts/perf/synthetic-workspace.mjs, no real
//     data): the list queries the heavy pages use never load extracted text or
//     verbatim minutes sources, a warm documents:browse loads nothing, and each
//     stays under a generous time budget.
//
// The browser end-to-end budget (cold loads < 3 s, heap < 200 MB) is the
// separate scripts/check-local-workspace-perf.mjs gate.

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { LocalStoreDb, MemoryDb, MemoryRowStore, PortableRuntime, definePortableQuery, type PortableDoc, type PortablePrincipal } from "../shared/portable/index";
import { DEFAULT_HEAVY_FIELD_POLICY, splitHeavyFields } from "../shared/portable/heavyFields";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { buildLocalCapabilities } from "../src/lib/localCapabilities";
import { PortableQueryCache, sameQueryResult } from "../src/lib/portableQueryCache";
import type { StaticDemoDexieStore } from "../src/lib/staticDemoStore";
import { LocalDexieRowStore } from "../src/lib/localDexieRowStore";
// Plain ESM helper shared with the browser perf gate (scripts/check-local-workspace-perf.mjs).
import { buildSyntheticWorkspace } from "./perf/synthetic-workspace.mjs";

const caps = buildLocalCapabilities({ runtimeLabel: "local-workspace-scale" });
const lazyPolicy = { ...DEFAULT_HEAVY_FIELD_POLICY, minLength: 0 };
const bySociety = (q: any) => q.eq("societyId", "s1");

// --- 1. lazy heavy fields ------------------------------------------------------
{
  const seed: Record<string, PortableDoc[]> = {
    documents: [
      { _id: "d1", _creationTime: 1, societyId: "s1", category: "Other", title: "Alpha", content: "the quick brown fox" },
      { _id: "d2", _creationTime: 2, societyId: "s1", category: "Other", title: "Beta", content: "lazy dog" },
      { _id: "d3", _creationTime: 3, societyId: "s1", category: "Minutes", title: "Gamma" },
      { _id: "d4", _creationTime: 4, societyId: "s2", category: "Other", title: "Delta", content: "elsewhere" },
    ],
  };
  const lazyStore = new MemoryRowStore(structuredClone(seed), { heavyFields: lazyPolicy, indexed: true });
  const lazy = new LocalStoreDb(lazyStore);
  const eager = new MemoryDb({ seed: structuredClone(seed) });

  assert.deepEqual(lazyStore.rows("documents").find((row) => row._id === "d1"), { _id: "d1", _creationTime: 1, societyId: "s1", category: "Other", title: "Alpha" }, "heavy field is kept out of the row cache");
  const light = await lazy.query("documents").withIndex("by_society", bySociety).omitFields("content").collect();
  assert.equal(lazyStore.externalLoads, 0, "an omitted heavy field is never loaded");
  assert.deepEqual(light, await eager.query("documents").withIndex("by_society", bySociety).omitFields("content").collect());

  const full = await lazy.query("documents").withIndex("by_society", bySociety).collect();
  assert.deepEqual(full, await eager.query("documents").withIndex("by_society", bySociety).collect(), "materialized rows equal eager rows");
  assert.equal(lazyStore.externalLoads, 2, "only rows that have lazy fields are loaded");

  const before = lazyStore.externalLoads;
  const byTitle = await lazy.query("documents").filter((doc) => doc.title === "Beta").omitFields("content").collect();
  assert.equal(byTitle.length, 1);
  assert.equal(lazyStore.externalLoads, before, "a predicate that never reads a lazy field loads nothing");
  const byContent = await lazy.query("documents").filter((doc) => String(doc.content ?? "").includes("fox")).collect();
  assert.deepEqual(byContent.map((doc) => doc._id), ["d1"], "a predicate over a lazy field sees the complete row");
  assert.deepEqual(byContent, await eager.query("documents").filter((doc) => String(doc.content ?? "").includes("fox")).collect());

  const loadsBeforeGet = lazyStore.externalLoads;
  assert.deepEqual(await lazy.get("d1", "documents", { omitFields: ["content"] }), await eager.get("d1", "documents", { omitFields: ["content"] }));
  assert.equal(lazyStore.externalLoads, loadsBeforeGet, "get(..., { omitFields }) does not load the field");
  assert.deepEqual(await lazy.get("d1"), await eager.get("d1"));

  // Writes keep heavy values: a patch that does not touch content preserves it.
  await lazy.transaction(async () => lazy.patch("d2", { title: "Beta 2" }));
  assert.equal((await lazy.get("d2"))?.content, "lazy dog", "a patch keeps the lazy field");
  await lazy.transaction(async () => lazy.replace("d2", { societyId: "s1", category: "Other", title: "Beta 3" }));
  assert.equal((await lazy.get("d2"))?.content, undefined, "replace without the field removes it, as on Convex");

  // 2. memoized projections
  let projected = 0;
  const project = (doc: PortableDoc) => {
    projected += 1;
    return { id: doc._id, length: String(doc.content ?? "").length };
  };
  const first = await lazy.query("documents").withIndex("by_society", bySociety).collectProjected("scale-gate/v1", project);
  assert.equal(projected, 3);
  const loadsAfterFirst = lazyStore.externalLoads;
  const second = await lazy.query("documents").withIndex("by_society", bySociety).collectProjected("scale-gate/v1", project);
  assert.deepEqual(second, first);
  assert.equal(projected, 3, "unchanged rows are not projected again");
  assert.equal(lazyStore.externalLoads, loadsAfterFirst, "a memo hit loads no heavy field");
  await lazy.transaction(async () => lazy.patch("d1", { content: "a much longer replacement text" }));
  const third = await lazy.query("documents").withIndex("by_society", bySociety).collectProjected("scale-gate/v1", project);
  assert.equal(projected, 4, "only the written row is projected again");
  assert.equal(third.find((row) => row.id === "d1")?.length, "a much longer replacement text".length);
  assert.deepEqual(
    await new MemoryDb({ seed: structuredClone(seed) }).query("documents").withIndex("by_society", bySociety).collectProjected("k", (doc) => doc._id),
    ["d1", "d2", "d3"],
    "on Convex/MemoryDb collectProjected is collect().map()",
  );
  second[0].length = -1;
  const fourth = await lazy.query("documents").withIndex("by_society", bySociety).collectProjected("scale-gate/v1", project);
  assert.notEqual(fourth.find((row) => row.id === second[0].id)?.length, -1, "memoized values are handed out as copies");

  // 3. compound equality indexes
  const indexed = await lazy.query("documents").withIndex("by_society_category", (q: any) => q.eq("societyId", "s1").eq("category", "Other")).omitFields("content").collect();
  const scanned = await eager.query("documents").withIndex("by_society_category", (q: any) => q.eq("societyId", "s1").eq("category", "Other")).omitFields("content").collect();
  assert.deepEqual(indexed.map((doc) => doc._id).sort(), scanned.map((doc) => doc._id).sort(), "the index returns the scanned rows");
  console.log("✓ lazy heavy fields, projections memo and compound indexes agree with the eager engine");
}

// --- split policy ---------------------------------------------------------------
{
  const small = splitHeavyFields("documents", { _id: "x", content: "short" });
  assert.equal(small.heavy, null, "short values stay inline under the default policy");
  const big = splitHeavyFields("documents", { _id: "x", title: "t", content: "x".repeat(5000) });
  assert.deepEqual(Object.keys(big.light), ["_id", "title"]);
  assert.equal(big.heavy?.content, "x".repeat(5000));
  assert.equal(splitHeavyFields("tasks", { _id: "t", description: "y".repeat(5000) }).heavy, null, "only policy fields are ever externalized");
}

// --- 4. table-scoped reactivity -------------------------------------------------
{
  const store = new LocalDexieRowStore({
    societies: [{ _id: "s1", name: "Synthetic" }],
    tasks: [{ _id: "t1", societyId: "s1", title: "One" }],
    documents: [{ _id: "d1", societyId: "s1", title: "Doc" }],
  });
  const db = new LocalStoreDb(store);
  const principal: PortablePrincipal = { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "test:scale" };
  const runtime = new PortableRuntime({ db, capabilities: caps, principalProvider: () => principal }).registerAll([
    definePortableQuery({ name: "scale:tasks", access: { audience: "public" }, handler: async (ctx) => ctx.db.query("tasks").collect() }),
    definePortableQuery({ name: "scale:documents", access: { audience: "public" }, handler: async (ctx) => ctx.db.query("documents").collect() }),
  ]);
  const runs = new Map<string, number>();
  const counted = {
    runQuery: (name: string, args: any) => runtime.runQuery(name, args),
    runQueryTracked: async (name: string, args: any) => {
      runs.set(name, (runs.get(name) ?? 0) + 1);
      return runtime.runQueryTracked(name, args);
    },
  };
  const cache = new PortableQueryCache(counted as unknown as PortableRuntime, store as unknown as StaticDemoDexieStore, () => undefined);
  const settle = async () => { for (let index = 0; index < 20; index++) await new Promise((resolve) => setTimeout(resolve, 0)); };
  const tasks = cache.watchQuery("scale:tasks", {});
  const documents = cache.watchQuery("scale:documents", {});
  const stopTasks = tasks.onUpdate(() => undefined);
  const stopDocuments = documents.onUpdate(() => undefined);
  await settle();
  const baseline = { tasks: runs.get("scale:tasks") ?? 0, documents: runs.get("scale:documents") ?? 0 };
  assert.ok(baseline.tasks >= 1 && baseline.documents >= 1);
  // Re-subscribing to a fresh, unaffected result does not re-run it.
  const again = documents.onUpdate(() => undefined);
  await settle();
  assert.equal(runs.get("scale:documents"), baseline.documents, "a fresh result is not recomputed for another subscriber");
  await db.transaction(async () => { await db.insert("tasks", { societyId: "s1", title: "Two" }); });
  await settle();
  assert.equal(runs.get("scale:tasks"), baseline.tasks + 1, "a write to tasks re-runs the tasks query");
  assert.equal(runs.get("scale:documents"), baseline.documents, "…and leaves the documents query alone");
  assert.equal((tasks.localQueryResult() as unknown[]).length, 2);
  again();
  stopTasks();
  stopDocuments();
  assert.ok(sameQueryResult({ a: [1, { b: undefined }], c: "x" }, { c: "x", a: [1, {}] }), "result equality ignores undefined keys like JSON");
  assert.ok(!sameQueryResult({ a: [1, 2] }, { a: [2, 1] }));
  console.log("✓ query cache re-runs only queries whose tables changed");
}

// --- 5. synthetic large workspace ------------------------------------------------
{
  const scale = Number(process.env.SOCIETYER_SCALE_GATE_SCALE ?? "0.35");
  const snapshot = buildSyntheticWorkspace({ scale });
  const societyId = snapshot.tables.societies[0]._id as string;
  const userId = snapshot.tables.users[0]._id as string;
  const store = new MemoryRowStore(snapshot.tables, { heavyFields: true, indexed: true });
  const db = new LocalStoreDb(store);
  const principal: PortablePrincipal = { kind: "user", runtime: "browser-local", assurance: "trusted-workspace", subject: "local:scale-gate", userId, societyId };
  const runtime = new PortableRuntime({ db, capabilities: caps, principalProvider: () => principal }).registerAll(PORTABLE_FUNCTIONS);
  const budgetMs = Number(process.env.SOCIETYER_SCALE_GATE_BUDGET_MS ?? "6000");
  const timed = async (name: string, args: Record<string, unknown>) => {
    const started = performance.now();
    const result = await runtime.runQuery<any>(name, args);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < budgetMs, `${name} took ${Math.round(elapsed)} ms (budget ${budgetMs} ms)`);
    return { result, elapsed };
  };

  const loads0 = store.externalLoads;
  const documents = await timed("documents:listSummaries", { societyId });
  assert.ok(documents.result.length > 0);
  assert.ok(documents.result.every((row: any) => !("content" in row)), "summaries carry no content");
  const meetings = await timed("meetings:list", { societyId });
  assert.ok(meetings.result.length > 0);
  assert.equal(store.externalLoads, loads0, "list summaries never load extracted text");

  const minutesFirst = await timed("minutes:listLight", { societyId });
  assert.ok(minutesFirst.result.length > 0);
  assert.ok(minutesFirst.result.every((row: any) => !("sourceMeetingRecord" in row) && !("draftTranscript" in row)));
  const loadsAfterMinutes = store.externalLoads;
  await timed("minutes:listLight", { societyId });
  assert.equal(store.externalLoads, loadsAfterMinutes, "a warm light minutes list loads no source records");
  const summariesFirst = await timed("minutes:listSummaries", { societyId });
  assert.ok(summariesFirst.result.length > 0);
  const loadsAfterSummaries = store.externalLoads;
  await timed("minutes:listSummaries", { societyId });
  assert.equal(store.externalLoads, loadsAfterSummaries, "warm per-meeting summaries load no source records");

  const browseFirst = await timed("documents:browse", { societyId });
  assert.ok(browseFirst.result.rows.length > 0);
  const loadsAfterBrowse = store.externalLoads;
  const browseWarm = await timed("documents:browse", { societyId });
  assert.equal(store.externalLoads, loadsAfterBrowse, "a warm documents:browse loads no content");
  assert.deepEqual(browseWarm.result, browseFirst.result, "memoized provenance gives the same catalog");

  await timed("importSessions:pendingByTarget", { societyId });
  const loadsAfterQueue = store.externalLoads;
  const queueWarm = await timed("importSessions:pendingByTarget", { societyId });
  assert.equal(store.externalLoads, loadsAfterQueue, "a warm review queue loads no candidate content");
  assert.ok(queueWarm.result.pending > 0);
  console.log(
    `✓ synthetic workspace (scale ${scale}, ${Object.values(snapshot.tables as Record<string, unknown[]>).reduce((sum, rows) => sum + rows.length, 0)} rows): ` +
      `listSummaries ${Math.round(documents.elapsed)} ms, minutes ${Math.round(minutesFirst.elapsed)} ms, ` +
      `browse ${Math.round(browseFirst.elapsed)} → ${Math.round(browseWarm.elapsed)} ms warm, review queue warm ${Math.round(queueWarm.elapsed)} ms`,
  );
}

console.log("Local workspace scale checks passed.");
