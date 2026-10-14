import type { ReactNode, ThHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDirection, SortState } from "../hooks/useSortableRows";

/**
 * A table header cell whose label is a sort button (see `useSortableRows`).
 * Sets `aria-sort` on the cell. `extra` renders beside the button (e.g. an ⓘ
 * popover) so interactive controls are never nested.
 */
export function SortableTh<K extends string>({
  column,
  sort,
  onSort,
  children,
  extra,
  firstDirection,
  className,
  ...rest
}: {
  column: K;
  sort: SortState<K>;
  onSort: (column: K, firstDirection?: SortDirection) => void;
  children: ReactNode;
  extra?: ReactNode;
  firstDirection?: SortDirection;
} & Omit<ThHTMLAttributes<HTMLTableCellElement>, "children" | "onClick">) {
  const direction = sort?.key === column ? sort.direction : null;
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <th
      {...rest}
      className={["sortable-th", direction ? "is-sorted" : "", className ?? ""].filter(Boolean).join(" ")}
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
    >
      <span className="sortable-th__inner">
        <button type="button" className="sortable-th__btn" onClick={() => onSort(column, firstDirection)}>
          <span>{children}</span>
          <Icon size={12} aria-hidden="true" className="sortable-th__icon" />
        </button>
        {extra}
      </span>
    </th>
  );
}
