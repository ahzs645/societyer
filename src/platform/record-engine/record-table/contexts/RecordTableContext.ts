import { createContext, useContext } from "react";
import type { ObjectMetadata } from "../../types";

/**
 * Metadata-level context for the table — what object are we rendering?
 * Separate from the zustand store (which holds *interaction* state)
 * because this value is invariant for the lifetime of the table.
 */
export type RecordTableContextValue = {
  tableId: string;
  objectMetadata: ObjectMetadata;
  /** Fires when a row's label-identifier cell is clicked. */
  onRecordClick?: (recordId: string, record: any) => void;
  /** Fires when a cell is edited + submitted. Receives { recordId, fieldName, value }. */
  onUpdate?: (args: { recordId: string; fieldName: string; value: unknown }) => void | Promise<void>;
};

export const RecordTableContext = createContext<RecordTableContextValue | null>(null);

export function useRecordTableContextOrThrow(): RecordTableContextValue {
  const ctx = useContext(RecordTableContext);
  if (!ctx) {
    throw new Error(
      "useRecordTableContext must be used inside a <RecordTableScope>.",
    );
  }
  return ctx;
}
