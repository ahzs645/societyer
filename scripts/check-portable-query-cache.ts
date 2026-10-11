import assert from "node:assert/strict";
import { isRolePermissionDenial, LocalQueryError, PortableQueryCache } from "../src/lib/portableQueryCache";
import type { PortableRuntime } from "../shared/portable/define";
import type { StaticDemoDexieStore } from "../src/lib/staticDemoStore";

const listeners = new Set<() => void>();
const store = { onUpdate(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback); } };
let principal = "owner";
let authorized = true;
let queryCount = 0;
let revision = 1;
const deferred: Array<{ resolve: (result: unknown) => void; result: unknown }> = [];
let deferQueries = false;
const runtime = {
  async runQuery(name: string, args: any) {
    queryCount += 1;
    if (!authorized) throw new Error("Current principal denied");
    const actorAtExecution = principal;
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: index, principal: actorAtExecution, revision }));
    const offset = Number(args.paginationOpts?.cursor ?? 0);
    const size = args.paginationOpts?.numItems ?? 5;
    const result = name === "example:page" ? { page: rows.slice(offset, offset + size), isDone: offset + size >= rows.length, continueCursor: offset + size >= rows.length ? null : String(offset + size) } : rows;
    if (deferQueries) return new Promise(resolve => deferred.push({ resolve, result }));
    return result;
  },
};
let fallbackReads = 0;
const cache = new PortableQueryCache(runtime as unknown as PortableRuntime, store as unknown as StaticDemoDexieStore, () => { fallbackReads += 1; return [{ unauthorizedFixture: true }]; });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const updateStore = () => { for (const listener of [...listeners]) listener(); };

const page = cache.watchPaginatedQuery("example:page", { societyId: "synthetic-workspace" }, { initialNumItems: 2 });
assert.equal(page.localQueryResult(), undefined, "First read must await authorized execution");
let firstNotifications = 0, secondNotifications = 0;
const unsubscribeFirst = page.onUpdate(() => firstNotifications++);
const secondPage = cache.watchPaginatedQuery("example:page", { societyId: "synthetic-workspace" }, { initialNumItems: 2 });
const unsubscribeSecond = secondPage.onUpdate(() => secondNotifications++);
await settle();
assert.equal(page.localQueryResult()?.results.length, 2);
assert.equal(listeners.size, 1, "Paginated subscribers share the single client-level store listener");

let before = queryCount;
revision = 2;
updateStore();
await settle();
assert.equal(queryCount - before, 1, "One store event must execute one page refresh per shared cache key");
assert.equal(page.localQueryResult()?.results[0].revision, 2);
assert.ok(firstNotifications > 0 && secondNotifications > 0, "Both subscribers must see the refreshed authorized page");

page.localQueryResult()?.loadMore(2);
await settle();
assert.equal(page.localQueryResult()?.results.length, 4);
before = queryCount;
revision = 3;
updateStore();
await settle();
assert.equal(queryCount - before, 2, "A refresh must recompute each loaded page exactly once, preserving pagination");
assert.equal(page.localQueryResult()?.results.length, 4);
assert.equal(secondPage.localQueryResult()?.results[3].revision, 3);
unsubscribeFirst();
before = queryCount;
updateStore();
await settle();
assert.equal(queryCount - before, 2, "Remaining subscriber must still receive store invalidation");

// Principal changes synchronously clear old results and cancel late executions.
deferQueries = true;
updateStore();
assert.ok(deferred.length > 0);
principal = "viewer";
cache.invalidatePrincipal();
assert.equal(page.localQueryResult(), undefined, "Previous principal's page must disappear immediately");
const firstPending = deferred.splice(0);
for (const execution of firstPending) execution.resolve(execution.result);
deferQueries = false;
await settle();
assert.equal(page.localQueryResult()?.results[0].principal, "viewer", "Late owner execution cannot restore the previous principal's snapshot");
assert.ok(page.localQueryResult()?.results.every((row: any) => row.principal === "viewer"));

const ordinary = cache.watchQuery("example:list", { societyId: "synthetic-workspace" });
const unsubscribeOrdinary = ordinary.onUpdate(() => undefined);
await settle();
assert.equal(ordinary.localQueryResult()?.[0].principal, "viewer");
authorized = false;
cache.invalidatePrincipal();
assert.equal(page.localQueryResult(), undefined);
assert.equal(ordinary.localQueryResult(), undefined);
await settle();
assert.equal(page.localQueryResult(), undefined, "Denied current principal cannot retain a previous authorized page");
// P-O2: a failed (non-paginated) query is rethrown to useQuery, like hosted Convex, instead of loading forever.
assert.throws(() => ordinary.localQueryResult(), (error: any) => error instanceof LocalQueryError && error.queryName === "example:list" && /Current principal denied/.test(error.message));
assert.equal(fallbackReads, 0, "Authorization failures never substitute fixture data");

unsubscribeSecond();
unsubscribeOrdinary();
before = queryCount;
updateStore();
await settle();
assert.equal(queryCount, before, "Unsubscribed cache keys must not execute on store changes");

// A scanned tag can miss, leave the screen, then become a real asset. The next
// React snapshot must wait for the fresh authorized lookup instead of consuming
// the retained null and immediately unsubscribing before that lookup resolves.
const assetListeners = new Set<() => void>();
const assets = new Map<string, { _id: string; assetTag: string }>();
let assetLookups = 0;
const assetCache = new PortableQueryCache({
  async runQuery(_name: string, args: { code: string }) { assetLookups += 1; return assets.get(args.code) ?? null; },
} as unknown as PortableRuntime, {
  onUpdate(callback: () => void) { assetListeners.add(callback); return () => assetListeners.delete(callback); },
} as unknown as StaticDemoDexieStore, () => { throw new Error("A synchronous fallback must never supply lookup authority"); });
const tag = { code: "CAMERA-QUALIFICATION-QR" };
const missing = assetCache.watchQuery("assets:resolveScan", tag);
const stopMissing = missing.onUpdate(() => undefined);
await settle();
assert.equal(missing.localQueryResult(), null, "Authorized missing-record lookup returns null");
stopMissing();
assert.equal(missing.localQueryResult(), null, "An unchanged store retains its synchronous last snapshot");
const beforeCreate = assetLookups;
assets.set(tag.code, { _id: "created-local-asset", assetTag: tag.code });
for (const listener of [...assetListeners]) listener();
assert.equal(assetLookups, beforeCreate, "Store changes must not execute inactive lookups");
const created = assetCache.watchQuery("assets:resolveScan", tag);
assert.equal(created.localQueryResult(), undefined, "Reopening the scan must not consume a stale inactive miss");
const stopCreated = created.onUpdate(() => undefined);
await settle();
assert.deepEqual(created.localQueryResult(), assets.get(tag.code), "A fresh authorized lookup resolves the actually created asset");
stopCreated();

// P-O2: errors reach the caller; a retry (re-mount) runs the query again; a vanished record
// is surfaced only when it outlives the grace period (a deleted row's watcher usually unmounts first).
{
  const errorListeners = new Set<() => void>();
  let mode: "fail" | "missing" | "ok" = "fail";
  let runs = 0;
  const errorCache = new PortableQueryCache({
    async runQuery() { runs += 1; if (mode === "fail") throw new Error("Society membership not found."); if (mode === "missing") throw new Error("Record not found."); return [{ ok: true }]; },
  } as unknown as PortableRuntime, {
    onUpdate(callback: () => void) { errorListeners.add(callback); return () => errorListeners.delete(callback); },
  } as unknown as StaticDemoDexieStore, () => undefined);
  let notified = 0;
  const watch = errorCache.watchQuery("people:forRecord", { recordId: "x" });
  assert.equal(watch.localQueryResult(), undefined, "loading while the first run is in flight");
  const stop = watch.onUpdate(() => notified++);
  await settle();
  assert.ok(notified > 0, "subscribers are told about the failure so they re-render");
  assert.throws(() => watch.localQueryResult(), /Society membership not found/);
  stop();
  // convex/react's useQueries builds a new Watch and subscription on every
  // render. A failed query must stay failed through that churn (it used to
  // re-run on each one and sit pending, i.e. "Loading…" forever).
  const runsAfterFailure = runs;
  for (let i = 0; i < 3; i += 1) {
    const churn = errorCache.watchQuery("people:forRecord", { recordId: "x" });
    const stopChurn = churn.onUpdate(() => undefined);
    assert.throws(() => churn.localQueryResult(), /Society membership not found/, "render churn keeps surfacing the failure");
    stopChurn();
  }
  await settle();
  assert.equal(runs, runsAfterFailure, "re-watching a failed query does not re-run it");
  // Retry: the error boundary asks the cache to re-run failed queries, then re-mounts.
  mode = "ok";
  const retried = errorCache.watchQuery("people:forRecord", { recordId: "x" });
  const stopRetried = retried.onUpdate(() => undefined);
  errorCache.retryFailed();
  assert.equal(retried.localQueryResult(), undefined, "a retry starts a fresh run instead of rethrowing");
  await settle();
  assert.deepEqual(retried.localQueryResult(), [{ ok: true }]);
  stopRetried();
  // A data change also re-runs a failed query.
  mode = "fail";
  const failedThenChanged = errorCache.watchQuery("people:forRecord", { recordId: "again" });
  const stopAgain = failedThenChanged.onUpdate(() => undefined);
  await settle();
  assert.throws(() => failedThenChanged.localQueryResult(), /Society membership not found/);
  mode = "ok";
  for (const listener of errorListeners) listener();
  await settle();
  assert.deepEqual(failedThenChanged.localQueryResult(), [{ ok: true }], "a store change re-runs a failed query");
  stopAgain();

  LocalQueryError.NOT_FOUND_GRACE_MS = 20;
  mode = "missing";
  const gone = errorCache.watchQuery("people:forRecord", { recordId: "gone" });
  const stopGone = gone.onUpdate(() => undefined);
  await settle();
  assert.equal(gone.localQueryResult(), undefined, "a vanished record is not surfaced at once");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.throws(() => gone.localQueryResult(), /Record not found/, "a persistent not-found is surfaced after the grace period");
  stopGone();
  const transient = errorCache.watchQuery("people:forRecord", { recordId: "transient" });
  const stopTransient = transient.onUpdate(() => undefined);
  await settle();
  stopTransient();
  await new Promise((resolve) => setTimeout(resolve, 40));
  const again = errorCache.watchQuery("people:forRecord", { recordId: "transient" });
  assert.equal(again.localQueryResult(), undefined, "an unmounted watcher's not-found is never surfaced");
  assert.ok(runs >= 4);
  // A role without the permission keeps the stable "unavailable" value (optional panels; the route gate explains denials).
  assert.equal(isRolePermissionDenial(new Error("Permission users:read required.")), true);
  assert.equal(isRolePermissionDenial(new Error("Society membership not found.")), false, "a wrong organization is surfaced");
  const permissionCache = new PortableQueryCache({ async runQuery() { throw new Error("Permission users:read required."); } } as unknown as PortableRuntime,
    { onUpdate() { return () => undefined; } } as unknown as StaticDemoDexieStore, () => undefined);
  const denied = permissionCache.watchQuery("users:list", { societyId: "x" });
  const stopDenied = denied.onUpdate(() => undefined);
  await settle();
  assert.equal(denied.localQueryResult(), undefined, "a permission denial is not thrown");
  stopDenied();
}
console.log("Portable cache checks passed: shared pagination, loaded pages, unsubscribe, principal/denied guards, and inactive miss→create→resubscribe lookup.");
