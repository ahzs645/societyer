import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { hydrateObjectMetadata, hydrateHydratedView } from "../../types";
import type { HydratedView, ObjectMetadata } from "../../types";

/**
 * Loads the object metadata + views + active-view columns for a single
 * object by its singular name (e.g. "member"). Mirrors Twenty's pattern:
 *
 *   1. A single denormalized Convex query returns everything in one
 *      round-trip (no sequential `skip` chain).
 *   2. localStorage hydrates the table synchronously on mount so 2nd+
 *      visits paint instantly. Convex reactivity then overwrites the
 *      cache if anything changed server-side.
 *   3. `{ object: null }` is a *resolved* state — consumers show a
 *      "metadata not seeded" empty state instead of spinning forever.
 *
 * Cache keys are scoped by societyId + nameSingular + optional viewId
 * so switching societies or views doesn't leak stale data.
 */

const CACHE_NAMESPACE = "societyer.record-table.v1";
const CACHE_VERSION = 1;

type RawSetup = {
  object: any | null;
  views: { _id: string; name: string; position: number; isSystem: boolean }[];
  activeView: { view: any; columns: { viewField: any; field: any }[] } | null;
};

type CachedEntry = { version: number; cachedAt: number; setup: RawSetup };

function storageKey(
  societyId: string,
  nameSingular: string,
  viewId?: string,
): string {
  return `${CACHE_NAMESPACE}.${societyId}.${nameSingular}${viewId ? `.${viewId}` : ""}`;
}

function readCached(key: string): RawSetup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (parsed?.version !== CACHE_VERSION) return null;
    return parsed.setup ?? null;
  } catch {
    return null;
  }
}

function writeCached(key: string, setup: RawSetup): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CachedEntry = {
      version: CACHE_VERSION,
      cachedAt: Date.now(),
      setup,
    };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota exceeded / SSR / privacy mode — fall through silently.
  }
}

export function useObjectRecordTableData({
  societyId,
  nameSingular,
  viewId: pinnedViewId,
}: {
  societyId: Id<"societies"> | undefined;
  nameSingular: string;
  viewId?: Id<"views">;
}): {
  objectMetadata: ObjectMetadata | null;
  hydratedView: HydratedView | null;
  views: { _id: string; name: string; position: number; isSystem: boolean }[];
  loading: boolean;
} {
  const cacheKey = useMemo(
    () =>
      societyId ? storageKey(societyId, nameSingular, pinnedViewId) : null,
    [societyId, nameSingular, pinnedViewId],
  );

  // Synchronous read on first render — the table paints from cache
  // before Convex responds on warm mounts.
  const [cached, setCached] = useState<RawSetup | null>(() =>
    cacheKey ? readCached(cacheKey) : null,
  );

  // Swap cache when the key changes (e.g., switching societies or views).
  useEffect(() => {
    setCached(cacheKey ? readCached(cacheKey) : null);
  }, [cacheKey]);

  const fresh = useQuery(
    api.objectMetadata.getFullTableSetup,
    societyId
      ? {
          societyId,
          nameSingular,
          ...(pinnedViewId ? { viewId: pinnedViewId } : {}),
        }
      : "skip",
  );

  // Persist every fresh response so the next visit is instant.
  useEffect(() => {
    if (fresh !== undefined && cacheKey) {
      writeCached(cacheKey, fresh as RawSetup);
      setCached(fresh as RawSetup);
    }
  }, [fresh, cacheKey]);

  // Prefer fresh data, fall back to cache until it arrives.
  const setup: RawSetup | null =
    (fresh as RawSetup | undefined) ?? cached ?? null;

  const objectMetadata = useMemo<ObjectMetadata | null>(
    () => (setup?.object ? hydrateObjectMetadata(setup.object) : null),
    [setup],
  );
  const hydratedView = useMemo<HydratedView | null>(
    () => (setup?.activeView ? hydrateHydratedView(setup.activeView) : null),
    [setup],
  );
  const views = useMemo(() => setup?.views ?? [], [setup]);

  // "Loading" only when we have *nothing* to render. Once `setup` is
  // populated (from cache or server) we're considered loaded — server
  // updates then stream in reactively. When Convex has resolved with a
  // null-object (seeder not run), `setup.object === null` and loading
  // is false, so the caller can show the "metadata not seeded" state.
  const loading = societyId !== undefined && fresh === undefined && cached === null;

  return { objectMetadata, hydratedView, views, loading };
}
