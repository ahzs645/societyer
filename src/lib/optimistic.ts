import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReference, FunctionArgs } from "convex/server";

type ListQuery = FunctionReference<"query">;

/** Patch the matching row in every cached result of `listQuery` that contains
 * an item with this `_id`. Works across different query arg combinations
 * (e.g., `{ societyId }` plus any filters). */
export function patchInList<Q extends ListQuery>(
  store: OptimisticLocalStore,
  listQuery: Q,
  id: string,
  patch: Record<string, any>,
): void {
  const all = store.getAllQueries(listQuery);
  for (const { args, value } of all) {
    if (!Array.isArray(value)) continue;
    let changed = false;
    const next = value.map((row: any) => {
      if (row && row._id === id) {
        changed = true;
        return { ...row, ...patch };
      }
      return row;
    });
    if (changed) {
      store.setQuery(listQuery, args as FunctionArgs<Q>, next as any);
    }
  }
}

/** Remove a row by id from every cached list result. */
export function removeFromList<Q extends ListQuery>(
  store: OptimisticLocalStore,
  listQuery: Q,
  id: string,
): void {
  const all = store.getAllQueries(listQuery);
  for (const { args, value } of all) {
    if (!Array.isArray(value)) continue;
    const next = value.filter((row: any) => row?._id !== id);
    if (next.length !== value.length) {
      store.setQuery(listQuery, args as FunctionArgs<Q>, next as any);
    }
  }
}

/** Prepend a provisional row to list caches. Caller supplies a temporary
 * `_id` that will be reconciled when the server response arrives. */
export function insertIntoList<Q extends ListQuery>(
  store: OptimisticLocalStore,
  listQuery: Q,
  row: any,
  matchArgs?: (args: any) => boolean,
): void {
  const all = store.getAllQueries(listQuery);
  for (const { args, value } of all) {
    if (!Array.isArray(value)) continue;
    if (matchArgs && !matchArgs(args)) continue;
    store.setQuery(listQuery, args as FunctionArgs<Q>, [row, ...value] as any);
  }
}
