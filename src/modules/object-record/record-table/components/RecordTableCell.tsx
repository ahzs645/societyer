import { useState } from "react";
import type { RecordField } from "../../types";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { FieldInput, isFieldEditable } from "../../record-field/components/FieldInput";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableRowContextOrThrow } from "../contexts/RecordTableRowContext";

/**
 * One body cell. Double-click enters edit mode (for editable fields).
 * Display/edit dispatch goes through the field-type registry.
 */
export function RecordTableCell({
  recordField,
  isLabelIdentifier,
  columnIndex,
}: {
  recordField: RecordField;
  isLabelIdentifier: boolean;
  columnIndex: number;
}) {
  const tableCtx = useRecordTableContextOrThrow();
  const { record, recordId } = useRecordTableRowContextOrThrow();
  const [editing, setEditing] = useState(false);

  const value = record[recordField.field.name];
  const canEdit = isFieldEditable(recordField.field) && !!tableCtx.onUpdate;

  const startEdit = () => {
    if (canEdit) setEditing(true);
  };

  const commit = async (nextValue: unknown) => {
    setEditing(false);
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
        (canEdit ? " record-table__cell--editable" : "")
      }
      style={{ width: recordField.size, minWidth: recordField.size }}
      onDoubleClick={startEdit}
      onClick={(e) => {
        if (isLabelIdentifier && tableCtx.onRecordClick) {
          e.stopPropagation();
          tableCtx.onRecordClick(recordId, record);
        }
      }}
      data-column-index={columnIndex}
      data-field-name={recordField.field.name}
    >
      {editing ? (
        <FieldInput
          value={value}
          field={recordField.field}
          onCommit={commit}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <FieldDisplay value={value} record={record} field={recordField.field} />
      )}
    </td>
  );
}
