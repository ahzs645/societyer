import { useEffect, useMemo } from "react";
import { useFilteredRecords } from "./useFilteredRecords";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";

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

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handle.get().setFocusedCell(null);
        handle.get().setEditingCell(null);
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (filteredRecords.length === 0 || visibleColumns.length === 0) return;

      const current = focusedCell ?? { rowIndex: 0, columnIndex: 0 };
      let next = current;

      if (event.key === "ArrowDown") {
        next = {
          ...current,
          rowIndex: Math.min(filteredRecords.length - 1, current.rowIndex + 1),
        };
      } else if (event.key === "ArrowUp") {
        next = { ...current, rowIndex: Math.max(0, current.rowIndex - 1) };
      } else if (event.key === "ArrowRight") {
        next = {
          ...current,
          columnIndex: Math.min(visibleColumns.length - 1, current.columnIndex + 1),
        };
      } else if (event.key === "ArrowLeft") {
        next = { ...current, columnIndex: Math.max(0, current.columnIndex - 1) };
      } else if (event.key === "Enter") {
        if (handle.get().focusedCell) {
          handle.get().setEditingCell(handle.get().focusedCell);
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
  }, [enabled, filteredRecords, focusedCell, handle, visibleColumns.length]);
}
