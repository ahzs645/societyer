import { createContext, useContext } from "react";
import type { RecordField } from "../../types";

/**
 * Per-cell context. Children of a cell (display or input) use this to
 * know which field they're rendering without prop-drilling.
 */
export type RecordTableCellContextValue = {
  recordField: RecordField;
  columnIndex: number;
};

export const RecordTableCellContext = createContext<RecordTableCellContextValue | null>(
  null,
);

export function useRecordTableCellContextOrThrow(): RecordTableCellContextValue {
  const ctx = useContext(RecordTableCellContext);
  if (!ctx) {
    throw new Error("useRecordTableCellContext must be used inside a cell.");
  }
  return ctx;
}
