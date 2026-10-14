import { useCallback, useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";
export type SortValue = string | number | null | undefined;
export type SortState<K extends string> = { key: K; direction: SortDirection } | null;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareValues(a: SortValue, b: SortValue) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

function isBlank(value: SortValue) {
  return value == null || value === "" || (typeof value === "number" && !Number.isFinite(value));
}

/**
 * Client-side sorting for small, fully loaded tables (finance summaries,
 * statements). Clicking a column sorts by it, clicking again reverses, and a
 * third click returns to the original order. Text columns start ascending,
 * number columns descending (largest amount first); blanks always sort last.
 *
 * Pair with `<SortableTh>` for the header button and `aria-sort`.
 */
export function useSortableRows<T, K extends string>(
  rows: readonly T[] | undefined,
  accessors: Record<K, (row: NoInfer<T>) => SortValue>,
  initial: SortState<K> = null,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const sorted = useMemo(() => {
    const list = rows ? [...rows] : [];
    if (!sort) return list;
    const accessor = accessors[sort.key];
    if (!accessor) return list;
    const flip = sort.direction === "asc" ? 1 : -1;
    return list
      .map((row, index) => ({ row, index, value: accessor(row) }))
      .sort((a, b) => {
        const aBlank = isBlank(a.value);
        const bBlank = isBlank(b.value);
        // Blanks sort last in both directions; ties keep the original order.
        if (aBlank || bBlank) return aBlank === bBlank ? a.index - b.index : aBlank ? 1 : -1;
        return compareValues(a.value, b.value) * flip || a.index - b.index;
      })
      .map((entry) => entry.row);
    // Accessors are usually inline closures; re-sort when rows or sort change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  const toggle = useCallback(
    (key: K, firstDirection?: SortDirection) => {
      setSort((current) => {
        if (current?.key !== key) {
          const sample = rows?.map((row) => accessors[key]?.(row)).find((value) => !isBlank(value));
          return { key, direction: firstDirection ?? (typeof sample === "number" ? "desc" : "asc") };
        }
        const sample = rows?.map((row) => accessors[key]?.(row)).find((value) => !isBlank(value));
        const first = firstDirection ?? (typeof sample === "number" ? "desc" : "asc");
        // Second click reverses; third click clears.
        if (current.direction === first) return { key, direction: first === "asc" ? "desc" : "asc" };
        return null;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );

  return { rows: sorted, sort, toggle, setSort };
}
