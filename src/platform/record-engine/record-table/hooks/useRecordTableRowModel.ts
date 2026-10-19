import { useContext } from "react";
import { useStore } from "zustand";
import { RecordTableContext } from "../contexts/RecordTableContext";
import type { RecordField, ViewGroupBy } from "../../types";
import { useRecordTableStoreOrThrow, type RecordTableStore } from "../state/recordTableStore";
import { getViewGroupBy, groupRecords, type RecordGroup } from "../utils/groupRecords";
import { memoForStore, useFilteredRecords } from "./useFilteredRecords";
import {
  DEFAULT_RECORD_TABLE_DISPLAY,
  describePage,
  pageItems,
  resolveRecordTableDisplay,
  type RecordTablePage,
} from "../utils/viewDisplay";

export type RecordTableRowItem =
  | { kind: "group"; key: string; group: RecordGroup; collapsed: boolean }
  | { kind: "record"; key: string; record: any; rowIndex: number; groupKey?: string };

export type RecordTableRowModel = {
  /** Filtered + sorted records, in display (group) order, collapsed groups included. */
  ordered: any[];
  /** Records a person can reach: display order, collapsed groups skipped. `rowIndex` indexes this. */
  records: any[];
  /**
   * What the table body renders: group headers interleaved with record rows.
   * Shown in pages, just the open page's.
   */
  items: RecordTableRowItem[];
  groups: RecordGroup[] | null;
  groupBy: ViewGroupBy | null;
  groupColumn: RecordField | null;
  /** items index for each rowIndex on show (for scrolling a virtualized body). */
  itemIndexByRowIndex: number[];
  /** The open page when the view shows pages; null for continuous scroll. */
  page: RecordTablePage | null;
};

const modelCache = new WeakMap<RecordTableStore, { deps: readonly unknown[]; value: RecordTableRowModel }>();
const pagedModelCache = new WeakMap<RecordTableStore, { deps: readonly unknown[]; value: RecordTableRowModel }>();

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
      page: null,
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
  return { ordered, records, items, groups, groupBy, groupColumn, itemIndexByRowIndex, page: null };
}

/**
 * The model for one page: `items` hold that page's rows (with their group
 * headers) while `records` and `ordered` stay the whole list, so row indexes,
 * keyboard moves, range selection and ↑/↓ in the preview keep working across
 * pages (the table turns to the page of the focused row).
 */
export function pageRowModel(model: RecordTableRowModel, pageIndex: number, pageSize: number): RecordTableRowModel {
  const page = describePage(pageIndex, model.records.length, pageSize);
  const items = pageItems(model.items, page);
  const itemIndexByRowIndex: number[] = [];
  items.forEach((item, index) => {
    if (item.kind === "record") itemIndexByRowIndex[item.rowIndex] = index;
  });
  return { ...model, items, itemIndexByRowIndex, page };
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
  const defaults = useContext(RecordTableContext)?.displayDefaults ?? DEFAULT_RECORD_TABLE_DISPLAY;
  const display = resolveRecordTableDisplay(viewGroups, defaults);
  const paged = viewType === "table" && display.mode === "pages";
  const pageIndex = useStore(store, (s) => s.pageIndex);

  const model = memoForStore(
    modelCache,
    store,
    [filtered, columns, groupBy?.fieldMetadataId, groupBy?.dateGranularity, groupBy?.sort, groupBy?.direction, groupBy?.sumFieldMetadataId, collapsedGroupKeys],
    () => buildRowModel({ filtered, columns, groupBy, collapsedGroupKeys }),
  );
  return memoForStore(
    pagedModelCache,
    store,
    [model, paged, paged ? pageIndex : 0, paged ? display.pageSize : 0],
    () => (paged ? pageRowModel(model, pageIndex, display.pageSize) : model),
  );
}
