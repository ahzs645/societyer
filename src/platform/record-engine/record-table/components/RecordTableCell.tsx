import { isValidElement, useCallback, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { columnWidthStyle } from "../utils/columnWidth";
import { createPortal } from "react-dom";
import { Copy, ExternalLink, Mail, Pencil } from "lucide-react";
import type { RecordField } from "../../types";
import { FIELD_TYPES } from "../../types";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { FieldInput, isFieldEditable } from "../../record-field/components/FieldInput";
import { FieldInputFlushContext, type RegisterFieldInputFlush } from "../../record-field/components/fieldInputFlush";
import { useRecordTableUpdate } from "../hooks/useRecordTableUpdate";
import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableRowContextOrThrow } from "../contexts/RecordTableRowContext";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import type { RecordTableCellRenderer } from "./RecordTable";
import { Tooltip } from "../../../../components/Tooltip";
import { EntityHoverCard } from "../../../../components/HoverCard/EntityHoverCard";

/**
 * One body cell. Double-click enters edit mode (for editable fields).
 * Display/edit dispatch goes through the field-type registry.
 */
export function RecordTableCell({
  recordField,
  isLabelIdentifier,
  columnIndex,
  renderCell,
  selectionControl,
  collapsed = false,
  pressHandlers,
}: {
  recordField: RecordField;
  isLabelIdentifier: boolean;
  columnIndex: number;
  renderCell?: RecordTableCellRenderer;
  selectionControl?: ReactNode;
  /** Folded to zero width while the preview panel condenses the table. */
  collapsed?: boolean;
  /** Row-level touch handlers (long-press to select) spread on the cell. */
  pressHandlers?: Partial<HTMLAttributes<HTMLTableCellElement>>;
}) {
  const tableCtx = useRecordTableContextOrThrow();
  const { record, recordId, rowIndex } = useRecordTableRowContextOrThrow();
  // Subscribe to derived booleans, not the raw positions: with the raw objects
  // every mounted cell re-renders on each hover/focus change anywhere in the
  // table (the position object is new each time). Object.is on the boolean
  // means a cell only re-renders when ITS OWN state flips.
  const isFocused = useRecordTableState(
    (state) =>
      state.focusedCell?.rowIndex === rowIndex &&
      state.focusedCell.columnIndex === columnIndex,
  );
  const isHovered = useRecordTableState(
    (state) =>
      state.hoverPosition?.rowIndex === rowIndex &&
      state.hoverPosition.columnIndex === columnIndex,
  );
  const isInRange = useRecordTableState((state) => {
    const anchor = state.rangeAnchor;
    const focus = state.focusedCell;
    if (!anchor || !focus) return false;
    return (
      rowIndex >= Math.min(anchor.rowIndex, focus.rowIndex) &&
      rowIndex <= Math.max(anchor.rowIndex, focus.rowIndex) &&
      columnIndex >= Math.min(anchor.columnIndex, focus.columnIndex) &&
      columnIndex <= Math.max(anchor.columnIndex, focus.columnIndex)
    );
  });
  const isEditingThisCell = useRecordTableState(
    (state) =>
      state.editingCell?.rowIndex === rowIndex &&
      state.editingCell.columnIndex === columnIndex,
  );
  // Only the cell being edited cares about the seed value; every other cell
  // sees a stable undefined and skips the re-render.
  const editingInitialValue = useRecordTableState((state) =>
    state.editingCell?.rowIndex === rowIndex &&
    state.editingCell.columnIndex === columnIndex
      ? state.editingInitialValue
      : undefined,
  );
  // Touch screens have no hover: the name cell offers its rename pencil
  // whenever any cell in its row is focused.
  const isRowFocused = useRecordTableState(
    (state) => isLabelIdentifier && state.focusedCell?.rowIndex === rowIndex,
  );
  const isPending = useRecordTableState((state) => {
    const edit = state.pendingEdits.get(recordId)?.get(recordField.field.name);
    return !!edit && !edit.settled;
  });
  const handle = useRecordTableStoreHandle();
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const lastPointerTypeRef = useRef<string>("mouse");
  const isMobile = useIsMobile();
  const isCoarsePointer = useCoarsePointer();
  const saveCell = useRecordTableUpdate();
  // The open editor hands the table its "save now" call, used when a click
  // or tap lands outside the table (see RecordTable's outside handler).
  const registerFlush = useCallback<RegisterFieldInputFlush>((flush) => {
    handle.get().setEditorFlush(flush);
    return () => {
      if (handle.get().editorFlush === flush) handle.get().setEditorFlush(null);
    };
  }, [handle]);

  const value = record[recordField.field.name];
  const canEdit = isFieldEditable(recordField.field) && !!tableCtx.onUpdate;
  // Phones: a tap anywhere on the row opens the record when the table can open
  // one, and fields are edited in its drawer/panel rather than in the grid.
  const tapOpensRecord = isMobile && !!tableCtx.onRecordClick;
  const canInlineEdit = canEdit && !tapOpensRecord;
  const opensRecord = isLabelIdentifier && !!tableCtx.onRecordClick;
  const isNumeric = isNumericCellType(recordField.field.fieldType);
  const isEditing = canEdit && isEditingThisCell;
  const secondaryActions = useMemo(
    () => getSecondaryActions({ fieldType: recordField.field.fieldType, value }),
    [recordField.field.fieldType, value],
  );
  const { cellPreview } = tableCtx;
  const previewRef = useMemo(
    () => cellPreview?.(recordField.field.name, isLabelIdentifier, record) ?? null,
    [cellPreview, recordField.field.name, isLabelIdentifier, record],
  );
  const customContent = renderCell?.({ record, field: recordField.field, value });
  const cellContent = customContent ?? (
    <FieldDisplay value={value} record={record} field={recordField.field} />
  );
  // A first column standing in for an identifier the view doesn't show may
  // already be the page's own open-record control (a button); wrapping it in
  // another button would nest them, so the cell itself opens the record.
  // Members and directors draw their first-name identifier as such a button
  // too, so a page's own <button> is never wrapped either.
  const identifierIsStandIn = opensRecord && recordField.field.name !== tableCtx.objectMetadata.labelIdentifierFieldName;
  const customIsOwnControl = isValidElement(customContent) && customContent.type === "button";
  const wrapIdentifierButton = opensRecord && !customIsOwnControl && !(identifierIsStandIn && customContent != null);
  const previewedContent = previewRef ? (
    <EntityHoverCard entity={previewRef}>{cellContent}</EntityHoverCard>
  ) : cellContent;

  const openRecord = () => tableCtx.onRecordClick?.(recordId, record, { source: "row" });

  const startEdit = () => {
    if (!canInlineEdit) return;
    handle.get().setFocusedCell({ rowIndex, columnIndex });
    handle.get().setEditingInitialValue(undefined);
    handle.get().setEditingCell({ rowIndex, columnIndex });
  };

  const commit = async (nextValue: unknown) => {
    // One commit per edit: a blur that follows an outside-click save (or an
    // Enter) must not write the value a second time.
    const editing = handle.get().editingCell;
    if (editing?.rowIndex !== rowIndex || editing.columnIndex !== columnIndex) return;
    handle.get().setEditingCell(null);
    handle.get().setEditingInitialValue(undefined);
    if (nextValue === value) return;
    await saveCell(
      { recordId, fieldName: recordField.field.name, value: nextValue },
      { fieldLabel: recordField.field.label },
    );
  };

  return (
    <td
      className={
        "record-table__cell" +
        (selectionControl ? " record-table__cell--mobile-selecting" : "") +
        (opensRecord ? " record-table__cell--identifier" : "") +
        (canInlineEdit ? " record-table__cell--editable" : "") +
        (isHovered ? " record-table__cell--hovered" : "") +
        (isFocused ? " record-table__cell--focused" : "") +
        (isInRange ? " record-table__cell--in-range" : "") +
        (isNumeric ? " record-table__cell--numeric" : "") +
        (collapsed ? " record-table__cell--collapsed" : "")
      }
      tabIndex={isFocused && !collapsed ? 0 : -1}
      aria-selected={isFocused || isInRange}
      aria-busy={isPending || undefined}
      {...pressHandlers}
      onPointerDown={(event) => {
        lastPointerTypeRef.current = event.pointerType;
        pressHandlers?.onPointerDown?.(event);
      }}
      aria-hidden={collapsed || undefined}
      style={columnWidthStyle(collapsed ? 0 : recordField.size)}
      onMouseDown={(event) => {
        // Shift+click extends a cell range; keep the browser from also
        // selecting text across the rows.
        if (event.shiftKey) event.preventDefault();
      }}
      // The identifier column opens the record on a single click, so double-click
      // must NOT also try to edit it (the first click already navigates away —
      // that mismatch is what made renaming feel janky). Edit it via the hover
      // pencil instead. Other editable columns keep double-click-to-edit.
      onDoubleClick={opensRecord ? undefined : startEdit}
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
        const state = handle.get();
        if (event.shiftKey && state.focusedCell && !isMobile) {
          // Shift+click: the previously focused cell anchors a range.
          if (!state.rangeAnchor) state.setRangeAnchor(state.focusedCell);
          state.setFocusedCell({ rowIndex, columnIndex });
          cellRef.current?.focus({ preventScroll: true });
          return;
        }
        if (state.rangeAnchor) state.setRangeAnchor(null);
        // A control inside the cell (the page's own name button, a link)
        // handles its own tap or click.
        const ownControl = target.closest("button, a[href], input, label");
        const inOwnControl = !!ownControl && ownControl !== event.currentTarget && event.currentTarget.contains(ownControl);
        if ((tapOpensRecord || (opensRecord && !wrapIdentifierButton)) && !inOwnControl) {
          event.preventDefault();
          openRecord();
          return;
        }
        const wasFocused = state.focusedCell?.rowIndex === rowIndex && state.focusedCell.columnIndex === columnIndex;
        handle.get().setFocusedCell({ rowIndex, columnIndex });
        cellRef.current?.focus({ preventScroll: true });
        // A phone table that cannot open records edits a field from the cell
        // tap itself (one tap, not a tiny pencil that needs a second tap).
        if (isMobile && canInlineEdit && !isLabelIdentifier) {
          event.preventDefault();
          startEdit();
          return;
        }
        // Touch on a wider screen (tablets): the first tap focuses the cell
        // and shows its pencil; tapping the focused cell again edits it, so
        // nobody has to rely on a double-tap.
        const touch = lastPointerTypeRef.current === "touch" || lastPointerTypeRef.current === "pen";
        if (touch && wasFocused && canInlineEdit && !opensRecord) {
          event.preventDefault();
          startEdit();
        }
      }}
      data-column-index={columnIndex}
      data-row-index={rowIndex}
      data-field-name={recordField.field.name}
      ref={cellRef}
    >
      {selectionControl}
      {wrapIdentifierButton ? (
        <button
          type="button"
          className="record-table__identifier-button"
          onClick={(event) => {
            event.stopPropagation();
            openRecord();
          }}
        >
          {/* Hidden until the phone table scrolls sideways, when the frozen
              identifier column collapses to this single-letter card the way
              Researcher's does. */}
          <span className="record-table__identifier-avatar" aria-hidden="true">
            {identifierInitial(value)}
          </span>
          <span className="record-table__cell-content" style={isPending ? PENDING_CONTENT_STYLE : undefined}>{previewedContent}</span>
        </button>
      ) : (
        <div className="record-table__cell-content" style={isPending ? PENDING_CONTENT_STYLE : undefined}>{previewedContent}</div>
      )}
      {/* Only render the overlay when it has at least one action — an empty
          container shows up as a tiny floating box over the cell. */}
      {(isHovered || isFocused || (isCoarsePointer && isRowFocused && canInlineEdit)) &&
        !isEditing &&
        (secondaryActions.length > 0 || canInlineEdit) && (
        <div
          className={
            "record-table__cell-actions" +
            // Hover-only actions are hidden on touch; the focused cell (and
            // its row's name cell) keep theirs so editing has a visible way in.
            ((isFocused || isRowFocused) && isCoarsePointer ? " record-table__cell-actions--touch" : "")
          }
          onClick={(event) => event.stopPropagation()}
        >
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
          {canInlineEdit ? (
            <Tooltip content={`Edit ${recordField.field.label}`}>
              <button
                type="button"
                className="record-table__cell-action"
                aria-label={`Edit ${recordField.field.label}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  startEdit();
                }}
              >
                <Pencil size={12} />
              </button>
            </Tooltip>
          ) : null}
        </div>
      )}
      {isEditing && (
        <RecordTableFloatingCellEditor
          anchorRef={cellRef}
          registerFlush={registerFlush}
          value={value}
          field={recordField.field}
          initialValue={editingInitialValue}
          onCommit={commit}
          onCancel={() => {
            handle.get().setEditingInitialValue(undefined);
            handle.get().setEditingCell(null);
            cellRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </td>
  );
}

/** A saved-but-not-yet-confirmed value reads as provisional until it lands. */
const PENDING_CONTENT_STYLE = { opacity: 0.55 } as const;

export function RecordTableFloatingCellEditor({
  anchorRef,
  value,
  field,
  initialValue,
  onCommit,
  onCancel,
  registerFlush,
}: {
  anchorRef: RefObject<HTMLElement>;
  /** Lets the host save the draft when it closes the editor from outside. */
  registerFlush?: RegisterFieldInputFlush;
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
      <FieldInputFlushContext.Provider value={registerFlush ?? null}>
        <FieldInput
          value={value}
          field={field}
          initialValue={initialValue}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </FieldInputFlushContext.Provider>
    </div>,
    document.body,
  );
}

function isNumericCellType(fieldType: string) {
  return fieldType === FIELD_TYPES.CURRENCY || fieldType === FIELD_TYPES.NUMBER;
}

function identifierInitial(value: unknown): string {
  const text = String(value ?? "").trim();
  return text.charAt(0).toUpperCase() || "·";
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
