import type { RecordField } from "../../types";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { FieldInput, isFieldEditable } from "../../record-field/components/FieldInput";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableRowContextOrThrow } from "../contexts/RecordTableRowContext";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import type { RecordTableCellRenderer } from "./RecordTable";

/**
 * One body cell. Double-click enters edit mode (for editable fields).
 * Display/edit dispatch goes through the field-type registry.
 */
export function RecordTableCell({
  recordField,
  isLabelIdentifier,
  columnIndex,
  renderCell,
}: {
  recordField: RecordField;
  isLabelIdentifier: boolean;
  columnIndex: number;
  renderCell?: RecordTableCellRenderer;
}) {
  const tableCtx = useRecordTableContextOrThrow();
  const { record, recordId, rowIndex } = useRecordTableRowContextOrThrow();
  const focusedCell = useRecordTableState((state) => state.focusedCell);
  const editingCell = useRecordTableState((state) => state.editingCell);
  const handle = useRecordTableStoreHandle();

  const value = record[recordField.field.name];
  const canEdit = isFieldEditable(recordField.field) && !!tableCtx.onUpdate;
  const isFocused = focusedCell?.rowIndex === rowIndex && focusedCell.columnIndex === columnIndex;
  const isEditing =
    canEdit &&
    editingCell?.rowIndex === rowIndex &&
    editingCell.columnIndex === columnIndex;

  const startEdit = () => {
    if (!canEdit) return;
    handle.get().setFocusedCell({ rowIndex, columnIndex });
    handle.get().setEditingCell({ rowIndex, columnIndex });
  };

  const commit = async (nextValue: unknown) => {
    handle.get().setEditingCell(null);
    if (nextValue === value) return;
    await tableCtx.onUpdate?.({
      recordId,
      fieldName: recordField.field.name,
      value: nextValue,
    });
  };

  return (
    <td
      className={
        "record-table__cell" +
        (isLabelIdentifier ? " record-table__cell--identifier" : "") +
        (canEdit ? " record-table__cell--editable" : "") +
        (isFocused ? " record-table__cell--focused" : "")
      }
      style={{ width: recordField.size, minWidth: recordField.size }}
      onDoubleClick={startEdit}
      onClick={(e) => {
        handle.get().setFocusedCell({ rowIndex, columnIndex });
        if (isLabelIdentifier && tableCtx.onRecordClick) {
          e.stopPropagation();
          tableCtx.onRecordClick(recordId, record);
        }
      }}
      data-column-index={columnIndex}
      data-field-name={recordField.field.name}
    >
      {isEditing ? (
        <FieldInput
          value={value}
          field={recordField.field}
          onCommit={commit}
          onCancel={() => handle.get().setEditingCell(null)}
        />
      ) : (
        // Custom renderer first; `undefined` falls through to the
        // metadata-driven default so pages only override what they need.
        renderCell?.({ record, field: recordField.field, value }) ?? (
          <FieldDisplay value={value} record={record} field={recordField.field} />
        )
      )}
    </td>
  );
}
