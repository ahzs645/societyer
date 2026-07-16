import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Copy, ExternalLink, Mail, Pencil } from "lucide-react";
import type { RecordField } from "../../types";
import { FIELD_TYPES } from "../../types";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { FieldInput, isFieldEditable } from "../../record-field/components/FieldInput";
import { useIsMobile } from "../../../../lib/useIsMobile";
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
  const isMobile = useIsMobile();

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
      tabIndex={isFocused ? 0 : -1}
      aria-selected={isFocused}
      style={{ width: recordField.size, minWidth: recordField.size }}
      // The identifier column opens the record on a single click, so double-click
      // must NOT also try to edit it (the first click already navigates away —
      // that mismatch is what made renaming feel janky). Edit it via the hover
      // pencil instead. Other editable columns keep double-click-to-edit.
      onDoubleClick={isLabelIdentifier && tableCtx.onRecordClick ? undefined : startEdit}
      onMouseEnter={() => handle.get().setHoverPosition({ rowIndex, columnIndex })}
      onMouseLeave={() => {
        const latest = handle.get().hoverPosition;
        if (latest?.rowIndex === rowIndex && latest.columnIndex === columnIndex) {
          handle.get().setHoverPosition(null);
        }
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        // The editor and its dropdown/calendar content are rendered through
        // portals, but React still bubbles their clicks through this cell.
        // Treat those as editor interactions so Apply, Cancel, and option
        // selection cannot immediately reopen the field on mobile.
        if (target.closest(".record-table__cell-editor-popover, .menu, .calendar")) return;
        handle.get().setFocusedCell({ rowIndex, columnIndex });
        cellRef.current?.focus({ preventScroll: true });
        // Researcher's phone table opens an editable field from the cell tap
        // itself. Keep the identifier/title tap dedicated to opening the
        // record, while every other editable field enters edit mode in one
        // tap instead of exposing a tiny pencil that needs a second tap.
        if (isMobile && canEdit && !isLabelIdentifier) {
          event.preventDefault();
          startEdit();
        }
      }}
      data-column-index={columnIndex}
      data-row-index={rowIndex}
      data-field-name={recordField.field.name}
      ref={cellRef}
    >
      {isLabelIdentifier && tableCtx.onRecordClick ? (
        <button
          type="button"
          className="record-table__identifier-button"
          onClick={(event) => {
            event.stopPropagation();
            tableCtx.onRecordClick?.(recordId, record, { openRecordIn: "drawer" });
          }}
        >
          <span className="record-table__cell-content">
            {renderCell?.({ record, field: recordField.field, value }) ?? (
              <FieldDisplay value={value} record={record} field={recordField.field} />
            )}
          </span>
        </button>
      ) : (
        <div className="record-table__cell-content">
          {renderCell?.({ record, field: recordField.field, value }) ?? (
            <FieldDisplay value={value} record={record} field={recordField.field} />
          )}
        </div>
      )}
      {/* Only render the overlay when it has at least one action — an empty
          container shows up as a tiny floating box over the cell. */}
      {(isHovered || isFocused) &&
        !isEditing &&
        (secondaryActions.length > 0 || canEdit) && (
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
          {/* Inline edit pencil for any editable cell, including the identifier
              (title) column — the "open record" affordance lives once per row in
              the trailing actions column (RecordTableRow). */}
          {canEdit ? (
            <button
              type="button"
              className="record-table__cell-action"
              aria-label={`Edit ${recordField.field.label}`}
              title={`Edit ${recordField.field.label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                startEdit();
              }}
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

export function RecordTableFloatingCellEditor({
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
    // The mobile keyboard pans/resizes the visual viewport without firing
    // window scroll/resize — re-measure so the editor stays on its anchor.
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [anchorRef]);

  if (!rect) return null;

  const expanded = isExpandedEditorType(field.fieldType);
  const editorWidth = expanded ? Math.min(360, window.innerWidth - 16) : rect.width + 4;
  const editorLeft = expanded
    ? Math.min(Math.max(8, rect.left - 2), Math.max(8, window.innerWidth - editorWidth - 8))
    : Math.max(8, rect.left - 2);
  const placeExpandedAbove = expanded && rect.top > window.innerHeight / 2;

  return createPortal(
    <div
      className={`record-table__cell-editor-popover${expanded ? " record-table__cell-editor-popover--expanded" : ""}`}
      data-record-cell-editor-anchor
      style={{
        left: editorLeft,
        top: placeExpandedAbove ? undefined : Math.max(8, rect.top - 2),
        bottom: placeExpandedAbove ? Math.max(8, window.innerHeight - rect.bottom - 2) : undefined,
        minWidth: editorWidth,
        width: expanded ? editorWidth : undefined,
        height: expanded ? undefined : rect.height + 4,
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

function isExpandedEditorType(fieldType: string) {
  return [
    FIELD_TYPES.ADDRESS,
    FIELD_TYPES.FULL_NAME,
    FIELD_TYPES.RICH_TEXT,
    FIELD_TYPES.RAW_JSON,
    FIELD_TYPES.EMAILS,
    FIELD_TYPES.PHONES,
    FIELD_TYPES.LINKS,
    FIELD_TYPES.FILES,
  ].includes(fieldType as any);
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

  if (fieldType === FIELD_TYPES.EMAIL || fieldType === FIELD_TYPES.EMAILS) {
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

  if (fieldType === FIELD_TYPES.PHONE || fieldType === FIELD_TYPES.PHONES) {
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

  if (fieldType === FIELD_TYPES.LINK || fieldType === FIELD_TYPES.LINKS) {
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

  if (
    fieldType === FIELD_TYPES.TEXT ||
    fieldType === FIELD_TYPES.NUMBER ||
    fieldType === FIELD_TYPES.CURRENCY ||
    fieldType === FIELD_TYPES.DATE ||
    fieldType === FIELD_TYPES.DATE_TIME ||
    fieldType === FIELD_TYPES.UUID ||
    fieldType === FIELD_TYPES.RATING ||
    fieldType === FIELD_TYPES.RAW_JSON
  ) {
    return [{
      label: "Copy value",
      icon: <Copy size={12} />,
      onClick: () => void navigator.clipboard?.writeText(text),
    }];
  }

  return [];
}

function primaryText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const primary = String(
      record.primaryEmail ??
        record.email ??
        record.primaryPhoneNumber ??
        record.phone ??
        record.primaryLinkUrl ??
        record.url ??
        record.value ??
        "",
    ).trim();
    if (primary) return primary;
    try { return JSON.stringify(value); } catch { return ""; }
  }
  return "";
}

function absoluteUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}
