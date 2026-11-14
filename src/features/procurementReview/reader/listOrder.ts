/**
 * The order of the notices the list is showing (after its view, filters,
 * search and sort), so a notice can step to the previous or next one without
 * going back to the list. The list publishes its visible record keys; the
 * notice page reads its neighbours. One store per reader, provided by
 * ProcurementReader, and empty until a list has shown.
 */
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

/** The list as shown now, and a few earlier orders (newest first). */
export type ListOrder = { keys: readonly string[]; earlier: readonly (readonly string[])[] };

export type ListOrderStore = {
  read(): ListOrder;
  set(keys: readonly string[]): void;
  subscribe(listener: () => void): () => void;
};

/** How many earlier orders are kept, for notices that have just left the list. */
const EARLIER = 5;

export function createListOrderStore(): ListOrderStore {
  let order: ListOrder = { keys: [], earlier: [] };
  const listeners = new Set<() => void>();
  return {
    read: () => order,
    set: (next) => {
      const { keys } = order;
      if (next.length === keys.length && next.every((key, index) => key === keys[index])) return;
      order = { keys: next, earlier: keys.length ? [keys, ...order.earlier].slice(0, EARLIER) : order.earlier };
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

/**
 * The notices before and after `recordKey` in the list as it was last shown;
 * nulls at the ends. A notice that has just left the list (classifying it
 * moved it out of To review, say) keeps its place: its neighbours are the ones
 * it had, among those still listed, so J goes on to the next notice rather
 * than stopping. Its position is null then, as it is no longer counted.
 */
export function useAdjacentNotices(recordKey: string): { previous: string | null; next: string | null; position: number | null; total: number } {
  const store = useContext(ListOrderContext);
  const { keys, earlier } = useSyncExternalStore(store.subscribe, store.read);
  const index = keys.indexOf(recordKey);
  if (index >= 0) return { previous: keys[index - 1] ?? null, next: keys[index + 1] ?? null, position: index + 1, total: keys.length };
  const before = earlier.find((list) => list.includes(recordKey));
  if (!before) return { previous: null, next: null, position: null, total: keys.length };
  const listed = new Set(keys);
  const at = before.indexOf(recordKey);
  const next = before.slice(at + 1).find((key) => listed.has(key)) ?? null;
  const previous = [...before.slice(0, at)].reverse().find((key) => listed.has(key)) ?? null;
  return { previous, next, position: null, total: keys.length };
}
