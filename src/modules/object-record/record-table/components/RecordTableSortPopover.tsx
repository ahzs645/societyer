import { ArrowDownAZ, ArrowUpAZ, Plus, Trash2 } from "lucide-react";
import { Select } from "@/components/Select";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import type { ViewSortDirection } from "../../types";

export function RecordTableSortPopover({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const columns = useRecordTableState((state) => state.columns);
  const sorts = useRecordTableState((state) => state.sorts);
  const handle = useRecordTableStoreHandle();

  if (!open) return null;

  const setSorts = (next: typeof sorts) => handle.get().setSorts(next);
  const addSort = () => {
    const firstUnused = columns.find(
      (column) => !sorts.some((sort) => sort.fieldMetadataId === column.fieldMetadataId),
    );
    if (!firstUnused) return;
    setSorts([...sorts, { fieldMetadataId: firstUnused.fieldMetadataId, direction: "asc" }]);
  };

  return (
    <div className="record-table__sort-popover">
      <div className="record-table__popover-head">
        <strong>Sort records</strong>
        <button type="button" className="record-table__secondary-btn" onClick={onClose}>
          Done
        </button>
      </div>
      {sorts.length === 0 ? (
        <div className="record-table__popover-empty">No sort rules.</div>
      ) : (
        <div className="record-table__sort-list">
          {sorts.map((sort, index) => (
            <div key={`${sort.fieldMetadataId}-${index}`} className="record-table__sort-row">
              <Select
                size="sm"
                value={sort.fieldMetadataId}
                onChange={(fieldMetadataId) => {
                  const next = [...sorts];
                  next[index] = { ...sort, fieldMetadataId };
                  setSorts(next);
                }}
                options={columns.map((column) => ({
                  value: column.fieldMetadataId,
                  label: column.field.label,
                }))}
                searchable={columns.length > 6}
              />
              <button
                type="button"
                className="record-table__toolbar-button"
                onClick={() => {
                  const direction: ViewSortDirection = sort.direction === "asc" ? "desc" : "asc";
                  const next = [...sorts];
                  next[index] = { ...sort, direction };
                  setSorts(next);
                }}
              >
                {sort.direction === "asc" ? <ArrowUpAZ size={12} /> : <ArrowDownAZ size={12} />}
                <span>{sort.direction === "asc" ? "Ascending" : "Descending"}</span>
              </button>
              <button
                type="button"
                className="record-table__icon-btn"
                aria-label="Remove sort"
                onClick={() => setSorts(sorts.filter((_, i) => i !== index))}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="record-table__toolbar-button"
        disabled={sorts.length >= columns.length}
        onClick={addSort}
      >
        <Plus size={12} />
        <span>Add sort</span>
      </button>
    </div>
  );
}
