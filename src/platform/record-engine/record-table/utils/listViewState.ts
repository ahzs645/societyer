import type { HydratedView, ObjectMetadata, RecordField, ViewFilter, ViewGroup, ViewSort } from "../../types";
import type { RecordTableState } from "../state/recordTableStore";
import {
  LIST_VIEW_STATE_VERSION,
  cleanListViewState,
  type ListViewGroupState,
  type ListViewState,
} from "../../../../../shared/listViewState";

/** The store slices a list view state covers. */
export type ListViewSlices = Pick<RecordTableState, "columns" | "sorts" | "filters" | "filterGroups" | "viewGroups" | "density">;

/** A list view state from the table's live (or saved) state. */
export function listViewStateFromTable(
  state: ListViewSlices & { searchTerm?: string },
  { includeSearch = false }: { includeSearch?: boolean } = {},
): ListViewState {
  const searchTerm = includeSearch ? (state.searchTerm ?? "").trim() : "";
  return cleanListViewState({
    version: LIST_VIEW_STATE_VERSION,
    columns: [...state.columns]
      .sort((a, b) => a.position - b.position)
      .map((column, position) => ({
        fieldMetadataId: column.fieldMetadataId,
        position,
        // A saved width is 20–2000px (shared/listViewState.ts); a drag can go wider.
        size: Math.min(2000, Math.max(20, Math.round(column.size) || 160)),
        isVisible: column.isVisible,
        aggregateOperation: column.aggregateOperation ?? null,
      })),
    sorts: state.sorts.map((sort) => ({ ...(sort.id ? { id: sort.id } : {}), fieldMetadataId: sort.fieldMetadataId, direction: sort.direction })),
    filters: state.filters,
    filterGroups: state.filterGroups,
    groups: state.viewGroups,
    density: state.density,
    ...(searchTerm ? { searchTerm } : {}),
  });
}

/**
 * The table slices a state gives over `base` (the list's default view): its
 * columns in the stored order, widths and visibility, then any field the state
 * doesn't know (a column added since) as the default view has it. Sorts,
 * filters and grouping that name a field the list no longer has are dropped.
 */
export function tableSlicesFromListViewState(base: HydratedView, state: ListViewState): ListViewSlices & { searchTerm: string } {
  const byField = new Map(base.columns.map((column) => [column.fieldMetadataId, column]));
  const known = (fieldMetadataId: string | undefined) => !!fieldMetadataId && byField.has(fieldMetadataId);
  const columns: RecordField[] = [];
  const seen = new Set<string>();
  for (const stored of [...state.columns].sort((a, b) => a.position - b.position)) {
    const column = byField.get(stored.fieldMetadataId);
    if (!column || seen.has(stored.fieldMetadataId)) continue;
    seen.add(stored.fieldMetadataId);
    columns.push({
      ...column,
      position: columns.length,
      size: stored.size,
      isVisible: stored.isVisible,
      aggregateOperation: stored.aggregateOperation === undefined ? column.aggregateOperation : stored.aggregateOperation,
    });
  }
  for (const column of [...base.columns].sort((a, b) => a.position - b.position)) {
    if (!seen.has(column.fieldMetadataId)) columns.push({ ...column, position: columns.length });
  }
  const sorts: ViewSort[] = state.sorts.filter((sort) => known(sort.fieldMetadataId));
  const filters: ViewFilter[] = state.filters.filter((filter) => known(filter.fieldMetadataId));
  const viewGroups: ViewGroup[] = state.groups.flatMap((group): ListViewGroupState[] => {
    if (!group.groupBy) return [group];
    if (!known(group.groupBy.fieldMetadataId)) return [];
    if (group.groupBy.sumFieldMetadataId && !known(group.groupBy.sumFieldMetadataId)) {
      const { sumFieldMetadataId: _dropped, ...groupBy } = group.groupBy;
      return [{ ...group, groupBy }];
    }
    return [group];
  });
  return {
    columns,
    sorts,
    filters,
    filterGroups: state.filterGroups,
    viewGroups,
    density: state.density,
    searchTerm: state.searchTerm ?? "",
  };
}

/** `base` with a named view's state, ready for the store's `loadView`. */
export function hydratedViewFromListViewState(
  base: HydratedView,
  state: ListViewState,
  view: { _id: string; name: string },
): HydratedView {
  const slices = tableSlicesFromListViewState(base, state);
  return {
    view: {
      ...base.view,
      _id: view._id,
      name: view.name,
      sorts: slices.sorts,
      filters: slices.filters,
      filterGroups: slices.filterGroups,
      groups: slices.viewGroups,
      density: slices.density,
      searchTerm: slices.searchTerm,
      visibility: "shared",
      isShared: true,
      isSystem: false,
    },
    columns: slices.columns,
  };
}

/**
 * A short fingerprint of a list's fields (names and types). A remembered
 * state written for a different set keeps its column layout, sorts and
 * grouping for the fields still there, but not its filters, whose values may
 * no longer suit a field whose type changed.
 */
export function listViewFieldsHash(objectMetadata: Pick<ObjectMetadata, "fields">): string {
  const source = objectMetadata.fields
    .map((field) => `${field.name}:${field.fieldType}`)
    .sort()
    .join("|");
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
