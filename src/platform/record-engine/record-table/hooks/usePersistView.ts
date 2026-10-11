import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useRecordTableStoreHandle } from "../state/recordTableStore";
import { isVirtualColumn } from "../utils/hiddenObjectFields";
import { useCurrentUserId } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * Returns callbacks for saving view state back to Convex:
 *   - `saveCurrentView()` — overwrites the active view.
 *   - `saveAsNewView(name)` — inserts a fresh view with the current table state.
 *
 * Both compute diffs lazily from the store, so callers don't need to
 * pass current columns/sorts/etc. explicitly.
 */
export function usePersistView({
  societyId,
  objectMetadataId,
}: {
  societyId: Id<"societies">;
  objectMetadataId: Id<"objectMetadata">;
}) {
  const createView = useMutation(api.views.create);
  const updateView = useMutation(api.views.update);
  const updateField = useMutation(api.views.updateField);
  const addField = useMutation(api.views.addField);
  const reorderFields = useMutation(api.views.reorderFields);
  const handle = useRecordTableStoreHandle();
  const actorId = useCurrentUserId();
  const { can } = usePermissions();
  const authority = useRef({ actorId, handle, canSave: can("settings:write") });
  authority.current = { actorId, handle, canSave: can("settings:write") };
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  // A queued callback or multi-step save may outlive its actor/table. Check
  // current authority before every mutation and before promoting local state.
  const requireCurrentAuthority = useCallback(() => {
    const current = authority.current;
    if (!active.current || !actorId || current.actorId !== actorId || current.handle !== handle || !current.canSave) {
      throw new Error("Saved views require current settings write access.");
    }
  }, [actorId, handle]);

  const saveCurrentView = useCallback(async () => {
    requireCurrentAuthority();
    const state = handle.get();
    if (!state.viewId) throw new Error("No active view to save.");
    const viewId = state.viewId as Id<"views">;
    await updateView({
      id: viewId,
      patch: {
        density: state.density,
        type: state.type,
        kanbanFieldMetadataId: state.kanbanFieldMetadataId as Id<"fieldMetadata"> | undefined,
        calendarFieldMetadataId: state.calendarFieldMetadataId as Id<"fieldMetadata"> | undefined,
        calendarLayout: state.calendarLayout,
        filtersJson: JSON.stringify(state.filters),
        viewFilterGroupsJson: JSON.stringify(state.filterGroups),
        sortsJson: JSON.stringify(state.sorts),
        viewGroupsJson: JSON.stringify(state.viewGroups),
        viewFieldGroupsJson: JSON.stringify(state.fieldGroups),
        searchTerm: state.searchTerm || undefined,
        anyFieldFilterValue: state.anyFieldFilterValue || undefined,
        visibility: state.visibility,
        openRecordIn: state.openRecordIn,
      },
    });
    // Persist column sizing + visibility. Columns for fields the view never
    // had (see withHiddenObjectFields) are only stored once they are shown.
    const savedColumns = [] as typeof state.columns;
    for (const col of state.columns) {
      requireCurrentAuthority();
      if (isVirtualColumn(col)) {
        if (!col.isVisible) {
          savedColumns.push(col);
          continue;
        }
        const newViewFieldId = await addField({
          societyId,
          viewId,
          fieldMetadataId: col.fieldMetadataId as Id<"fieldMetadata">,
          isVisible: true,
          position: col.position,
          size: col.size,
          aggregateOperation: col.aggregateOperation ?? undefined,
          viewFieldGroupId: col.viewFieldGroupId ?? undefined,
        });
        savedColumns.push({ ...col, viewFieldId: String(newViewFieldId) });
        continue;
      }
      await updateField({
        id: col.viewFieldId as Id<"viewFields">,
        patch: {
          isVisible: col.isVisible,
          size: col.size,
          position: col.position,
          aggregateOperation: col.aggregateOperation ?? undefined,
          viewFieldGroupId: col.viewFieldGroupId ?? undefined,
        },
      });
      savedColumns.push(col);
    }
    // Commit positional order.
    requireCurrentAuthority();
    await reorderFields({
      viewId,
      orderedIds: savedColumns
        .filter((c) => !isVirtualColumn(c))
        .sort((a, b) => a.position - b.position)
        .map((c) => c.viewFieldId as Id<"viewFields">),
    });
    // Promote live state into `savedView` so isDirty flips back to false.
    requireCurrentAuthority();
    handle.set({ columns: savedColumns });
    handle.get().markSaved({ ...state, columns: savedColumns });
  }, [updateField, updateView, addField, reorderFields, societyId, handle, requireCurrentAuthority]);

  const saveAsNewView = useCallback(
    async (name: string) => {
      requireCurrentAuthority();
      const state = handle.get();
      const viewId = await createView({
        societyId,
        objectMetadataId,
        name,
        type: state.type,
        kanbanFieldMetadataId: state.kanbanFieldMetadataId as Id<"fieldMetadata"> | undefined,
        calendarFieldMetadataId: state.calendarFieldMetadataId as Id<"fieldMetadata"> | undefined,
        calendarLayout: state.calendarLayout,
        density: state.density,
        filtersJson: JSON.stringify(state.filters),
        viewFilterGroupsJson: JSON.stringify(state.filterGroups),
        sortsJson: JSON.stringify(state.sorts),
        viewGroupsJson: JSON.stringify(state.viewGroups),
        viewFieldGroupsJson: JSON.stringify(state.fieldGroups),
        searchTerm: state.searchTerm || undefined,
        anyFieldFilterValue: state.anyFieldFilterValue || undefined,
        visibility: state.visibility,
        openRecordIn: state.openRecordIn,
        isShared: false,
      });
      const newColumns = [] as typeof state.columns;
      for (let i = 0; i < state.columns.length; i++) {
        requireCurrentAuthority();
        const col = state.columns[i];
        if (isVirtualColumn(col) && !col.isVisible) {
          newColumns.push(col);
          continue;
        }
        const newViewFieldId = await addField({
          societyId,
          viewId,
          fieldMetadataId: col.fieldMetadataId as Id<"fieldMetadata">,
          isVisible: col.isVisible,
          position: i,
          size: col.size,
          aggregateOperation: col.aggregateOperation ?? undefined,
          viewFieldGroupId: col.viewFieldGroupId ?? undefined,
        });
        newColumns.push({
          ...col,
          viewFieldId: String(newViewFieldId),
          position: i,
        });
      }
      // Future saves must target the newly-created view and its fields.
      requireCurrentAuthority();
      handle.set({ viewId: String(viewId), columns: newColumns });
      handle.get().markSaved({ ...state, viewId: String(viewId), columns: newColumns });
      return viewId;
    },
    [createView, addField, societyId, objectMetadataId, handle, requireCurrentAuthority],
  );

  return { saveCurrentView, saveAsNewView };
}
