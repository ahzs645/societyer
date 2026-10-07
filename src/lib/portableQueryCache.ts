import type { PortableRuntime } from "../../shared/portable/define";
import type { StaticArgs } from "./staticConvexFixtures";
import type { StaticDemoDexieStore } from "./staticDemoStore";

function isPortablePageResult(value: unknown): value is {
  page: unknown[];
  isDone: boolean;
  continueCursor: string | null;
} {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    Array.isArray(result.page) &&
    typeof result.isDone === "boolean" &&
    (typeof result.continueCursor === "string" || result.continueCursor === null)
  );
}

function isPortablePaginatedCache(value: unknown): value is {
  results: unknown;
  status: "CanLoadMore" | "Exhausted";
} {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    "results" in result &&
    (result.status === "CanLoadMore" || result.status === "Exhausted")
  );
}

/** Structural equality for JSON-shaped query results (cheaper than stringify twice). */
export function sameQueryResult(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    // JSON.stringify maps NaN to null; mirror the old stringify comparison.
    if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) if (!sameQueryResult(a[index], b[index])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let leftCount = 0;
  for (const key in left) {
    if (left[key] === undefined) continue;
    leftCount++;
    if (!sameQueryResult(left[key], right[key])) return false;
  }
  let rightCount = 0;
  for (const key in right) if (right[key] !== undefined) rightCount++;
  return leftCount === rightCount;
}

/** Tables a result depends on; null means "unknown — refresh on every change". */
type ReadSet = ReadonlySet<string> | null;

type TrackingRuntime = PortableRuntime & {
  runQueryTracked?: (name: string, args: Record<string, any>) => Promise<{ result: unknown; tables: ReadSet }>;
};

/** Every query's authority comes from the current user row. */
const ALWAYS_READ = ["users"];

type PortableWatchSpec = {
  name: string;
  args?: StaticArgs;
  subscribers?: number;
  pagination?: {
    pageSizes: number[];
    subscribers: number;
    loadMoreInFlight: boolean;
  };
};

/**
 * Async-executor + synchronous-last-result bridge for portable queries.
 *
 * The real async portable handler runs against the Dexie-backed ctx.db on
 * mount and on every store change; its result is cached synchronously so
 * React's useQuery (which reads `localQueryResult()` synchronously) sees it.
 * Until the authorized async result resolves, watches return undefined. Fixture
 * mirrors cannot establish the current actor's authority to read a record.
 */
export class PortableQueryCache {
  // Client-level cache for async portable query results. convex/react re-creates
  // a Watch on every render and only subscribes to the committed one, so a result
  // stored in a per-watch closure is thrown away before it reaches the component
  // (sync mirror queries don't hit this because they return data synchronously).
  // Caching by query+args here lets any freshly-created watch read the resolved
  // value synchronously, and `portableListeners` re-renders subscribers on resolve.
  private portableCache = new Map<string, unknown>();
  private portableErrors = new Map<string, string>();
  private paginatedSnapshots = new Map<string, { source: unknown; value: unknown }>();
  private portableListeners = new Set<() => void>();
  private portableRunId = 0;
  private portableRunTokens = new Map<string, number>();
  private portablePaginatedRunId = 0;
  private portablePaginatedRunTokens = new Map<string, number>();
  /** Non-paginated queries with a pending/active watch, plus active paginated watches,
   *  so store-level updates (hydration, mutations) can refresh the cache
   *  without depending on React's subscription timing. */
  private portableWatchSpecs = new Map<string, PortableWatchSpec>();
  /** Read set of the last completed run per cache key (see `affectedBy`). */
  private portableReadSets = new Map<string, ReadSet>();
  /** Cache keys with a run in flight. */
  private portablePending = new Set<string>();

  constructor(
    private readonly portable: PortableRuntime,
    private readonly store: StaticDemoDexieStore,
    _syncFallback: (name: string, args?: StaticArgs) => unknown,
  ) {
    // Client-level refresh: whenever the underlying store changes (a mutation
    // committed, or the async Dexie hydration finished), re-run every watched
    // portable query. Watch-level subscriptions alone race React's effect
    // timing — a hydration that completes between a component's render and its
    // onUpdate subscription would otherwise leave that query stale.
    //
    // The store reports WHICH tables changed, and each result remembers which
    // tables it read, so a write to `tasks` no longer re-runs (and re-diffs) the
    // documents list. A store event without a table set, or a result whose
    // reads are unknown, still refreshes everything.
    this.store.onUpdate((changed?: ReadonlySet<string>) => {
      // Retained snapshots bridge render/subscription churn only while the
      // store is unchanged. An inactive miss must not be consumed before a
      // fresh authorized query after the missing record has been created.
      for (const cacheKey of [...this.portableCache.keys()]) {
        if (this.portableWatchSpecs.has(cacheKey)) continue;
        if (!this.affectedBy(cacheKey, changed)) continue;
        this.portableCache.delete(cacheKey);
        this.portableErrors.delete(cacheKey);
        this.paginatedSnapshots.delete(cacheKey);
        this.portableReadSets.delete(cacheKey);
      }
      for (const [cacheKey, spec] of this.portableWatchSpecs) {
        if (!this.affectedBy(cacheKey, changed)) continue;
        if (spec.pagination) this.recomputePortablePaginated(cacheKey, spec);
        else this.recomputePortable(cacheKey, spec.name, spec.args);
      }
    });
  }

  /** Whether a store change can affect this cached result. */
  private affectedBy(cacheKey: string, changed: ReadonlySet<string> | undefined) {
    if (!changed) return true;
    if (!this.portableReadSets.has(cacheKey)) return true;
    const reads = this.portableReadSets.get(cacheKey);
    if (!reads) return true;
    for (const table of changed) if (reads.has(table)) return true;
    return false;
  }

  /** A completed, still-valid result whose re-run would be wasted work. */
  private isFresh(cacheKey: string) {
    return (
      !this.portablePending.has(cacheKey) &&
      this.portableCache.get(cacheKey) !== undefined &&
      Boolean(this.portableReadSets.get(cacheKey))
    );
  }

  private async runTracked(name: string, args: StaticArgs | undefined): Promise<{ result: unknown; tables: ReadSet }> {
    const runtime = this.portable as TrackingRuntime;
    if (typeof runtime.runQueryTracked !== "function") {
      return { result: await this.portable.runQuery(name, args ?? {}), tables: null };
    }
    const tracked = await runtime.runQueryTracked(name, args ?? {});
    if (!tracked.tables) return tracked;
    return { result: tracked.result, tables: new Set([...tracked.tables, ...ALWAYS_READ]) };
  }

  emit() {
    // A callback can commit a React subscription change. Iterating the live
    // Set would visit newly inserted listeners again during the same emission.
    for (const listener of [...this.portableListeners]) listener();
  }

  /** Drop results authorized for the previous selected local actor. */
  invalidatePrincipal() {
    this.portableReadSets.clear();
    this.portablePending.clear();
    this.portableRunTokens.clear();
    this.portablePaginatedRunTokens.clear();
    this.portableErrors.clear();
    this.paginatedSnapshots.clear();
    for (const key of this.portableCache.keys()) this.portableCache.set(key, undefined);
    for (const [cacheKey, spec] of this.portableWatchSpecs) {
      if (spec.pagination) this.recomputePortablePaginated(cacheKey, spec);
      else this.recomputePortable(cacheKey, spec.name, spec.args);
    }
    this.emit();
  }

  private rejectResult(cacheKey: string, runId: number, error: unknown, paginated = false) {
    const tokens = paginated ? this.portablePaginatedRunTokens : this.portableRunTokens;
    if (tokens.get(cacheKey) !== runId) return;
    const message = String(error);
    if (this.portableErrors.get(cacheKey) !== message) console.warn(`[societyer-local] portable query ${cacheKey} failed`, error);
    this.portableErrors.set(cacheKey, message);
    this.portableReadSets.delete(cacheKey);
    const hadResult = this.portableCache.get(cacheKey) !== undefined;
    // Failed authorization never supplies fixture data or retains another
    // actor's result. Undefined is a stable loading/unavailable value for the
    // existing optional background queries, without a render feedback loop.
    this.portableCache.set(cacheKey, undefined);
    if (hadResult) this.emit();
  }

  private recomputePortable(cacheKey: string, name: string, args?: StaticArgs) {
    const runId = ++this.portableRunId;
    this.portableRunTokens.set(cacheKey, runId);
    this.portablePending.add(cacheKey);
    this.runTracked(name, args)
      .then(({ result: next, tables }) => {
        if (this.portableRunTokens.get(cacheKey) !== runId) return;
        this.portablePending.delete(cacheKey);
        this.portableErrors.delete(cacheKey);
        this.portableReadSets.set(cacheKey, tables);
        const prev = this.portableCache.get(cacheKey);
        if (!this.portableCache.has(cacheKey) || !sameQueryResult(next, prev)) {
          this.portableCache.set(cacheKey, next);
          this.emit();
        }
      })
      .catch((error) => {
        if (this.portableRunTokens.get(cacheKey) === runId) this.portablePending.delete(cacheKey);
        this.rejectResult(cacheKey, runId, error);
      });
  }

  watchQuery(name: string, args?: StaticArgs) {
    const cacheKey = `${name}|${JSON.stringify(args ?? {})}`;
    // Registered so the client-level store subscription (see constructor) can
    // refresh EVERY watched query on any store change — including the async
    // Dexie hydration finishing before any React subscriber attached. Without
    // this, a query that first resolved against the pre-hydration fixture
    // cache could stay stale until the next unrelated re-render.
    let watchSpec = this.portableWatchSpecs.get(cacheKey);
    const needsRefresh = !watchSpec || Boolean(watchSpec.pagination);
    if (!watchSpec || watchSpec.pagination) {
      watchSpec = { name, args, subscribers: 0 };
      this.portableWatchSpecs.set(cacheKey, watchSpec);
    }

    const recompute = () => this.recomputePortable(cacheKey, name, args);
    // Convex also constructs watches merely to read the synchronous snapshot.
    // Executing a fresh query on each such read creates microtask feedback when
    // its notification causes another snapshot read.
    if (needsRefresh && !this.isFresh(cacheKey)) recompute();

    return {
      onUpdate: (callback: () => void) => {
        let spec = this.portableWatchSpecs.get(cacheKey);
        if (!spec || spec.pagination) {
          spec = watchSpec;
          this.portableWatchSpecs.set(cacheKey, spec);
        }
        spec.subscribers = (spec.subscribers ?? 0) + 1;
        this.portableListeners.add(callback);
        // Re-run on (re)subscribe so a watch attached after the initial resolve
        // still refreshes the shared cache; the cached value is read
        // synchronously by localQueryResult regardless of which watch instance
        // convex/react keeps (it re-creates the Watch on every render).
        // A result whose read set is known and untouched since it was computed
        // is already current: re-running it would only repeat the same work.
        if (!this.isFresh(cacheKey)) recompute();
        let subscribed = true;
        return () => {
          if (!subscribed) return;
          subscribed = false;
          this.portableListeners.delete(callback);
          spec.subscribers = Math.max(0, (spec.subscribers ?? 1) - 1);
          if (spec.subscribers > 0) return;
          if (this.portableWatchSpecs.get(cacheKey) === spec) {
            // Non-paginated values intentionally survive the last unsubscribe:
            // stable query+args cache keys let a late watch render immediately.
            // Only the active spec and run token are evicted, so store updates no
            // longer replay the query; re-subscription restores the spec and
            // recomputes to refresh the retained value.
            this.portableWatchSpecs.delete(cacheKey);
            this.portableRunTokens.delete(cacheKey);
          }
        };
      },
      localQueryResult: () =>
        this.portableCache.has(cacheKey)
          ? this.portableCache.get(cacheKey)
          : undefined,
      journal: () => undefined,
    };
  }

  private recomputePortablePaginated(
    cacheKey: string,
    spec: PortableWatchSpec,
    loadMoreRun = false,
  ) {
    const pageSizes = spec.pagination?.pageSizes.slice() ?? [];
    const runId = ++this.portablePaginatedRunId;
    this.portablePaginatedRunTokens.set(cacheKey, runId);
    let readSet: Set<string> | null = new Set<string>();
    const run = async () => {
      const results: unknown[] = [];
      let cursor: string | null = null;
      let isDone = false;

      for (const numItems of pageSizes) {
        const tracked = await this.runTracked(spec.name, {
          ...(spec.args ?? {}),
          paginationOpts: { numItems, cursor },
        });
        const next = tracked.result;
        if (!tracked.tables) readSet = null;
        else if (readSet) for (const table of tracked.tables) readSet.add(table);
        if (!isPortablePageResult(next)) {
          return { results: next ?? [], status: "Exhausted" as const };
        }
        results.push(...next.page);
        isDone = next.isDone;
        cursor = next.continueCursor;
        if (isDone) break;
      }

      return { results, status: isDone ? "Exhausted" as const : "CanLoadMore" as const };
    };

    void run()
      .then((next) => {
        if (this.portablePaginatedRunTokens.get(cacheKey) !== runId) return;
        this.portableErrors.delete(cacheKey);
        this.portableReadSets.set(cacheKey, readSet);
        const prev = this.portableCache.get(cacheKey);
        if (!this.portableCache.has(cacheKey) || !sameQueryResult(next, prev)) {
          this.portableCache.set(cacheKey, next);
          this.emit();
        }
      })
      .catch((error) => {
        this.rejectResult(cacheKey, runId, error, true);
      })
      .finally(() => {
        if (loadMoreRun && spec.pagination) spec.pagination.loadMoreInFlight = false;
      });
  }

  watchPaginatedQuery(
    name: string,
    args?: StaticArgs,
    options?: { initialNumItems?: number; id?: number },
  ) {
    const initialNumItems = options?.initialNumItems ?? 10;
    const cacheKey = `paginated|${name}|${JSON.stringify(args ?? {})}|${options?.id ?? "default"}|${initialNumItems}`;
    let watchSpec = this.portableWatchSpecs.get(cacheKey);
    const needsRefresh = !watchSpec?.pagination;
    if (!watchSpec?.pagination) {
      watchSpec = {
        name,
        args,
        pagination: {
          pageSizes: [initialNumItems],
          subscribers: 0,
          loadMoreInFlight: false,
        },
      };
      this.portableWatchSpecs.set(cacheKey, watchSpec);
    }

    const recompute = () => {
      const spec = this.portableWatchSpecs.get(cacheKey);
      if (spec) this.recomputePortablePaginated(cacheKey, spec);
    };
    const loadMore = (numItems: number) => {
      const spec = this.portableWatchSpecs.get(cacheKey);
      if (!spec?.pagination || spec.pagination.loadMoreInFlight || numItems <= 0) return;
      spec.pagination.loadMoreInFlight = true;
      spec.pagination.pageSizes.push(numItems);
      this.recomputePortablePaginated(cacheKey, spec, true);
    };
    if (needsRefresh) recompute();

    return {
      onUpdate: (callback: () => void) => {
        let spec = this.portableWatchSpecs.get(cacheKey);
        if (!spec?.pagination) {
          spec = watchSpec;
          this.portableWatchSpecs.set(cacheKey, spec);
        }
        const pagination = spec.pagination;
        if (!pagination) return () => undefined;
        pagination.subscribers += 1;
        this.portableListeners.add(callback);
        // The client-level store listener refreshes each active cache key once.
        // An additional listener per paginated subscriber would replay every
        // loaded page twice (or more when two components share this query).
        recompute();
        let subscribed = true;
        return () => {
          if (!subscribed) return;
          subscribed = false;
          this.portableListeners.delete(callback);
          pagination.subscribers -= 1;
          if (pagination.subscribers > 0) return;
          if (this.portableWatchSpecs.get(cacheKey) === spec) {
            this.portableWatchSpecs.delete(cacheKey);
            this.portableCache.delete(cacheKey);
            this.portableReadSets.delete(cacheKey);
            this.portablePaginatedRunTokens.delete(cacheKey);
          }
        };
      },
      localQueryResult: () => {
        const cached = this.portableCache.get(cacheKey);
        if (!isPortablePaginatedCache(cached)) return undefined;
        const snapshot = this.paginatedSnapshots.get(cacheKey);
        if (snapshot?.source === cached) return snapshot.value;
        const value = { ...cached, loadMore };
        this.paginatedSnapshots.set(cacheKey, { source: cached, value });
        return value;
      },
    };
  }
}
