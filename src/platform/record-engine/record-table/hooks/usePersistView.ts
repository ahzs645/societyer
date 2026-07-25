import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useRecordTableStoreHandle } from "../state/recordTableStore";

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

  const saveCurrentView = useCallback(async () => {
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
    // Persist column sizing + visibility.
    for (const col of state.columns) {
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
    }
    // Commit positional order.
    await reorderFields({
      viewId,
      orderedIds: state.columns
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((c) => c.viewFieldId as Id<"viewFields">),
    });
    // Promote live state into `savedView` so isDirty flips back to false.
    handle.get().markSaved();
  }, [updateField, updateView, reorderFields, handle]);

  const saveAsNewView = useCallback(
    async (name: string) => {
      const state = handle.get();
      const viewId = await createView({
        societyId,
        objectMetadataId,
        name,
        type: state.type,
        kanbanFieldMetadataId: state.kanbanFieldMetadataId as Id<"fieldMetadata"> | undefined,
        calendarFieldMetadataId: state.calendarFieldMetadataId as Id<"fieldMetadata"> | undefined,
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
      for (let i = 0; i < state.columns.length; i++) {
        const col = state.columns[i];
        await addField({
          societyId,
          viewId,
          fieldMetadataId: col.fieldMetadataId as Id<"fieldMetadata">,
          isVisible: col.isVisible,
          position: i,
          size: col.size,
          aggregateOperation: col.aggregateOperation ?? undefined,
          viewFieldGroupId: col.viewFieldGroupId ?? undefined,
        });
      }
      // New view is now the saved baseline.
      handle.get().markSaved();
      return viewId;
    },
    [createView, addField, societyId, objectMetadataId, handle],
  );

  return { saveCurrentView, saveAsNewView };
}
