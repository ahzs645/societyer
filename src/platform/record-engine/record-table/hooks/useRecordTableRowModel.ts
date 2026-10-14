import { useStore } from "zustand";
import type { RecordField, ViewGroupBy } from "../../types";
import { useRecordTableStoreOrThrow, type RecordTableStore } from "../state/recordTableStore";
import { getViewGroupBy, groupRecords, type RecordGroup } from "../utils/groupRecords";
import { memoForStore, useFilteredRecords } from "./useFilteredRecords";

export type RecordTableRowItem =
  | { kind: "group"; key: string; group: RecordGroup; collapsed: boolean }
  | { kind: "record"; key: string; record: any; rowIndex: number; groupKey?: string };

export type RecordTableRowModel = {
  /** Filtered + sorted records, in display (group) order, collapsed groups included. */
  ordered: any[];
  /** Records a person can reach: display order, collapsed groups skipped. `rowIndex` indexes this. */
  records: any[];
  /** What the table body renders: group headers interleaved with record rows. */
  items: RecordTableRowItem[];
  groups: RecordGroup[] | null;
  groupBy: ViewGroupBy | null;
  groupColumn: RecordField | null;
  /** items index for each rowIndex (for scrolling a virtualized body). */
  itemIndexByRowIndex: number[];
};

const modelCache = new WeakMap<RecordTableStore, { deps: readonly unknown[]; value: RecordTableRowModel }>();

export function buildRowModel({
  filtered,
  columns,
  groupBy,
  collapsedGroupKeys,
}: {
  filtered: any[];
  columns: RecordField[];
  groupBy: ViewGroupBy | null;
  collapsedGroupKeys: Set<string>;
}): RecordTableRowModel {
  const groupColumn = groupBy ? columns.find((column) => column.fieldMetadataId === groupBy.fieldMetadataId) ?? null : null;
  if (!groupBy || !groupColumn) {
    const items: RecordTableRowItem[] = filtered.map((record, rowIndex) => ({
      kind: "record",
      key: String(record._id),
      record,
      rowIndex,
    }));
    return {
      ordered: filtered,
      records: filtered,
      items,
      groups: null,
      groupBy: null,
      groupColumn: null,
      itemIndexByRowIndex: items.map((_, index) => index),
    };
  }

  const groups = groupRecords({ records: filtered, column: groupColumn, groupBy, columns });
  const items: RecordTableRowItem[] = [];
  const ordered: any[] = [];
  const records: any[] = [];
  const itemIndexByRowIndex: number[] = [];
  for (const group of groups) {
    const collapsed = collapsedGroupKeys.has(group.key);
    items.push({ kind: "group", key: `group:${group.key}`, group, collapsed });
    for (const record of group.records) {
      ordered.push(record);
      if (collapsed) continue;
      const rowIndex = records.length;
      records.push(record);
      itemIndexByRowIndex.push(items.length);
      items.push({ kind: "record", key: String(record._id), record, rowIndex, groupKey: group.key });
    }
  }
  return { ordered, records, items, groups, groupBy, groupColumn, itemIndexByRowIndex };
}

/**
 * The table body's row model: filtered + sorted records, split into the
 * view's groups when it has a group-by. Keyboard navigation, range copy and
 * the preview panel's ↑/↓ all walk `records`, so they follow what is on screen
 * and skip folded groups. Shared per table store (computed once per change).
 */
export function useRecordTableRowModel(): RecordTableRowModel {
  const store = useRecordTableStoreOrThrow();
  const filtered = useFilteredRecords();
  const columns = useStore(store, (s) => s.columns);
  const viewGroups = useStore(store, (s) => s.viewGroups);
  const collapsedGroupKeys = useStore(store, (s) => s.collapsedGroupKeys);
  const viewType = useStore(store, (s) => s.type);
  const groupBy = viewType === "table" ? getViewGroupBy(viewGroups) : null;

  return memoForStore(
    modelCache,
    store,
    [filtered, columns, groupBy?.fieldMetadataId, groupBy?.dateGranularity, groupBy?.sort, groupBy?.direction, groupBy?.sumFieldMetadataId, collapsedGroupKeys],
    () => buildRowModel({ filtered, columns, groupBy, collapsedGroupKeys }),
  );
}
