import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isFieldEditable } from "../../record-field/components/FieldInput";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableState, useRecordTableStoreHandle, type CellPosition } from "../state/recordTableStore";
import { FIELD_TYPES, type FieldMetadata, type RecordField } from "../../types";
import { useRecordTableRowModel } from "./useRecordTableRowModel";
import { useRecordTableColumns } from "./useRecordTableColumns";
import { recordCellText } from "../utils/recordCellText";
import { copyAsTsv } from "../../../../lib/clipboard";
import { useToast } from "../../../../components/Toast";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function isControlTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="checkbox"], [role="tab"]') !== null;
}

/** Inclusive rectangle between two cell corners. */
export function cellRange(a: CellPosition, b: CellPosition) {
  return {
    top: Math.min(a.rowIndex, b.rowIndex),
    bottom: Math.max(a.rowIndex, b.rowIndex),
    left: Math.min(a.columnIndex, b.columnIndex),
    right: Math.max(a.columnIndex, b.columnIndex),
  };
}

/** Plain-text matrix for the clipboard (TSV), skipping folded columns. */
export function buildCopyMatrix({
  records,
  columns,
  navigable,
  range,
  includeHeader = false,
}: {
  records: any[];
  columns: RecordField[];
  navigable: number[];
  range?: { top: number; bottom: number; left: number; right: number };
  includeHeader?: boolean;
}): string[][] {
  const columnIndexes = navigable.filter((index) => !range || (index >= range.left && index <= range.right));
  const rows = range ? records.slice(range.top, range.bottom + 1) : records;
  const matrix = rows.map((record) =>
    columnIndexes.map((index) => recordCellText(columns[index].field, record[columns[index].field.name], record)),
  );
  return includeHeader ? [columnIndexes.map((index) => columns[index].field.label), ...matrix] : matrix;
}

export function useRecordTableKeyboardNavigation({
  enabled,
  selectable,
}: {
  enabled: boolean;
  selectable: boolean;
}) {
  const { records: rows, ordered } = useRecordTableRowModel();
  const { objectMetadata, onRecordClick, onUpdate } = useRecordTableContextOrThrow();
  const { columns: visibleColumns, navigable } = useRecordTableColumns(objectMetadata.labelIdentifierFieldName);
  const focusedCell = useRecordTableState((state) => state.focusedCell);
  const handle = useRecordTableStoreHandle();
  const toast = useToast();

  const copy = useCallback(async () => {
    const state = handle.get();
    const focus = state.focusedCell;
    let matrix: string[][] = [];
    let summary = "";
    if (focus && state.rangeAnchor && (state.rangeAnchor.rowIndex !== focus.rowIndex || state.rangeAnchor.columnIndex !== focus.columnIndex)) {
      const range = cellRange(state.rangeAnchor, focus);
      matrix = buildCopyMatrix({ records: rows, columns: visibleColumns, navigable, range });
      const cells = matrix.reduce((sum, row) => sum + row.length, 0);
      summary = `Copied ${cells} cells`;
    } else if (state.selectedRecordIds.size > 0) {
      const selected = ordered.filter((record) => state.selectedRecordIds.has(String(record._id)));
      matrix = buildCopyMatrix({ records: selected, columns: visibleColumns, navigable, includeHeader: true });
      summary = `Copied ${selected.length} row${selected.length === 1 ? "" : "s"}`;
    } else if (focus) {
      const record = rows[focus.rowIndex];
      const column = visibleColumns[focus.columnIndex];
      if (!record || !column) return false;
      matrix = [[recordCellText(column.field, record[column.field.name], record)]];
      summary = "Copied cell";
    }
    if (matrix.length === 0) return false;
    const ok = await copyAsTsv(matrix);
    if (ok) toast.success(summary);
    else toast.error("Clipboard not available");
    return true;
  }, [handle, navigable, ordered, rows, toast, visibleColumns]);

  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      if (event.key === "Escape") {
        const wasEditing = !!handle.get().editingCell;
        handle.get().setEditingInitialValue(undefined);
        handle.get().setEditingCell(null);
        handle.get().setRangeAnchor(null);
        if (!wasEditing) handle.get().setFocusedCell(null);
        return;
      }
      // ⌘/Ctrl+C copies the selected cells (or rows, or the focused cell).
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "c") {
        if (isTypingTarget(event.target)) return;
        const textSelection = window.getSelection?.();
        if (textSelection && textSelection.toString().length > 0) return;
        const state = handle.get();
        if (!state.focusedCell && state.selectedRecordIds.size === 0) return;
        event.preventDefault();
        void copy();
        return;
      }
      // Modifier shortcuts belong to the app or browser (Ctrl/Cmd+K opens the
      // command palette — it must not also act as "k" = row up and pull focus
      // into the grid). Ctrl/Cmd+Enter is the only other modified shortcut.
      if (event.altKey || ((event.metaKey || event.ctrlKey) && event.key !== "Enter")) return;
      if (isTypingTarget(event.target)) return;
      // Toolbar, bulk-bar and in-cell buttons/links keep their native keys.
      if (isControlTarget(event.target)) return;
      if (rows.length === 0 || navigable.length === 0) return;

      const state = handle.get();
      const fallback = { rowIndex: 0, columnIndex: navigable[0] };
      const current = state.focusedCell ?? focusedCell ?? fallback;
      const navPosition = Math.max(0, navigable.indexOf(current.columnIndex));
      let next = current;
      const isArrow = event.key.startsWith("Arrow");

      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
        next = { ...current, rowIndex: Math.min(rows.length - 1, current.rowIndex + 1) };
      } else if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
        next = { ...current, rowIndex: Math.max(0, current.rowIndex - 1) };
      } else if (event.key === "ArrowRight") {
        next = { ...current, columnIndex: navigable[Math.min(navigable.length - 1, navPosition + 1)] };
      } else if (event.key === "ArrowLeft") {
        next = { ...current, columnIndex: navigable[Math.max(0, navPosition - 1)] };
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        const record = rows[current.rowIndex];
        if (record && onRecordClick) {
          event.preventDefault();
          onRecordClick(String(record._id), record, {
            source: "action",
            openRecordIn: "drawer",
          });
        }
        return;
      } else if (event.key === "Enter") {
        const column = visibleColumns[current.columnIndex];
        if (
          handle.get().focusedCell &&
          column &&
          isFieldEditable(column.field) &&
          onUpdate
        ) {
          handle.get().setEditingInitialValue(undefined);
          handle.get().setEditingCell(handle.get().focusedCell);
        }
        return;
      } else if (
        selectable &&
        (event.key === " " || event.key.toLowerCase() === "x")
      ) {
        event.preventDefault();
        const record = rows[current.rowIndex];
        if (!record) return;
        const recordId = String(record._id);
        const nextSelected = new Set(handle.get().selectedRecordIds);
        if (event.shiftKey) {
          const anchor = handle.get().selectionAnchorRowIndex ?? current.rowIndex;
          const start = Math.min(anchor, current.rowIndex);
          const end = Math.max(anchor, current.rowIndex);
          for (let index = start; index <= end; index += 1) {
            const row = rows[index];
            if (row?._id) nextSelected.add(String(row._id));
          }
        } else if (nextSelected.has(recordId)) {
          nextSelected.delete(recordId);
          handle.get().setSelectionAnchorRowIndex(current.rowIndex);
        } else {
          nextSelected.add(recordId);
          handle.get().setSelectionAnchorRowIndex(current.rowIndex);
        }
        handle.get().setSelectedRecordIds(nextSelected);
        return;
      } else if (event.key === "Backspace" || event.key === "Delete") {
        const column = visibleColumns[current.columnIndex];
        const record = rows[current.rowIndex];
        if (column && record && isFieldEditable(column.field) && onUpdate) {
          event.preventDefault();
          handle.get().setEditingCell(null);
          handle.get().setEditingInitialValue(undefined);
          handle.get().setFocusedCell(current);
          const value = clearedValueForField(column.field);
          void onUpdate({ recordId: String(record._id), fieldName: column.field.name, value });
        }
        return;
      } else if (isPrintableEditKey(event)) {
        const column = visibleColumns[current.columnIndex];
        if (column && isFieldEditable(column.field)) {
          event.preventDefault();
          handle.get().setEditingInitialValue(event.key);
          handle.get().setEditingCell(current);
        }
        return;
      } else {
        return;
      }

      event.preventDefault();
      // Shift+arrows grow a cell range from where it started; a plain move
      // drops it.
      if (isArrow && event.shiftKey) {
        if (!state.rangeAnchor) handle.get().setRangeAnchor(current);
      } else if (state.rangeAnchor) {
        handle.get().setRangeAnchor(null);
      }
      handle.get().setFocusedCell(next);
    },
    [
      copy,
      enabled,
      focusedCell,
      handle,
      navigable,
      onRecordClick,
      onUpdate,
      rows,
      selectable,
      visibleColumns,
    ],
  );
}

function isPrintableEditKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">) {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
}

function clearedValueForField(field: FieldMetadata) {
  if (field.isNullable) return null;
  if (field.fieldType === FIELD_TYPES.BOOLEAN) return false;
  if (
    field.fieldType === FIELD_TYPES.NUMBER ||
    field.fieldType === FIELD_TYPES.CURRENCY ||
    field.fieldType === FIELD_TYPES.RATING
  ) {
    return 0;
  }
  return "";
}
