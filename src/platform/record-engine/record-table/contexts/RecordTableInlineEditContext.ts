import { createContext, useContext, type ClipboardEvent as ReactClipboardEvent } from "react";
import type { GridOption } from "../../../../components/EditableGrid/types";
import type { FieldMetadata } from "../../types";
import type { CellPosition } from "../state/recordTableStore";
import type { GridMove } from "../../../../components/EditableGrid/GridCellEditor";

/**
 * Opt-in spreadsheet editing for a RecordTable ("grid mode").
 *
 * Pass it as RecordTable's `inlineEdit` prop (memoised). Only the fields
 * named in `columns` become grid-editable; every other column, and every
 * table without the prop, behaves exactly as before (metadata-driven editing
 * through the scope's `onUpdate`, if the page gave one).
 *
 *   const inlineEdit = useMemo<RecordTableInlineEdit>(() => ({
 *     columns: {
 *       date: { editor: "date", required: true },
 *       description: { editor: "text" },
 *       amount: { editor: "currency" },
 *       category: { editor: "relation", options: accountOptions },
 *       status: { editor: "select" }, // options come from the field metadata
 *     },
 *     onCommit: ({ recordId, fieldName, value }) =>
 *       update({ id: recordId, patch: { [fieldName]: value } }),
 *   }), [accountOptions, update]);
 *
 * Saving: without `batch` each edit commits at once through `onCommit`
 * (falling back to the scope's `onUpdate`). The new value shows straight away
 * and rolls back, with a toast, when the promise rejects. With `batch`, edits
 * gather into a pending changeset under a "N pending · Discard · Save" island
 * (GridChangesetIsland) and `batch.onSave` receives them together. Typing,
 * paste, cut, clear and undo/redo all go through that one path.
 *
 * Values: parsing reuses the EditableGrid stack (components/EditableGrid),
 * so "$1,200", "4 Mar 2026" and an option's label all coerce the way the budget
 * grid does. A value that fails to parse, `required` or `validate` shows its
 * error inline and is not committed; a paste skips it and says so.
 *
 * Keyboard: the grid keys (⌘/Ctrl+arrows, Page Up/Down, Home/End, Tab,
 * ⌘A, Enter/Space to edit, ⌘C/X/V, ⌘Z/⇧⌘Z, ⌘E) are listed as data in
 * RECORD_TABLE_GRID_SHORTCUTS for a page's shortcuts sheet.
 */
export type RecordTableInlineEdit = {
  /** Editable columns, keyed by field name. Unlisted fields keep today's behaviour. */
  columns: Readonly<Record<string, RecordTableEditableColumn>>;
  /** Saves one cell. Defaults to the scope's `onUpdate`. Reject to roll the cell back. */
  onCommit?: (edit: RecordTableCellEdit) => void | Promise<void>;
  /** Gather edits into a pending changeset instead of saving each one. */
  batch?: {
    onSave: (edits: RecordTableCellEdit[]) => void | Promise<void>;
    /** Island noun, singular ("pending change" → "3 pending changes"). */
    noun?: string;
    saveLabel?: string;
  };
};

export type RecordTableEditorKind = "text" | "number" | "currency" | "date" | "select" | "relation";

/** A record row as the editors see it (records are untyped across the table). */
export type InlineEditRecord = Record<string, unknown>;

export type RecordTableEditableColumn = {
  /**
   * text · number · currency (parses "$1,200.50"; stored in cents when the
   * field's `config.isCents` is set, otherwise in dollars) · date (ISO
   * date-only) · select (options; defaults to the field's metadata options) ·
   * relation (a searchable picker over `options`, whose values are ids).
   */
  editor: RecordTableEditorKind;
  /** select / relation choices. `keywords` also match when typing or pasting. */
  options?: GridOption[] | ((record: InlineEditRecord) => GridOption[]);
  /** A blank value is rejected with "<Label> is required." */
  required?: boolean;
  /** Extra check on a parsed value; return an error message to reject it. */
  validate?: (value: unknown, record: InlineEditRecord) => string | null | undefined;
  /** Lock individual rows (e.g. reconciled entries). */
  readOnly?: (record: InlineEditRecord) => boolean;
  placeholder?: string;
  /** Value written when a cell is cleared. Defaults to null for numbers, "" otherwise. */
  emptyValue?: unknown;
};

export type RecordTableCellEdit = {
  recordId: string;
  fieldName: string;
  value: unknown;
  previousValue: unknown;
};

/** One cell write requested by an editor, a paste or a clear. */
export type InlineCellWrite = { record: InlineEditRecord; field: FieldMetadata; value: unknown };

/**
 * What RecordTable hands its cells and keyboard handler while grid mode is on
 * (built by useRecordTableInlineEditController).
 */
export type RecordTableInlineEditController = {
  config: RecordTableInlineEdit;
  columnFor: (fieldName: string) => RecordTableEditableColumn | undefined;
  /** Declared, not locked for this row, and something can save it. */
  canEditCell: (record: InlineEditRecord, field: FieldMetadata) => boolean;
  /** Validates nothing: callers pass parsed, valid values. Resolves to whether all saved. */
  commit: (writes: InlineCellWrite[], label: string) => Promise<boolean>;
  /** Clears the editable cells of the selection (or the focused cell). False when none are grid cells. */
  clearSelection: (label?: string) => boolean;
  undo: () => void;
  redo: () => void;
  selectAll: (selectable: boolean) => void;
  /** Close the editor at `from` and move as the editor asked (Enter → down, Tab → right). */
  finishEdit: (from: CellPosition, move: GridMove) => void;
  focusCell: (position: CellPosition) => void;
  /** Rows a Page Up/Down moves, from the rendered row height. */
  pageSize: () => number;
  announce: (message: string) => void;
  onCopy: (event: ReactClipboardEvent<HTMLElement>) => void;
  onCut: (event: ReactClipboardEvent<HTMLElement>) => void;
  onPaste: (event: ReactClipboardEvent<HTMLElement>) => void;
  /** Batch mode only: save or throw away the pending changeset. */
  saveBatch: () => Promise<boolean>;
  discardBatch: () => void;
};

export const RecordTableInlineEditContext = createContext<RecordTableInlineEditController | null>(null);

/** The grid-mode controller, or null when the table did not opt in. */
export function useRecordTableInlineEdit(): RecordTableInlineEditController | null {
  return useContext(RecordTableInlineEditContext);
}
