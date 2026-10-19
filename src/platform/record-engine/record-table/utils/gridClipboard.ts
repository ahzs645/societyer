import type { ParseResult } from "../../../../components/EditableGrid/types";
import { parseTsv, toTsv } from "../../../../components/EditableGrid/values";
import type { CellPosition } from "../state/recordTableStore";
import type { CellRect } from "./gridNavigation";

/*
 * Clipboard planning for RecordTable's grid mode: TSV in and out (the
 * EditableGrid's spreadsheet-compatible parser and serialiser), and which
 * cells a paste writes. Pure, no React or DOM.
 */

export { parseTsv, toTsv };

/** What a paste may do to one target cell. */
export type PasteTarget =
  | { editable: true; label: string; parse: (text: string) => ParseResult }
  | { editable: false };

export type PasteWrite = CellPosition & { value: unknown };

export type PastePlan = {
  writes: PasteWrite[];
  /** Non-blank values aimed at cells that can't be edited. */
  readOnly: number;
  /** Values that failed to parse or validate. */
  invalid: number;
  /** Non-blank values that fell past the last row or column. */
  outside: number;
  /** "Row 3 · Date: …" for the first few invalid values. */
  errors: string[];
  /** The block the paste covered, for selecting it afterwards. */
  covered: { focus: CellPosition; anchor: CellPosition } | null;
};

/**
 * Lays clipboard text over the grid. A single copied value fills the whole
 * selection; a block starts at the selection's top-left cell and keeps its
 * own shape. Target columns step through `navigable`, so folded columns are
 * skipped the way they are when copying.
 */
export function planPaste({
  text,
  selection,
  rowCount,
  navigable,
  targetAt,
}: {
  text: string;
  selection: CellRect;
  rowCount: number;
  navigable: readonly number[];
  targetAt: (cell: CellPosition) => PasteTarget;
}): PastePlan {
  const plan: PastePlan = { writes: [], readOnly: 0, invalid: 0, outside: 0, errors: [], covered: null };
  const matrix = parseTsv(text);
  if (rowCount === 0 || navigable.length === 0 || matrix.length === 0) return plan;
  const leftPos = Math.max(0, navigable.findIndex((index) => index >= selection.left));
  const selectionWidth = navigable.filter((index) => index >= selection.left && index <= selection.right).length || 1;
  const single = matrix.length === 1 && matrix[0].length === 1;
  const height = single ? selection.bottom - selection.top + 1 : matrix.length;
  const width = single ? selectionWidth : Math.max(...matrix.map((row) => row.length));
  let lastRow = selection.top;
  let lastPos = leftPos;
  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      const raw = single ? matrix[0][0] : matrix[i]?.[j] ?? "";
      const rowIndex = selection.top + i;
      const pos = leftPos + j;
      if (rowIndex >= rowCount || pos >= navigable.length) {
        if (raw.trim()) plan.outside += 1;
        continue;
      }
      lastRow = Math.max(lastRow, rowIndex);
      lastPos = Math.max(lastPos, pos);
      const cell = { rowIndex, columnIndex: navigable[pos] };
      const target = targetAt(cell);
      if (!target.editable) {
        if (raw.trim()) plan.readOnly += 1;
        continue;
      }
      const parsed = target.parse(raw);
      if (parsed.ok) plan.writes.push({ ...cell, value: parsed.value });
      else {
        plan.invalid += 1;
        if (plan.errors.length < 3) plan.errors.push(`Row ${rowIndex + 1} · ${target.label}: ${parsed.error}`);
      }
    }
  }
  plan.covered = {
    focus: { rowIndex: selection.top, columnIndex: navigable[leftPos] },
    anchor: { rowIndex: lastRow, columnIndex: navigable[lastPos] },
  };
  return plan;
}

/** "Pasted 4 cells, 1 invalid skipped, 2 read-only skipped" and whether to warn. */
export function pasteSummary(plan: Pick<PastePlan, "writes" | "readOnly" | "invalid" | "outside">) {
  const parts = [`Pasted ${plan.writes.length} cell${plan.writes.length === 1 ? "" : "s"}`];
  if (plan.invalid) parts.push(`${plan.invalid} invalid skipped`);
  if (plan.readOnly) parts.push(`${plan.readOnly} read-only skipped`);
  if (plan.outside) parts.push(`${plan.outside} outside the table ignored`);
  return { message: parts.join(", "), warn: plan.invalid + plan.readOnly + plan.outside > 0 };
}
