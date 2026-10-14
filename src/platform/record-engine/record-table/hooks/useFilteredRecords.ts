import { useStore } from "zustand";
import { useRecordTableStoreOrThrow, type RecordTableStore } from "../state/recordTableStore";
import { filterAndSortRecords } from "../utils/filterAndSortRecords";

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

  return memoForStore(
    filteredCache,
    store,
    [records, columns, filters, filterGroups, sorts, searchTerm, dateContext],
    () => filterAndSortRecords({ records, columns, filters, filterGroups, sorts, searchTerm, dateContext }),
  );
}
