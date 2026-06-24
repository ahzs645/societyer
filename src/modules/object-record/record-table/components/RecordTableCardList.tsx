import { type ReactNode, useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import type { RecordField } from "../../types";
import type { RecordTableCellRenderer } from "./RecordTable";

/**
 * Mobile presentation of the record table: one stacked card per record
 * instead of a wide horizontally-scrolling <table>. Metadata-driven — it
 * reuses the same visible columns + FieldDisplay as the table, so every
 * RecordTable page gets phone-friendly cards for free.
 *
 * The label-identifier column becomes the card title; the next few visible
 * columns render as label/value detail rows. Tapping a card opens the
 * record (same as clicking the identifier cell on desktop).
 */
export function RecordTableCardList({
  records,
  selectable,
  renderRowActions,
  renderCell,
  detailLimit = 5,
}: {
  records: any[];
  selectable: boolean;
  renderRowActions?: (record: any) => ReactNode;
  renderCell?: RecordTableCellRenderer;
  /** Max number of secondary fields shown under the title. */
  detailLimit?: number;
}) {
  const columns = useRecordTableState((s) => s.columns);
  const selectedRecordIds = useRecordTableState((s) => s.selectedRecordIds);
  const { objectMetadata, onRecordClick } = useRecordTableContextOrThrow();
  const handle = useRecordTableStoreHandle();

  const visibleColumns = useMemo(() => columns.filter((c) => c.isVisible), [columns]);

  const { primaryColumn, detailColumns } = useMemo(() => {
    const identifier =
      visibleColumns.find(
        (c) => c.field.name === objectMetadata.labelIdentifierFieldName,
      ) ?? visibleColumns[0];
    const rest = visibleColumns
      .filter((c) => c !== identifier)
      .slice(0, detailLimit);
    return { primaryColumn: identifier, detailColumns: rest };
  }, [visibleColumns, objectMetadata.labelIdentifierFieldName, detailLimit]);

  const renderField = (column: RecordField, record: any) => {
    const value = record[column.field.name];
    return (
      renderCell?.({ record, field: column.field, value }) ?? (
        <FieldDisplay value={value} record={record} field={column.field} />
      )
    );
  };

  const toggleRow = (recordId: string) => {
    const next = new Set(handle.get().selectedRecordIds);
    if (next.has(recordId)) next.delete(recordId);
    else next.add(recordId);
    handle.get().setSelectedRecordIds(next);
  };

  return (
    <div className="card-list" role="list" aria-label={objectMetadata.labelPlural}>
      {records.map((record: any) => {
        const recordId = String(record._id);
        const isSelected = selectedRecordIds.has(recordId);
        const interactive = !!onRecordClick;
        return (
          <div
            key={recordId}
            className={
              "card-list__item" +
              (interactive ? " card-list__item--interactive" : "") +
              (isSelected ? " card-list__item--selected" : "")
            }
            role="listitem"
            onClick={interactive ? () => onRecordClick?.(recordId, record) : undefined}
          >
            <div className="card-list__primary">
              {selectable && (
                <input
                  type="checkbox"
                  className="card-list__checkbox"
                  aria-label={isSelected ? "Deselect row" : "Select row"}
                  checked={isSelected}
                  onChange={() => toggleRow(recordId)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <div className="card-list__primary-cell">
                {primaryColumn ? renderField(primaryColumn, record) : recordId}
              </div>
              {renderRowActions ? (
                <div className="card-list__actions" onClick={(e) => e.stopPropagation()}>
                  {renderRowActions(record)}
                </div>
              ) : interactive ? (
                <ChevronRight className="card-list__chevron" size={16} aria-hidden />
              ) : null}
            </div>
            {detailColumns.length > 0 && (
              <div className="card-list__details">
                {detailColumns.map((column) => (
                  <div key={column.viewFieldId} className="card-list__detail">
                    <span className="card-list__detail-label">{column.field.label}</span>
                    <span className="card-list__detail-value">{renderField(column, record)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
