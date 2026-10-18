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
import { useRecordTableUpdate } from "./useRecordTableUpdate";
import type { RecordTableInlineEditController } from "../contexts/RecordTableInlineEditContext";
import { navigateGrid } from "../utils/gridNavigation";

const GRID_NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Tab"]);

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
  inlineEdit = null,
}: {
  enabled: boolean;
  selectable: boolean;
  /** Grid mode (RecordTable `inlineEdit`): spreadsheet keys on top of the ones below. */
  inlineEdit?: RecordTableInlineEditController | null;
}) {
  const { records: rows, ordered } = useRecordTableRowModel();
  const { objectMetadata, onRecordClick, onUpdate } = useRecordTableContextOrThrow();
  const { columns: visibleColumns, navigable } = useRecordTableColumns(objectMetadata.labelIdentifierFieldName);
  const focusedCell = useRecordTableState((state) => state.focusedCell);
  const handle = useRecordTableStoreHandle();
  const toast = useToast();
  const saveCell = useRecordTableUpdate();

  // Delete/Backspace on a cell clears it at once and offers Undo, which puts
  // the previous value back. A stray key press never loses data silently.
  const clearCell = useCallback(
    async (record: any, field: FieldMetadata) => {
      const recordId = String(record._id);
      const previous = record[field.name];
      const cleared = clearedValueForField(field);
      if (isBlankValue(previous) && isBlankValue(cleared)) return;
      const dedupeKey = `record-table-clear-${recordId}-${field.name}`;
      // The cell empties at once (optimistic) and Undo is offered straight
      // away; a failed save puts the value back and replaces this toast.
      const saving = saveCell({ recordId, fieldName: field.name, value: cleared }, { fieldLabel: field.label, dedupeKey });
      let undone = false;
      toast.success(`Cleared ${field.label.toLowerCase()}`, {
        dedupeKey,
        action: {
          label: "Undo",
          onClick: () => {
            if (undone) return;
            undone = true;
            // Restore after the clear has been sent, so they land in order.
            void saving
              .then(() => saveCell({ recordId, fieldName: field.name, value: previous }, { fieldLabel: field.label }))
              .then((ok) => {
                if (ok) toast.info("Undone", { description: `${field.label} restored`, dedupeKey });
              });
          },
        },
      });
      await saving;
    },
    [saveCell, toast],
  );

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

  /**
   * Grid-mode keys. Returns true when the key was handled (or must be left to
   * the browser, as ⌘C/X/V are for the table's clipboard events).
   */
  const handleGridKey = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): boolean => {
      if (!inlineEdit || event.altKey || isTypingTarget(event.target)) return false;
      const mod = event.metaKey || event.ctrlKey;
      const lower = event.key.toLowerCase();
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
        return true;
      };
      if (mod) {
        // The copy/cut/paste events carry the clipboard; see RecordTable.
        if (lower === "c" || lower === "x" || lower === "v") return true;
        if (lower === "z") {
          handled();
          if (event.shiftKey) inlineEdit.redo();
          else inlineEdit.undo();
          return true;
        }
        if (lower === "y") {
          handled();
          inlineEdit.redo();
          return true;
        }
        if (lower === "a") {
          handled();
          inlineEdit.selectAll(selectable);
          return true;
        }
      }
      if (isControlTarget(event.target) || rows.length === 0 || navigable.length === 0) return false;
      const state = handle.get();
      const current = state.focusedCell ?? focusedCell ?? { rowIndex: 0, columnIndex: navigable[0] };
      if (mod && lower === "e") {
        const record = rows[current.rowIndex];
        if (!record || !onRecordClick) return false;
        handled();
        onRecordClick(String(record._id), record, { source: "action", openRecordIn: "drawer" });
        return true;
      }
      if (GRID_NAVIGATION_KEYS.has(event.key)) {
        const next = navigateGrid(
          { focus: current, anchor: state.rangeAnchor },
          { key: event.key, shiftKey: event.shiftKey, mod },
          { rowCount: rows.length, navigable, pageSize: inlineEdit.pageSize() },
        );
        // Tab at either end of the grid lets focus leave the table.
        if (!next) return event.key === "Tab";
        handled();
        handle.set({ focusedCell: next.focus, rangeAnchor: next.anchor });
        return true;
      }
      if (mod) return false;
      const record = rows[current.rowIndex];
      const field = visibleColumns[current.columnIndex]?.field;
      const declared = !!field && !!inlineEdit.columnFor(field.name);
      const editable = declared && !!record && !!field && inlineEdit.canEditCell(record, field);
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!inlineEdit.clearSelection()) return false;
        handled();
        handle.get().setFocusedCell(current);
        return true;
      }
      if (!declared) return false;
      const startEdit = (seed?: string) => {
        handle.get().setRangeAnchor(null);
        handle.get().setFocusedCell(current);
        handle.get().setEditingInitialValue(seed);
        handle.get().setEditingCell(current);
      };
      // Space edits an editable cell; elsewhere (and with Shift) it keeps
      // selecting rows. Enter on a locked cell says why it won't open.
      if (event.key === " " && (!editable || event.shiftKey)) return selectable ? false : handled();
      if (event.key === "Enter" || event.key === " " || event.key === "F2") {
        handled();
        if (editable) startEdit();
        else inlineEdit.announce(`${field.label} is read-only here`);
        return true;
      }
      if (isPrintableEditKey(event)) {
        if (editable) {
          handled();
          startEdit(event.key);
          return true;
        }
        // A locked grid cell never falls through to the metadata editor; the
        // row keys (j/k to move, x to select) still work on it.
        if (lower === "j" || lower === "k" || (lower === "x" && selectable)) return false;
        return handled();
      }
      return false;
    },
    [focusedCell, handle, inlineEdit, navigable, onRecordClick, rows, selectable, visibleColumns],
  );

  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      if (event.key === "Escape") {
        const state = handle.get();
        const wasEditing = !!state.editingCell;
        // Escape steps back one layer: the editor, then the focused cell,
        // then the row selection.
        // Marked handled so the bulk island's own Escape (which clears the
        // selection) does not also act on the same key press.
        if (wasEditing || state.focusedCell || state.rangeAnchor || state.selectedRecordIds.size > 0) event.preventDefault();
        if (!wasEditing && !state.focusedCell && !state.rangeAnchor && state.selectedRecordIds.size > 0) {
          state.clearSelection();
          return;
        }
        state.setEditingInitialValue(undefined);
        state.setEditingCell(null);
        state.setRangeAnchor(null);
        if (!wasEditing) state.setFocusedCell(null);
        return;
      }
      if (inlineEdit && handleGridKey(event)) return;
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
          void clearCell(record, column.field);
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
      clearCell,
      copy,
      enabled,
      focusedCell,
      handleGridKey,
      handle,
      inlineEdit,
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

function isBlankValue(value: unknown) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
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
