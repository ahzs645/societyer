import { useContext } from "react";
import { useStore } from "zustand";
import { RecordTableContext } from "../contexts/RecordTableContext";
import { applyPendingEdits, useRecordTableStoreOrThrow, type RecordTableStore } from "../state/recordTableStore";
import { filterAndSortRecords } from "../utils/filterAndSortRecords";
import { applyStagedEdits } from "../utils/stagedEdits";

type CacheEntry<T> = { deps: readonly unknown[]; value: T };

/**
 * One derived value per table store, shared by every component that asks for
 * it. Rows, header, footer and keyboard handlers all need the filtered list;
 * memoising per component made each of N rows re-filter all N records.
 */
export function memoForStore<T>(
  cache: WeakMap<RecordTableStore, CacheEntry<T>>,
  store: RecordTableStore,
  deps: readonly unknown[],
  compute: () => T,
): T {
  const cached = cache.get(store);
  if (cached && cached.deps.length === deps.length && cached.deps.every((dep, index) => Object.is(dep, deps[index]))) {
    return cached.value;
  }
  const value = compute();
  cache.set(store, { deps, value });
  return value;
}

const filteredCache = new WeakMap<RecordTableStore, CacheEntry<any[]>>();

/**
 * Takes the records from the store plus the active view's filter/sort/search
 * state and returns a derived list. All in-memory — good enough for a few
 * thousand rows, which is where RecordTable's virtualization kicks in anyway.
 * Larger catalogs pass `serverQuery` to the scope and arrive already derived.
 */
export function useFilteredRecords() {
  const store = useRecordTableStoreOrThrow();
  const records = useStore(store, (s) => s.records);
  const columns = useStore(store, (s) => s.columns);
  const filters = useStore(store, (s) => s.filters);
  const filterGroups = useStore(store, (s) => s.filterGroups);
  const sorts = useStore(store, (s) => s.sorts);
  const searchTerm = useStore(store, (s) => s.searchTerm);
  const dateContext = useStore(store, (s) => s.dateContext);
  // Inline edits show (and sort/filter) as soon as they are made.
  const pendingEdits = useStore(store, (s) => s.pendingEdits);
  // So do a grid's batch edits that are not saved yet.
  const stagedEdits = useStore(store, (s) => s.stagedEdits);
  // A page-owned query has already searched, filtered and sorted the records.
  const serverDriven = Boolean(useContext(RecordTableContext)?.serverQuery);

  return memoForStore(
    filteredCache,
    store,
    [records, pendingEdits, stagedEdits, columns, filters, filterGroups, sorts, searchTerm, dateContext, serverDriven],
    () => {
      const edited = applyStagedEdits(applyPendingEdits(records, pendingEdits), stagedEdits);
      return serverDriven ? edited : filterAndSortRecords({ records: edited, columns, filters, filterGroups, sorts, searchTerm, dateContext });
    },
  );
}
