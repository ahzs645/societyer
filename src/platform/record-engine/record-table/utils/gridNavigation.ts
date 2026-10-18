import type { CellPosition } from "../state/recordTableStore";

/*
 * Selection maths for RecordTable's grid mode. A selection is the focused
 * cell plus an optional anchor (the other corner of a range), as in the
 * table store. Columns move through `navigable` (visible, unfolded column
 * indexes), so folded columns are skipped. Pure, no React.
 */

export type GridBounds = {
  rowCount: number;
  /** Column indexes the selection may land on, in order. */
  navigable: readonly number[];
  /** Rows a Page Up/Down moves. */
  pageSize: number;
};

export type GridKeyInput = { key: string; shiftKey?: boolean; mod?: boolean };

export type GridSelection = { focus: CellPosition; anchor: CellPosition | null };

export type CellRect = { top: number; bottom: number; left: number; right: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Inclusive rectangle between the anchor and the focus (the focus alone without an anchor). */
export function selectionRect(selection: GridSelection): CellRect {
  const a = selection.anchor ?? selection.focus;
  const b = selection.focus;
  return {
    top: Math.min(a.rowIndex, b.rowIndex),
    bottom: Math.max(a.rowIndex, b.rowIndex),
    left: Math.min(a.columnIndex, b.columnIndex),
    right: Math.max(a.columnIndex, b.columnIndex),
  };
}

/** Every navigable cell inside a rectangle, row by row. */
export function cellsInRect(rect: CellRect, navigable: readonly number[]): CellPosition[] {
  const columns = navigable.filter((index) => index >= rect.left && index <= rect.right);
  const cells: CellPosition[] = [];
  for (let rowIndex = rect.top; rowIndex <= rect.bottom; rowIndex += 1) {
    for (const columnIndex of columns) cells.push({ rowIndex, columnIndex });
  }
  return cells;
}

/** The whole grid as a selection (focus top-left, anchor bottom-right). */
export function selectAllCells(bounds: GridBounds): GridSelection | null {
  if (bounds.rowCount === 0 || bounds.navigable.length === 0) return null;
  return {
    focus: { rowIndex: 0, columnIndex: bounds.navigable[0] },
    anchor: { rowIndex: bounds.rowCount - 1, columnIndex: bounds.navigable[bounds.navigable.length - 1] },
  };
}

/**
 * Where a navigation key takes the selection, or null when the key is not a
 * grid move (or Tab at either end of the grid, which lets focus leave).
 *
 *   arrows            one cell; with ⌘/Ctrl to the edge of the data
 *   Shift + any move  extends the range from its anchor instead of moving
 *   Page Up / Down    one page of rows
 *   Home / End        first / last column; with ⌘/Ctrl also first / last row
 *   Tab / Shift+Tab   next / previous cell, wrapping across rows
 */
export function navigateGrid(selection: GridSelection, input: GridKeyInput, bounds: GridBounds): GridSelection | null {
  const { rowCount, navigable } = bounds;
  if (rowCount === 0 || navigable.length === 0) return null;
  const lastRow = rowCount - 1;
  const lastPos = navigable.length - 1;
  const focus = {
    rowIndex: clamp(selection.focus.rowIndex, 0, lastRow),
    columnIndex: selection.focus.columnIndex,
  };
  const found = navigable.indexOf(focus.columnIndex);
  const pos = found < 0 ? 0 : found;
  const mod = Boolean(input.mod);
  const extend = Boolean(input.shiftKey);

  let row = focus.rowIndex;
  let col = pos;
  switch (input.key) {
    case "ArrowDown":
      row = mod ? lastRow : row + 1;
      break;
    case "ArrowUp":
      row = mod ? 0 : row - 1;
      break;
    case "ArrowRight":
      col = mod ? lastPos : col + 1;
      break;
    case "ArrowLeft":
      col = mod ? 0 : col - 1;
      break;
    case "PageDown":
      row += Math.max(1, bounds.pageSize);
      break;
    case "PageUp":
      row -= Math.max(1, bounds.pageSize);
      break;
    case "Home":
      col = 0;
      if (mod) row = 0;
      break;
    case "End":
      col = lastPos;
      if (mod) row = lastRow;
      break;
    case "Tab": {
      // Tab never extends: it is a cursor move, like a spreadsheet's.
      const linear = row * navigable.length + col + (extend ? -1 : 1);
      if (linear < 0 || linear > rowCount * navigable.length - 1) return null;
      return {
        focus: { rowIndex: Math.floor(linear / navigable.length), columnIndex: navigable[linear % navigable.length] },
        anchor: null,
      };
    }
    default:
      return null;
  }
  const next = { rowIndex: clamp(row, 0, lastRow), columnIndex: navigable[clamp(col, 0, lastPos)] };
  return { focus: next, anchor: extend ? selection.anchor ?? focus : null };
}
