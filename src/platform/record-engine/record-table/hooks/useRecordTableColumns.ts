import { useMemo } from "react";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { FIELD_TYPES, type RecordField } from "../../types";
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

export type RecordTableColumns = {
  /** Columns the body renders (the visible ones, in order). */
  columns: RecordField[];
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
    const columns = allColumns.filter((column) => column.isVisible);
    const collapsed = new Set<string>();
    // Condensing only helps a wide table sitting beside the panel.
    if (panelOpen && !isMobile && columns.length > CONDENSED_KEEP_LEADING + 1) {
      columns.forEach((column, index) => {
        if (isCollapsibleWhenPanelOpen(column, index, column.field.name === labelIdentifierFieldName)) {
          collapsed.add(column.viewFieldId);
        }
      });
    }
    const navigable = columns.map((_, index) => index).filter((index) => !collapsed.has(columns[index].viewFieldId));
    return { columns, collapsed, navigable };
  }, [allColumns, isMobile, labelIdentifierFieldName, panelOpen]);
}
