import assert from "node:assert/strict";
import { PortableQueryCache } from "../src/lib/portableQueryCache";
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
assert.equal(ordinary.localQueryResult(), undefined);
assert.equal(fallbackReads, 0, "Authorization failures never substitute fixture data");

unsubscribeSecond();
unsubscribeOrdinary();
before = queryCount;
updateStore();
await settle();
assert.equal(queryCount, before, "Unsubscribed cache keys must not execute on store changes");
console.log("Portable cache checks passed: single pagination invalidation, shared subscribers, loaded pages, unsubscribe, principal changes and denied-result clearing.");
