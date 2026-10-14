import { useMemo, type RefObject } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { ViewportPopover } from "@/components/ViewportPopover";
import { FIELD_TYPES, type RecordField, type ViewGroupBy, type ViewGroupDateGranularity } from "../../types";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useRecordTableRowModel } from "../hooks/useRecordTableRowModel";
import {
  defaultGroupBy,
  getViewGroupBy,
  hasFieldOrder,
  isDateGroupField,
  isGroupableField,
  withViewGroupBy,
} from "../utils/groupRecords";
import { isNumericFieldType } from "../utils/filterValues";

const GRANULARITIES: { id: ViewGroupDateGranularity; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
];

type OrderOption = { value: string; label: string };

function orderValue(groupBy: ViewGroupBy) {
  return `${groupBy.sort ?? "label"}:${groupBy.direction ?? "asc"}:${groupBy.sumFieldMetadataId ?? ""}`;
}

function orderOptions(column: RecordField | undefined, columns: RecordField[]): OrderOption[] {
  if (!column) return [];
  const options: OrderOption[] = [];
  if (hasFieldOrder(column)) options.push({ value: "field:asc:", label: "Field order" });
  if (isDateGroupField(column)) {
    options.push({ value: "label:desc:", label: "Newest first" }, { value: "label:asc:", label: "Oldest first" });
  } else if (isNumericFieldType(column.field.fieldType)) {
    options.push({ value: "label:asc:", label: "Smallest first" }, { value: "label:desc:", label: "Largest first" });
  } else {
    options.push({ value: "label:asc:", label: "Alphabetical (A–Z)" }, { value: "label:desc:", label: "Alphabetical (Z–A)" });
  }
  options.push({ value: "count:desc:", label: "Most records first" }, { value: "count:asc:", label: "Fewest records first" });
  for (const amount of columns.filter((entry) => entry.field.fieldType === FIELD_TYPES.CURRENCY)) {
    options.push(
      { value: `sum:desc:${amount.fieldMetadataId}`, label: `Highest ${amount.field.label.toLowerCase()} total` },
      { value: `sum:asc:${amount.fieldMetadataId}`, label: `Lowest ${amount.field.label.toLowerCase()} total` },
    );
  }
  return options;
}

/**
 * "Group by" settings: the field, date bucket size, group order, and fold
 * all / unfold all. The choice is part of the view (Save / Discard apply);
 * folding is per person and never marks the view as changed.
 */
export function RecordTableGroupByPopover({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const columns = useRecordTableState((s) => s.columns);
  const viewGroups = useRecordTableState((s) => s.viewGroups);
  const collapsedCount = useRecordTableState((s) => s.collapsedGroupKeys.size);
  const handle = useRecordTableStoreHandle();
  const { groups } = useRecordTableRowModel();
  const groupBy = getViewGroupBy(viewGroups);
  const groupable = useMemo(() => columns.filter(isGroupableField), [columns]);
  const column = groupBy ? columns.find((entry) => entry.fieldMetadataId === groupBy.fieldMetadataId) : undefined;
  const orders = orderOptions(column, columns);

  if (!open) return null;

  const setGroupBy = (next: ViewGroupBy | null) => {
    handle.get().setViewGroups(withViewGroupBy(handle.get().viewGroups, next));
  };

  return (
    <ViewportPopover open onClose={onClose} anchorRef={anchorRef} label="Group records" className="record-table__menu record-table__menu--right record-table__group-popover">
      <div className="record-table__menu-section">
        <label className="record-table__menu-label" htmlFor="record-table-group-field">
          Group by
        </label>
        <select
          id="record-table-group-field"
          className="record-table__menu-select"
          value={groupBy?.fieldMetadataId ?? ""}
          onChange={(event) => {
            const next = columns.find((entry) => entry.fieldMetadataId === event.target.value);
            handle.get().setCollapsedGroupKeys(new Set());
            setGroupBy(next ? defaultGroupBy(next) : null);
          }}
        >
          <option value="">No grouping</option>
          {groupable.map((entry) => (
            <option key={entry.fieldMetadataId} value={entry.fieldMetadataId}>
              {entry.field.label}
            </option>
          ))}
        </select>
      </div>

      {groupBy && column && isDateGroupField(column) && (
        <div className="record-table__menu-section">
          <span className="record-table__menu-label" id="record-table-group-granularity">Group dates by</span>
          <div className="record-table__density-options" role="radiogroup" aria-labelledby="record-table-group-granularity">
            {GRANULARITIES.map((granularity) => (
              <button
                key={granularity.id}
                type="button"
                role="radio"
                aria-checked={(groupBy.dateGranularity ?? "month") === granularity.id}
                className={(groupBy.dateGranularity ?? "month") === granularity.id ? "is-active" : ""}
                onClick={() => setGroupBy({ ...groupBy, dateGranularity: granularity.id })}
              >
                {granularity.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {groupBy && column && (
        <div className="record-table__menu-section">
          <label className="record-table__menu-label" htmlFor="record-table-group-order">
            Order groups
          </label>
          <select
            id="record-table-group-order"
            className="record-table__menu-select"
            value={orderValue(groupBy)}
            onChange={(event) => {
              const [sort, direction, sumFieldMetadataId] = event.target.value.split(":");
              setGroupBy({
                ...groupBy,
                sort: sort as ViewGroupBy["sort"],
                direction: direction === "desc" ? "desc" : "asc",
                sumFieldMetadataId: sumFieldMetadataId || undefined,
              });
            }}
          >
            {orders.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="record-table__menu-hint">“No value” is always listed last.</p>
        </div>
      )}

      {groupBy && groups && groups.length > 0 && (
        <div className="record-table__menu-section record-table__menu-actions">
          <button
            type="button"
            className="record-table__menu-action"
            disabled={collapsedCount >= groups.length}
            onClick={() => handle.get().setCollapsedGroupKeys(new Set(groups.map((group) => group.key)))}
          >
            <ChevronsDownUp size={13} aria-hidden="true" /> Collapse all
          </button>
          <button
            type="button"
            className="record-table__menu-action"
            disabled={collapsedCount === 0}
            onClick={() => handle.get().setCollapsedGroupKeys(new Set())}
          >
            <ChevronsUpDown size={13} aria-hidden="true" /> Expand all
          </button>
        </div>
      )}
    </ViewportPopover>
  );
}
