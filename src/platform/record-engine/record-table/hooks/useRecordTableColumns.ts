import { useMemo } from "react";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { limitColumnsForPhone } from "../../../../lib/mobileTableLayout";
import { FIELD_TYPES, type FieldMetadata, type RecordField } from "../../types";
import { useRecordTableState } from "../state/recordTableStore";

/** First N visible columns stay when the preview panel condenses the table. */
const CONDENSED_KEEP_LEADING = 3;

/**
 * Whether a column folds away while the preview panel is open beside the
 * table. Field metadata can decide (`config.collapsibleWhenPanelOpen`, or
 * `config.panelPriority: "high" | "low"`); otherwise the first three visible
 * columns and any currency column stay.
 */
export function isCollapsibleWhenPanelOpen(column: RecordField, visibleIndex: number, isLabelIdentifier: boolean) {
  if (isLabelIdentifier) return false;
  const config = (column.field.config ?? {}) as { collapsibleWhenPanelOpen?: boolean; panelPriority?: "high" | "low" };
  if (typeof config.collapsibleWhenPanelOpen === "boolean") return config.collapsibleWhenPanelOpen;
  if (config.panelPriority === "high") return false;
  if (config.panelPriority === "low") return true;
  if (column.field.fieldType === FIELD_TYPES.CURRENCY) return false;
  return visibleIndex >= CONDENSED_KEEP_LEADING;
}

/**
 * The field that opens the record: the object's label identifier when the view
 * shows it, otherwise the first visible column (a view that splits a name into
 * first/last columns would else have no way into the record from the table).
 */
export function resolveIdentifierFieldName(columns: RecordField[], labelIdentifierFieldName?: string) {
  if (labelIdentifierFieldName && columns.some((column) => column.field.name === labelIdentifierFieldName)) {
    return labelIdentifierFieldName;
  }
  return columns[0]?.field.name;
}

/** Status-like by name even when stored as plain text ("reviewStatus"). */
const STATUS_NAME = /(^|[a-z])(status|state|stage)$/i;

/**
 * The field that reads as a record's status, in order of preference: a
 * select named like a status, any select, then a status-named text or
 * yes/no field (a receipt's "Status": "Voided"). The phone column cap keeps
 * it in view and the automatic phone card draws it as the badge.
 */
export function pickStatusField(fields: FieldMetadata[]): FieldMetadata | undefined {
  return (
    fields.find((field) => field.fieldType === FIELD_TYPES.SELECT && STATUS_NAME.test(field.name)) ??
    fields.find((field) => field.fieldType === FIELD_TYPES.SELECT) ??
    fields.find((field) => STATUS_NAME.test(field.name) && (field.fieldType === FIELD_TYPES.TEXT || field.fieldType === FIELD_TYPES.BOOLEAN))
  );
}

export type RecordTableColumns = {
  /** Columns the body renders (the visible ones, in order; capped on phones). */
  columns: RecordField[];
  /** Field name of the column that opens the record (see resolveIdentifierFieldName). */
  identifierFieldName: string | undefined;
  /** viewFieldIds folded to zero width while the panel is open. */
  collapsed: ReadonlySet<string>;
  /** Column indexes keyboard navigation and range copy may land on. */
  navigable: number[];
};

/**
 * Single source of truth for which columns the header, rows, footer, group
 * rows and keyboard navigation work with, so they cannot disagree.
 */
export function useRecordTableColumns(labelIdentifierFieldName?: string): RecordTableColumns {
  const allColumns = useRecordTableState((state) => state.columns);
  const panelOpen = useRecordTableState((state) => state.panelRecordId !== null);
  const isMobile = useIsMobile();

  return useMemo(() => {
    const shown = allColumns.filter((column) => column.isVisible);
    const identifierFieldName = resolveIdentifierFieldName(shown, labelIdentifierFieldName);
    // Phones render the identifier, a status-like column and the next one or
    // two; the rest stay in the record drawer and the view's column settings
    // (which read the store).
    const columns = limitColumnsForPhone(
      shown,
      isMobile,
      (column) => column.field.name === identifierFieldName,
      (candidates) => {
        const status = pickStatusField(candidates.map((column) => column.field));
        return status ? candidates.find((column) => column.field === status) : undefined;
      },
    );
    const collapsed = new Set<string>();
    // Condensing only helps a wide table sitting beside the panel.
    if (panelOpen && !isMobile && columns.length > CONDENSED_KEEP_LEADING + 1) {
      columns.forEach((column, index) => {
        if (isCollapsibleWhenPanelOpen(column, index, column.field.name === identifierFieldName)) {
          collapsed.add(column.viewFieldId);
        }
      });
    }
    const navigable = columns.map((_, index) => index).filter((index) => !collapsed.has(columns[index].viewFieldId));
    return { columns, identifierFieldName, collapsed, navigable };
  }, [allColumns, isMobile, labelIdentifierFieldName, panelOpen]);
}
