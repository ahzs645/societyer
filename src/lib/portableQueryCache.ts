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
 * Until the first async result resolves, the existing synchronous mirror path
 * supplies an instant value, so there is no loading flash for ported queries.
 */
export class PortableQueryCache {
  // Client-level cache for async portable query results. convex/react re-creates
  // a Watch on every render and only subscribes to the committed one, so a result
  // stored in a per-watch closure is thrown away before it reaches the component
  // (sync mirror queries don't hit this because they return data synchronously).
  // Caching by query+args here lets any freshly-created watch read the resolved
  // value synchronously, and `portableListeners` re-renders subscribers on resolve.
  private portableCache = new Map<string, unknown>();
  private portableListeners = new Set<() => void>();
  private portableRunId = 0;
  private portableRunTokens = new Map<string, number>();
  private portablePaginatedRunId = 0;
  private portablePaginatedRunTokens = new Map<string, number>();
  /** Non-paginated queries with a pending/active watch, plus active paginated watches,
   *  so store-level updates (hydration, mutations) can refresh the cache
   *  without depending on React's subscription timing. */
  private portableWatchSpecs = new Map<string, PortableWatchSpec>();

  constructor(
    private readonly portable: PortableRuntime,
    private readonly store: StaticDemoDexieStore,
    private readonly syncFallback: (name: string, args?: StaticArgs) => unknown,
  ) {
    // Client-level refresh: whenever the underlying store changes (a mutation
    // committed, or the async Dexie hydration finished), re-run every watched
    // portable query. Watch-level subscriptions alone race React's effect
    // timing — a hydration that completes between a component's render and its
    // onUpdate subscription would otherwise leave that query stale.
    this.store.onUpdate(() => {
      for (const [cacheKey, spec] of this.portableWatchSpecs) {
        if (spec.pagination) this.recomputePortablePaginated(cacheKey, spec);
        else this.recomputePortable(cacheKey, spec.name, spec.args);
      }
    });
  }

  emit() {
    for (const listener of this.portableListeners) listener();
  }

  private recomputePortable(cacheKey: string, name: string, args?: StaticArgs) {
    const runId = ++this.portableRunId;
    this.portableRunTokens.set(cacheKey, runId);
    this.portable
      .runQuery(name, args ?? {})
      .then((next) => {
        if (this.portableRunTokens.get(cacheKey) !== runId) return;
        const prev = this.portableCache.get(cacheKey);
        if (!this.portableCache.has(cacheKey) || JSON.stringify(next) !== JSON.stringify(prev)) {
          this.portableCache.set(cacheKey, next);
          this.emit();
        }
      })
      .catch((error) => {
        console.warn(`[societyer-local] portable query ${name} failed`, error);
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
    if (!watchSpec || watchSpec.pagination) {
      watchSpec = { name, args, subscribers: 0 };
      this.portableWatchSpecs.set(cacheKey, watchSpec);
    }

    const recompute = () => this.recomputePortable(cacheKey, name, args);
    recompute();

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
        recompute();
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
          : this.syncFallback(name, args),
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
    const run = async () => {
      const results: unknown[] = [];
      let cursor: string | null = null;
      let isDone = false;

      for (const numItems of pageSizes) {
        const next = await this.portable.runQuery<unknown>(spec.name, {
          ...(spec.args ?? {}),
          paginationOpts: { numItems, cursor },
        });
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
        const prev = this.portableCache.get(cacheKey);
        if (!this.portableCache.has(cacheKey) || JSON.stringify(next) !== JSON.stringify(prev)) {
          this.portableCache.set(cacheKey, next);
          this.emit();
        }
      })
      .catch((error) => {
        console.warn(`[societyer-local] portable paginated query ${spec.name} failed`, error);
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
    recompute();

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
        const unsubStore = this.store.onUpdate(recompute);
        recompute();
        let subscribed = true;
        return () => {
          if (!subscribed) return;
          subscribed = false;
          this.portableListeners.delete(callback);
          unsubStore();
          pagination.subscribers -= 1;
          if (pagination.subscribers > 0) return;
          if (this.portableWatchSpecs.get(cacheKey) === spec) {
            this.portableWatchSpecs.delete(cacheKey);
            this.portableCache.delete(cacheKey);
            this.portablePaginatedRunTokens.delete(cacheKey);
          }
        };
      },
      localQueryResult: () => {
        const cached = this.portableCache.get(cacheKey);
        if (!isPortablePaginatedCache(cached)) return undefined;
        return { ...cached, loadMore };
      },
    };
  }
}
