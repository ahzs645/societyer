import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { hydrateObjectMetadata, hydrateHydratedView } from "../../types";
import type { HydratedView, ObjectMetadata } from "../../types";

/**
 * Loads the object metadata + first view + records for a single object by
 * its singular name (e.g. "member"). Returns everything RecordTableScope
 * needs. Re-queries automatically when the view changes via Convex
 * reactivity.
 *
 * Callers pass a `viewId` to pin to a specific view, otherwise the first
 * view (sorted by position) is used.
 */
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
  const objectRaw = useQuery(
    api.objectMetadata.getByNameSingular,
    societyId ? { societyId, nameSingular } : "skip",
  );
  const withFields = useQuery(
    api.objectMetadata.getWithFields,
    objectRaw?._id ? { objectMetadataId: objectRaw._id } : "skip",
  );
  const views = useQuery(
    api.views.listForObject,
    objectRaw?._id ? { objectMetadataId: objectRaw._id } : "skip",
  );

  const effectiveViewId = useMemo(() => {
    if (pinnedViewId) return pinnedViewId;
    if (!views || views.length === 0) return undefined;
    const sorted = [...views].sort((a, b) => a.position - b.position);
    return sorted[0]._id as Id<"views">;
  }, [views, pinnedViewId]);

  const hydratedRaw = useQuery(
    api.views.getHydrated,
    effectiveViewId ? { id: effectiveViewId } : "skip",
  );

  const objectMetadata = useMemo<ObjectMetadata | null>(
    () => (withFields ? hydrateObjectMetadata(withFields) : null),
    [withFields],
  );
  const hydratedView = useMemo<HydratedView | null>(
    () => hydrateHydratedView(hydratedRaw),
    [hydratedRaw],
  );
  const viewSummaries = useMemo(
    () =>
      (views ?? []).map((v: any) => ({
        _id: String(v._id),
        name: v.name,
        position: v.position,
        isSystem: !!v.isSystem,
      })),
    [views],
  );

  const loading =
    (societyId !== undefined && objectRaw === undefined) ||
    withFields === undefined ||
    views === undefined ||
    (effectiveViewId !== undefined && hydratedRaw === undefined);

  return {
    objectMetadata,
    hydratedView,
    views: viewSummaries,
    loading,
  };
}
