import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { GridCellEditor, type GridMove } from "../../../../components/EditableGrid/GridCellEditor";
import { useToast } from "../../../../components/Toast";
import type { FieldMetadata } from "../../types";
import type {
  InlineEditRecord,
  RecordTableEditableColumn,
  RecordTableInlineEditController,
} from "../contexts/RecordTableInlineEditContext";
import { useRecordTableStoreHandle, type CellPosition } from "../state/recordTableStore";
import { checkInlineValue, formatInlineText, parseInlineText, toGridColumn, toGridRow } from "../utils/inlineEditValues";
import { RecordTableCellEditorFrame } from "./RecordTableCellEditorFrame";

/** A rejected value: the editor reopens on the same text with the reason under it. */
type Attempt = { key: number; text: string; error: string };

/**
 * Grid-mode editor for a declared column: the EditableGrid's cell editors
 * (text, number/currency, date, searchable select) in the table's floating
 * editor frame. A value that fails to parse or validate stays open with its
 * error shown (and announced) and is not committed.
 */
export function RecordTableGridCellEditor({
  anchorRef,
  record,
  field,
  column,
  position,
  initialText,
  controller,
}: {
  anchorRef: RefObject<HTMLElement>;
  record: InlineEditRecord;
  field: FieldMetadata;
  column: RecordTableEditableColumn;
  position: CellPosition;
  /** Text typed to start the edit (replaces the value); undefined edits the value. */
  initialText?: string;
  controller: RecordTableInlineEditController;
}) {
  const handle = useRecordTableStoreHandle();
  const toast = useToast();
  const frameRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const gridColumn = useMemo(() => toGridColumn(field, column), [field, column]);
  const gridRow = useMemo(() => toGridRow(record), [record]);

  // A click outside the table saves the draft the way Enter does: the table
  // calls this before closing the editor, and the input's blur commits.
  useEffect(() => {
    const flush = () => {
      const input = frameRef.current?.querySelector<HTMLElement>("input");
      if (input && document.activeElement === input) input.blur();
    };
    handle.get().setEditorFlush(flush);
    return () => {
      if (handle.get().editorFlush === flush) handle.get().setEditorFlush(null);
    };
  }, [handle]);

  const reject = (text: string, error: string, move: GridMove) => {
    if (move === "blur") {
      // Focus already left the cell, so the editor can't stay open.
      controller.announce(`${field.label} not saved: ${error}`);
      toast.error(`${field.label} not saved`, { description: error });
      controller.finishEdit(position, "blur");
      return;
    }
    setAttempt((current) => ({ key: (current?.key ?? 0) + 1, text, error }));
  };

  const save = (value: unknown, move: GridMove) => {
    void controller.commit([{ record, field, value }], `Edit ${field.label.toLowerCase()}`);
    controller.finishEdit(position, move);
  };

  const seeded = attempt !== null || initialText !== undefined;
  // Pickers reopen on the rejected text (as a search / typed date); plain
  // inputs reopen on it with the caret at the end.
  const mode = attempt
    ? column.editor === "select" || column.editor === "relation" || column.editor === "date" ? "replace" : "edit"
    : seeded ? "replace" : "edit";
  const startText = attempt?.text ?? initialText ?? formatInlineText(record[field.name], field, column, record);

  return (
    <RecordTableCellEditorFrame anchorRef={anchorRef} frameRef={frameRef} className="record-table__cell-editor-popover--grid">
      <GridCellEditor
        key={attempt?.key ?? 0}
        col={gridColumn}
        row={gridRow}
        value={record[field.name]}
        initialText={startText}
        mode={mode}
        anchor={anchorRef.current}
        label={`${field.label}, row ${position.rowIndex + 1}`}
        onCommitText={(text, move) => {
          const parsed = parseInlineText(text, field, column, record);
          if (parsed.ok) save(parsed.value, move);
          else reject(text, parsed.error, move);
        }}
        onCommitValue={(value, move) => {
          const checked = checkInlineValue(value, field, column, record);
          if (checked.ok) save(checked.value, move);
          else reject(formatInlineText(value, field, column, record), checked.error, move);
        }}
        onCancel={(fromBlur) => {
          handle.get().setEditingInitialValue(undefined);
          handle.get().setEditingCell(null);
          if (!fromBlur) controller.focusCell(position);
        }}
      />
      {attempt && (
        <div className="record-table__cell-editor-error" role="alert">
          {attempt.error}
        </div>
      )}
    </RecordTableCellEditorFrame>
  );
}
