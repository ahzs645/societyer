import { createContext, useContext } from "react";
import type { ObjectMetadata, ViewOpenRecordIn } from "../../types";
import type { EntityRef } from "../../../../components/HoverCard/entityRefs";

export type RecordTableOpenOptions =
  | {
      source: "row";
      openRecordIn?: ViewOpenRecordIn;
    }
  | {
      source: "action";
      openRecordIn: ViewOpenRecordIn;
    };

/** Previous/next paging for a table whose page owns the query (see RecordTableServerQuery). */
export type RecordTablePagination = {
  /** 1-based. */
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

/**
 * The page's own query fills the table: records arrive already searched,
 * filtered, sorted and paged, for a catalog too large to hold in memory. The
 * table shows them in the order given. Its search box and sort rules become
 * the page's query (read them with `useRecordTableState`), and the controls
 * that need every record (group by, board, calendar, export, Ask) are left
 * out. `RecordTablePager` draws `pagination` under the table.
 */
export type RecordTableServerQuery = {
  /** Fields the server can sort by. Sort is hidden when there are none. */
  sortableFieldNames?: string[];
  /** Matching records across all pages, when the server knows it; otherwise no count is shown. */
  total?: number | null;
  pagination?: RecordTablePagination;
};

/**
 * Metadata-level context for the table — what object are we rendering?
 * Separate from the zustand store (which holds *interaction* state)
 * because this value is invariant for the lifetime of the table.
 */
export type RecordTableContextValue = {
  tableId: string;
  objectMetadata: ObjectMetadata;
  /** Fires when a row's label-identifier cell is clicked. */
  onRecordClick?: (
    recordId: string,
    record: any,
    options: RecordTableOpenOptions,
  ) => void;
  /** Fires when a cell is edited + submitted. Receives { recordId, fieldName, value }. */
  onUpdate?: (args: { recordId: string; fieldName: string; value: unknown }) => void | Promise<void>;
  /** Creates a record through the owning page's domain workflow. */
  onCreate?: () => void | Promise<void>;
  /** Persists a user-driven row order when the object supports ordering. */
  onReorder?: (orderedRecordIds: string[]) => void | Promise<void>;
  /**
   * Record a cell previews in a hover card, if any. Objects opt in through
   * `RECORD_TABLE_CELL_PREVIEWS` (components/HoverCard/entityRefs.ts).
   */
  cellPreview?: (fieldName: string, isLabelIdentifier: boolean, record: any) => EntityRef | null;
  /** Set when the page, not the table, searches, sorts and pages the records. */
  serverQuery?: RecordTableServerQuery;
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
