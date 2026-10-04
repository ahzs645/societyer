import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { hydrateObjectMetadata, hydrateHydratedView } from "../../types";
import type { HydratedView, ObjectMetadata } from "../../types";
import { purgeLegacyMetadataCache } from "./legacyMetadataCache";
import { useCurrentUserId } from "@/hooks/useCurrentUser";

/**
 * Loads the object metadata + views + active-view columns for a single
 * object by its singular name (e.g. "member"). Mirrors Twenty's pattern:
 *
 *   1. A single denormalized Convex query returns everything in one
 *      round-trip (no sequential `skip` chain).
 *   2. The current Convex/portable client supplies authorized warm snapshots.
 *      A persisted browser snapshot cannot establish a personal view's ACL.
 *   3. `{ object: null }` is a *resolved* state — consumers show a
 *      "metadata not seeded" empty state instead of spinning forever.
 *
 * Until the current query supplies a result, keep metadata unavailable rather
 * than reusing a prior actor/session/workspace's personal filters or view names.
 */

type RawSetup = {
  object: any | null;
  views: { _id: string; name: string; position: number; isSystem: boolean }[];
  activeView: { view: any; columns: { viewField: any; field: any }[] } | null;
};

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
  const actorId = useCurrentUserId();
  useEffect(() => {
    purgeLegacyMetadataCache();
    return purgeLegacyMetadataCache;
  }, [actorId]);
  // A page can keep its selected personal view while the local operator changes
  // actor. A pin belongs to the actor who selected it; a new selection records
  // its new actor immediately, without exposing the earlier pin for one render.
  const pin = useRef({ actorId, viewId: pinnedViewId });
  if (pin.current.viewId !== pinnedViewId) pin.current = { actorId, viewId: pinnedViewId };
  const effectiveViewId = pin.current.actorId === actorId ? pinnedViewId : undefined;

  const fresh = useQuery(
    api.objectMetadata.getFullTableSetup,
    societyId
      ? {
          societyId,
          nameSingular,
          ...(effectiveViewId ? { viewId: effectiveViewId } : {}),
        }
      : "skip",
  );

  const setup: RawSetup | null = (fresh as RawSetup | undefined) ?? null;

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
  const loading = societyId !== undefined && fresh === undefined;

  return { objectMetadata, hydratedView, views, loading };
}
