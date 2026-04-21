import { useRef } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { RecordField } from "../../types";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";

/**
 * One header cell. Click = cycle sort (asc → desc → off). Drag the right
 * edge to resize. Uses the per-instance store so multiple tables don't
 * share sort state.
 */
export function RecordTableHeaderCell({
  recordField,
}: {
  recordField: RecordField;
}) {
  const sorts = useRecordTableState((s) => s.sorts);
  const handle = useRecordTableStoreHandle();
  const resizing = useRef<{ startX: number; startSize: number } | null>(null);

  const sort = sorts.find((s) => s.fieldMetadataId === recordField.fieldMetadataId);

  const cycleSort = () => {
    const next = handle.get().sorts.filter(
      (s) => s.fieldMetadataId !== recordField.fieldMetadataId,
    );
    if (!sort) {
      next.unshift({ fieldMetadataId: recordField.fieldMetadataId, direction: "asc" });
    } else if (sort.direction === "asc") {
      next.unshift({ fieldMetadataId: recordField.fieldMetadataId, direction: "desc" });
    }
    handle.set({ sorts: next });
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { startX: e.clientX, startSize: recordField.size };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = ev.clientX - resizing.current.startX;
      const next = Math.max(80, resizing.current.startSize + delta);
      handle.get().resizeColumn(recordField.viewFieldId, next);
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <th
      className="record-table__header-cell"
      style={{ width: recordField.size, minWidth: recordField.size }}
      aria-sort={sort ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        className="record-table__header-cell-button"
        onClick={cycleSort}
        type="button"
      >
        <span className="record-table__header-cell-label">{recordField.field.label}</span>
        {sort?.direction === "asc" && <ArrowUp size={11} />}
        {sort?.direction === "desc" && <ArrowDown size={11} />}
      </button>
      <span
        className="record-table__resize-handle"
        onMouseDown={onResizeMouseDown}
        aria-label="Resize column"
        role="separator"
        tabIndex={-1}
      />
    </th>
  );
}
