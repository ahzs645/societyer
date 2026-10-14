import { ChevronRight } from "lucide-react";
import { FIELD_TYPES, type RecordField } from "../../types";
import { FieldDisplay } from "../../record-field/components/FieldDisplay";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableColumns } from "../hooks/useRecordTableColumns";
import { useRecordTableRowModel } from "../hooks/useRecordTableRowModel";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { columnWidthStyle } from "../utils/columnWidth";
import {
  aggregateNumericValue,
  formatAggregateNumber,
  groupAggregateOperation,
} from "../utils/aggregateOperations";
import type { RecordGroup } from "../utils/groupRecords";

const OPERATION_LABEL: Record<string, string> = { sum: "Total", avg: "Average", min: "Minimum", max: "Maximum" };

/** The group's value the way the column shows it (select chip, relation chip, yes/no), or plain text. */
function GroupValue({ group, column }: { group: RecordGroup; column: RecordField | null }) {
  if (group.isEmpty || !column) {
    return <span className="record-table__group-label record-table__group-label--empty">{group.label}</span>;
  }
  const type = column.field.fieldType;
  const usesFieldDisplay =
    type === FIELD_TYPES.SELECT ||
    type === FIELD_TYPES.MULTI_SELECT ||
    type === FIELD_TYPES.RELATION ||
    type === FIELD_TYPES.BOOLEAN ||
    type === FIELD_TYPES.CURRENCY;
  if (!usesFieldDisplay) return <span className="record-table__group-label">{group.label}</span>;
  return (
    <span className="record-table__group-label">
      <FieldDisplay field={column.field} value={group.value} record={group.records[0]} />
    </span>
  );
}

/**
 * Header row for one group: fold toggle, the group's value, its record count
 * and, under each amount/number column, the group's total (or the footer's
 * chosen numeric aggregate). Sticks under the column header while its rows
 * scroll past.
 */
export function RecordTableGroupRowCells({
  group,
  collapsed,
  selectable,
  showDragHandle,
  hasRowActions,
}: {
  group: RecordGroup;
  collapsed: boolean;
  selectable: boolean;
  showDragHandle: boolean;
  hasRowActions: boolean;
}) {
  const { objectMetadata } = useRecordTableContextOrThrow();
  const { columns, collapsed: collapsedColumns } = useRecordTableColumns(objectMetadata.labelIdentifierFieldName);
  const { groupColumn } = useRecordTableRowModel();
  const handle = useRecordTableStoreHandle();
  const groupIds = group.records.map((record) => String(record._id));
  const selectedCount = useRecordTableState((state) =>
    selectable ? groupIds.reduce((count, id) => count + (state.selectedRecordIds.has(id) ? 1 : 0), 0) : 0,
  );

  // The label spans the leading columns that carry no aggregate, so long
  // values have room instead of truncating in the first column.
  const aggregateIndex = columns.findIndex((column) => groupAggregateOperation(column) !== null);
  const span = Math.max(1, aggregateIndex < 0 ? columns.length : aggregateIndex);
  const spanned = columns.slice(0, span);
  const rest = columns.slice(span);
  const toggle = () => handle.get().toggleGroupCollapsed(group.key);
  const count = group.records.length;
  const allSelected = selectable && selectedCount === count && count > 0;

  return (
    <>
      {showDragHandle && <td className="record-table__group-cell record-table__drag-cell" aria-hidden="true" />}
      {selectable && (
        <td className="record-table__group-cell record-table__checkbox-cell">
          <input
            type="checkbox"
            aria-label={allSelected ? `Deselect ${group.label}` : `Select all in ${group.label}`}
            checked={allSelected}
            ref={(element) => {
              if (element) element.indeterminate = selectedCount > 0 && !allSelected;
            }}
            onChange={() => {
              const next = new Set(handle.get().selectedRecordIds);
              if (allSelected) groupIds.forEach((id) => next.delete(id));
              else groupIds.forEach((id) => next.add(id));
              handle.get().setSelectedRecordIds(next);
              handle.get().setSelectionAnchorRowIndex(null);
            }}
          />
        </td>
      )}
      <td
        className="record-table__group-cell record-table__group-cell--label"
        colSpan={spanned.length}
        style={columnWidthStyle(spanned.reduce((sum, column) => sum + (collapsedColumns.has(column.viewFieldId) ? 0 : column.size), 0))}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a, input")) return;
          toggle();
        }}
      >
        <span className="record-table__group-heading">
          <button
            type="button"
            className="record-table__group-toggle"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.label}`}
            title={collapsed ? "Expand group" : "Collapse group"}
            onClick={toggle}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <GroupValue group={group} column={groupColumn} />
          <span className="record-table__group-count" aria-label={`${count} ${count === 1 ? "record" : "records"}`}>
            {count}
          </span>
        </span>
      </td>
      {rest.map((column) => {
        const isCollapsed = collapsedColumns.has(column.viewFieldId);
        const operation = groupAggregateOperation(column);
        const value = operation ? aggregateNumericValue({ column, records: group.records, operation }) : null;
        return (
          <td
            key={column.viewFieldId}
            className={
              "record-table__group-cell" +
              (operation ? " record-table__group-cell--aggregate" : "") +
              (isCollapsed ? " record-table__group-cell--collapsed" : "")
            }
            style={columnWidthStyle(isCollapsed ? 0 : column.size)}
            aria-hidden={isCollapsed || undefined}
          >
            {operation && value !== null ? (
              <span title={`${OPERATION_LABEL[operation] ?? operation} of ${column.field.label}`}>
                {formatAggregateNumber(column, value)}
              </span>
            ) : null}
          </td>
        );
      })}
      {hasRowActions && <td className="record-table__group-cell record-table__row-actions-cell" aria-hidden="true" />}
      <td className="record-table__group-cell record-table__fill-cell" aria-hidden="true" />
    </>
  );
}
