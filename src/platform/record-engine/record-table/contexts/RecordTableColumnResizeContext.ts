import { createContext, useContext } from "react";

/**
 * How a header cell shows a column edge being dragged. Committing each move to
 * the store re-rendered the header, every rendered row and cell, the footer and
 * the saved-view and list-memory writers once per pointer move (7ms frames in a
 * long procurement list), so RecordTable previews the width with styles instead:
 * the column's width property (columnWidthVar), the shared `--rt-stretch` and
 * the row-actions layout, all written straight to the table's scroller. The
 * header cell commits the final width to the store once, when the pointer lifts.
 */
export type RecordTableColumnResize = {
  /** Shows the column at `size` (saved-size units) without touching the store; called at most once a frame. */
  preview: (viewFieldId: string, size: number) => void;
  /** Drops the previewed widths. `committed` says the store took a new size, whose render lays the table out again. */
  end: (committed: boolean) => void;
};

export const RecordTableColumnResizeContext = createContext<RecordTableColumnResize | null>(null);

/** Null outside a RecordTable (a header rendered on its own commits each frame instead). */
export function useRecordTableColumnResize() {
  return useContext(RecordTableColumnResizeContext);
}
