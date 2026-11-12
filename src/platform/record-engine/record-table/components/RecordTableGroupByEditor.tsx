import { useMemo } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Select } from "@/components/Select";
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
 * The group-by settings (field, date bucket size, group order, fold all /
 * unfold all): the first section of the toolbar's Options popover and of
 * the phone "View options" sheet. The choice is part of the view (Save /
 * Discard apply); folding is per person and never marks the view as changed.
 */
export function RecordTableGroupByEditor() {
  const columns = useRecordTableState((s) => s.columns);
  const viewGroups = useRecordTableState((s) => s.viewGroups);
  const collapsedCount = useRecordTableState((s) => s.collapsedGroupKeys.size);
  const handle = useRecordTableStoreHandle();
  const { groups } = useRecordTableRowModel();
  const groupBy = getViewGroupBy(viewGroups);
  const groupable = useMemo(() => columns.filter(isGroupableField), [columns]);
  const column = groupBy ? columns.find((entry) => entry.fieldMetadataId === groupBy.fieldMetadataId) : undefined;
  const orders = orderOptions(column, columns);

  const setGroupBy = (next: ViewGroupBy | null) => {
    handle.get().setViewGroups(withViewGroupBy(handle.get().viewGroups, next));
  };

  return (
    <>
      <div className="record-table__menu-section">
        <span className="record-table__menu-label">Group by</span>
        <Select
          size="sm"
          aria-label="Group by"
          value={groupBy?.fieldMetadataId ?? ""}
          onChange={(fieldMetadataId) => {
            const next = columns.find((entry) => entry.fieldMetadataId === fieldMetadataId);
            handle.get().setCollapsedGroupKeys(new Set());
            setGroupBy(next ? defaultGroupBy(next) : null);
          }}
          searchable={groupable.length > 8}
          options={[
            { value: "", label: "No grouping" },
            ...groupable.map((entry) => ({ value: entry.fieldMetadataId, label: entry.field.label })),
          ]}
        />
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
          <span className="record-table__menu-label">Order groups</span>
          <Select
            size="sm"
            aria-label="Order groups"
            value={orderValue(groupBy)}
            onChange={(value) => {
              const [sort, direction, sumFieldMetadataId] = value.split(":");
              setGroupBy({
                ...groupBy,
                sort: sort as ViewGroupBy["sort"],
                direction: direction === "desc" ? "desc" : "asc",
                sumFieldMetadataId: sumFieldMetadataId || undefined,
              });
            }}
            options={orders}
          />
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
    </>
  );
}
