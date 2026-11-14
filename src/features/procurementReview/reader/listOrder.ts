/**
 * The order of the notices the list is showing (after its view, filters,
 * search and sort), so a notice can step to the previous or next one without
 * going back to the list. The list publishes its visible record keys; the
 * notice page reads its neighbours. One store per reader, provided by
 * ProcurementReader, and empty until a list has shown.
 */
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

export type ListOrderStore = {
  read(): readonly string[];
  set(keys: readonly string[]): void;
  subscribe(listener: () => void): () => void;
};

export function createListOrderStore(): ListOrderStore {
  let keys: readonly string[] = [];
  const listeners = new Set<() => void>();
  return {
    read: () => keys,
    set: (next) => {
      if (next.length === keys.length && next.every((key, index) => key === keys[index])) return;
      keys = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

const EMPTY: ListOrderStore = createListOrderStore();
export const ListOrderContext = createContext<ListOrderStore>(EMPTY);

/** The list calls this with the record keys it shows, in order. */
export function usePublishListOrder(keys: readonly string[] | null) {
  const store = useContext(ListOrderContext);
  useEffect(() => { if (keys) store.set(keys); }, [store, keys]);
}

/** The notices before and after `recordKey` in the list as it was last shown; nulls at the ends or when it isn't in the list. */
export function useAdjacentNotices(recordKey: string): { previous: string | null; next: string | null; position: number | null; total: number } {
  const store = useContext(ListOrderContext);
  const keys = useSyncExternalStore(store.subscribe, store.read);
  const index = keys.indexOf(recordKey);
  if (index < 0) return { previous: null, next: null, position: null, total: keys.length };
  return { previous: keys[index - 1] ?? null, next: keys[index + 1] ?? null, position: index + 1, total: keys.length };
}
