import type { CSSProperties } from "react";

/** A column is never dragged narrower than this. */
export const MIN_COLUMN_WIDTH = 80;
/** Nor wider than a saved view keeps (shared/listViewState.ts caps sizes at 2000px). */
export const MAX_COLUMN_WIDTH = 2000;

export function clampColumnWidth(size: number) {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, size));
}

/**
 * A column's name in styles: view field ids carry colons and dots, which a
 * property name can't. Cells carry it as `data-rt-col` (a spanning cell lists
 * each column it covers) so a drag can find them.
 */
export function columnToken(viewFieldId: string) {
  return viewFieldId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * The custom property a column's cells read their width from while its edge
 * is dragged. RecordTable writes it on the column's cells once a frame and
 * drops it when the drag commits to the store, so a drag moves the column
 * with a style change instead of re-rendering every row through React.
 */
export function columnWidthVar(viewFieldId: string) {
  return `--rt-w-${columnToken(viewFieldId)}`;
}

/** The column's width before stretching: the dragged width if one is live, else the saved size. */
function baseWidth(size: number, viewFieldId: string | undefined) {
  return viewFieldId ? `var(${columnWidthVar(viewFieldId)}, ${size}px)` : `${size}px`;
}

function widthStyle(base: string): CSSProperties {
  const width = `calc(${base} * var(--rt-stretch, 1))`;
  // `--rt-col-size` lets phone CSS bound a cell's content to the column, so
  // a shrunken column is not held open by its text (see `data-phone-fit`).
  return { width, minWidth: width, "--rt-col-size": base } as CSSProperties;
}

/**
 * Column width as rendered: the saved size scaled by `--rt-stretch`, which
 * RecordTable sets so columns share spare width on wide screens instead of
 * leaving an empty strip while headers truncate. The saved size stays the
 * minimum, and resizing still works in saved-size units. Pass the column's
 * `viewFieldId` so the cell follows a drag of its edge (columnWidthVar); a
 * folded column passes neither and stays at 0.
 */
export function columnWidthStyle(size: number, viewFieldId?: string): CSSProperties {
  return widthStyle(baseWidth(size, viewFieldId));
}

/** One cell spanning several columns (a group row's label), following a drag of any of them. */
export function columnSpanWidthStyle(columns: ReadonlyArray<{ size: number; viewFieldId: string }>): CSSProperties {
  if (columns.length === 0) return columnWidthStyle(0);
  if (columns.length === 1) return columnWidthStyle(columns[0].size, columns[0].viewFieldId);
  return widthStyle(`(${columns.map((column) => baseWidth(column.size, column.viewFieldId)).join(" + ")})`);
}
