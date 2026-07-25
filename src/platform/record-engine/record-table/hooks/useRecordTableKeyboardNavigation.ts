import { useEffect, useMemo, useRef } from "react";
import { useFilteredRecords } from "./useFilteredRecords";
import { isFieldEditable } from "../../record-field/components/FieldInput";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { FIELD_TYPES, type FieldMetadata } from "../../types";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function useRecordTableKeyboardNavigation({ enabled }: { enabled: boolean }) {
  const filteredRecords = useFilteredRecords();
  const columns = useRecordTableState((state) => state.columns);
  const visibleColumns = useMemo(
    () => columns.filter((column) => column.isVisible),
    [columns],
  );
  const focusedCell = useRecordTableState((state) => state.focusedCell);
  const handle = useRecordTableStoreHandle();
  const { onRecordClick, onUpdate } = useRecordTableContextOrThrow();
  const selectionAnchorRowIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handle.get().setFocusedCell(null);
        handle.get().setEditingInitialValue(undefined);
        handle.get().setEditingCell(null);
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (filteredRecords.length === 0 || visibleColumns.length === 0) return;

      const state = handle.get();
      const current = state.focusedCell ?? focusedCell ?? { rowIndex: 0, columnIndex: 0 };
      let next = current;

      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
        next = {
          ...current,
          rowIndex: Math.min(filteredRecords.length - 1, current.rowIndex + 1),
        };
      } else if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
        next = { ...current, rowIndex: Math.max(0, current.rowIndex - 1) };
      } else if (event.key === "ArrowRight") {
        next = {
          ...current,
          columnIndex: Math.min(visibleColumns.length - 1, current.columnIndex + 1),
        };
      } else if (event.key === "ArrowLeft") {
        next = { ...current, columnIndex: Math.max(0, current.columnIndex - 1) };
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        const record = filteredRecords[current.rowIndex];
        if (record && onRecordClick) {
          event.preventDefault();
          onRecordClick(String(record._id), record);
        }
        return;
      } else if (event.key === "Enter") {
        if (handle.get().focusedCell) {
          handle.get().setEditingInitialValue(undefined);
          handle.get().setEditingCell(handle.get().focusedCell);
        }
        return;
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        const record = filteredRecords[current.rowIndex];
        if (!record) return;
        const recordId = String(record._id);
        const nextSelected = new Set(handle.get().selectedRecordIds);
        if (event.shiftKey) {
          const anchor = selectionAnchorRowIndexRef.current ?? current.rowIndex;
          const start = Math.min(anchor, current.rowIndex);
          const end = Math.max(anchor, current.rowIndex);
          for (let index = start; index <= end; index += 1) {
            const row = filteredRecords[index];
            if (row?._id) nextSelected.add(String(row._id));
          }
        } else if (nextSelected.has(recordId)) {
          nextSelected.delete(recordId);
          selectionAnchorRowIndexRef.current = current.rowIndex;
        } else {
          nextSelected.add(recordId);
          selectionAnchorRowIndexRef.current = current.rowIndex;
        }
        handle.get().setSelectedRecordIds(nextSelected);
        return;
      } else if (event.key === "Backspace" || event.key === "Delete") {
        const column = visibleColumns[current.columnIndex];
        const record = filteredRecords[current.rowIndex];
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
      handle.get().setFocusedCell(next);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, filteredRecords, focusedCell, handle, onRecordClick, onUpdate, visibleColumns]);
}

function isPrintableEditKey(event: KeyboardEvent) {
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
