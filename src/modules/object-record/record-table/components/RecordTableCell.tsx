import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Copy, ExternalLink, Mail, Pencil } from "lucide-react";
import type { RecordField } from "../../types";
import { FIELD_TYPES } from "../../types";
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
  const hoverPosition = useRecordTableState((state) => state.hoverPosition);
  const editingCell = useRecordTableState((state) => state.editingCell);
  const editingInitialValue = useRecordTableState((state) => state.editingInitialValue);
  const handle = useRecordTableStoreHandle();
  const cellRef = useRef<HTMLTableCellElement | null>(null);

  const value = record[recordField.field.name];
  const canEdit = isFieldEditable(recordField.field) && !!tableCtx.onUpdate;
  const isFocused = focusedCell?.rowIndex === rowIndex && focusedCell.columnIndex === columnIndex;
  const isHovered = hoverPosition?.rowIndex === rowIndex && hoverPosition.columnIndex === columnIndex;
  const isEditing =
    canEdit &&
    editingCell?.rowIndex === rowIndex &&
    editingCell.columnIndex === columnIndex;
  const secondaryActions = useMemo(
    () => getSecondaryActions({ fieldType: recordField.field.fieldType, value }),
    [recordField.field.fieldType, value],
  );

  const startEdit = () => {
    if (!canEdit) return;
    handle.get().setFocusedCell({ rowIndex, columnIndex });
    handle.get().setEditingInitialValue(undefined);
    handle.get().setEditingCell({ rowIndex, columnIndex });
  };

  const commit = async (nextValue: unknown) => {
    handle.get().setEditingCell(null);
    handle.get().setEditingInitialValue(undefined);
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
        (isLabelIdentifier && tableCtx.onRecordClick ? " record-table__cell--identifier" : "") +
        (canEdit ? " record-table__cell--editable" : "") +
        (isHovered ? " record-table__cell--hovered" : "") +
        (isFocused ? " record-table__cell--focused" : "")
      }
      style={{ width: recordField.size, minWidth: recordField.size }}
      onDoubleClick={startEdit}
      onMouseEnter={() => handle.get().setHoverPosition({ rowIndex, columnIndex })}
      onMouseLeave={() => {
        const latest = handle.get().hoverPosition;
        if (latest?.rowIndex === rowIndex && latest.columnIndex === columnIndex) {
          handle.get().setHoverPosition(null);
        }
      }}
      onClick={(e) => {
        handle.get().setFocusedCell({ rowIndex, columnIndex });
        if (isLabelIdentifier && tableCtx.onRecordClick) {
          e.stopPropagation();
          tableCtx.onRecordClick(recordId, record);
        }
      }}
      data-column-index={columnIndex}
      data-field-name={recordField.field.name}
      ref={cellRef}
    >
      <div className="record-table__cell-content">
        {renderCell?.({ record, field: recordField.field, value }) ?? (
          <FieldDisplay value={value} record={record} field={recordField.field} />
        )}
      </div>
      {(isHovered || isFocused) && !isEditing && (
        <div className="record-table__cell-actions" onClick={(event) => event.stopPropagation()}>
          {secondaryActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="record-table__cell-action"
              aria-label={action.label}
              title={action.label}
              onClick={action.onClick}
            >
              {action.icon}
            </button>
          ))}
          {/* The "open record" affordance lives once per row in the trailing
              actions column (RecordTableRow). The identifier cell itself is a
              link (click to open), so we don't repeat the open icon here —
              only the inline edit pencil for editable non-identifier cells. */}
          {canEdit && !isLabelIdentifier ? (
            <button
              type="button"
              className="record-table__cell-action"
              aria-label={`Edit ${recordField.field.label}`}
              title={`Edit ${recordField.field.label}`}
              onClick={startEdit}
            >
              <Pencil size={12} />
            </button>
          ) : null}
        </div>
      )}
      {isEditing && (
        <RecordTableFloatingCellEditor
          anchorRef={cellRef}
          value={value}
          field={recordField.field}
          initialValue={editingInitialValue}
          onCommit={commit}
          onCancel={() => {
            handle.get().setEditingInitialValue(undefined);
            handle.get().setEditingCell(null);
          }}
        />
      )}
    </td>
  );
}

function RecordTableFloatingCellEditor({
  anchorRef,
  value,
  field,
  initialValue,
  onCommit,
  onCancel,
}: {
  anchorRef: RefObject<HTMLElement>;
  value: unknown;
  field: RecordField["field"];
  initialValue?: string;
  onCommit: (value: unknown) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const next = anchorRef.current?.getBoundingClientRect();
      if (next) setRect(next);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef]);

  if (!rect) return null;

  return createPortal(
    <div
      className="record-table__cell-editor-popover"
      data-record-cell-editor-anchor
      style={{
        left: Math.max(8, rect.left - 2),
        top: Math.max(8, rect.top - 2),
        minWidth: rect.width + 4,
        height: rect.height + 4,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <FieldInput
        value={value}
        field={field}
        initialValue={initialValue}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>,
    document.body,
  );
}

function getSecondaryActions({
  fieldType,
  value,
}: {
  fieldType: string;
  value: unknown;
}) {
  const text = primaryText(value);
  if (!text) return [];

  if (fieldType === FIELD_TYPES.EMAIL) {
    return [
      {
        label: "Copy email",
        icon: <Copy size={12} />,
        onClick: () => void navigator.clipboard?.writeText(text),
      },
      {
        label: "Email",
        icon: <Mail size={12} />,
        onClick: () => window.open(`mailto:${text}`, "_blank"),
      },
    ];
  }

  if (fieldType === FIELD_TYPES.PHONE) {
    return [
      {
        label: "Copy phone",
        icon: <Copy size={12} />,
        onClick: () => void navigator.clipboard?.writeText(text),
      },
      {
        label: "Call",
        icon: <ExternalLink size={12} />,
        onClick: () => window.open(`tel:${text}`, "_blank"),
      },
    ];
  }

  if (fieldType === FIELD_TYPES.LINK) {
    return [
      {
        label: "Copy link",
        icon: <Copy size={12} />,
        onClick: () => void navigator.clipboard?.writeText(text),
      },
      {
        label: "Open link",
        icon: <ExternalLink size={12} />,
        onClick: () => window.open(absoluteUrl(text), "_blank", "noopener,noreferrer"),
      },
    ];
  }

  return [];
}

function primaryText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(
      record.primaryEmail ??
        record.email ??
        record.primaryPhoneNumber ??
        record.phone ??
        record.primaryLinkUrl ??
        record.url ??
        record.value ??
        "",
    ).trim();
  }
  return "";
}

function absoluteUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}
