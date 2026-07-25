import { createContext, useContext } from "react";

/**
 * Provides the current record + row index to children. Cell components
 * pull from here instead of drilling props through the row.
 */
export type RecordTableRowContextValue = {
  record: any;
  recordId: string;
  rowIndex: number;
};

export const RecordTableRowContext = createContext<RecordTableRowContextValue | null>(
  null,
);

export function useRecordTableRowContextOrThrow(): RecordTableRowContextValue {
  const ctx = useContext(RecordTableRowContext);
  if (!ctx) {
    throw new Error("useRecordTableRowContext must be used inside a row.");
  }
  return ctx;
}
