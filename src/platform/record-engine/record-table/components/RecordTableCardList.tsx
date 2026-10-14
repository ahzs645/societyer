import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useRecordTableRowModel } from "../hooks/useRecordTableRowModel";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { RecordTableEmpty } from "./RecordTableEmpty";

/**
 * Phone body for a register whose records read better as cards than as a
 * frozen-column table. It walks the same row model as the table — the
 * toolbar's search, filters, sort and group-by all apply — and puts each
 * group's header (with its count, tap to fold) between the cards.
 */
export function RecordTableCardList({
  renderCard,
  emptyState,
  label,
}: {
  renderCard: (record: any) => ReactNode;
  emptyState?: ReactNode;
  /** Accessible name for the list, e.g. "Assets". */
  label: string;
}) {
  const model = useRecordTableRowModel();
  const handle = useRecordTableStoreHandle();
  const hasRecords = useRecordTableState((s) => s.records.length > 0);

  if (model.ordered.length === 0) {
    return hasRecords
      ? <RecordTableEmpty variant="filtered" title="No matches" description="Nothing matches the current search or filters." />
      : <>{emptyState ?? <RecordTableEmpty />}</>;
  }

  return (
    <div className="record-cards" role="list" aria-label={label}>
      {model.items.map((item) =>
        item.kind === "group" ? (
          <div key={item.key} className="record-cards__group" role="listitem">
            <button
              type="button"
              className="record-cards__group-toggle"
              aria-expanded={!item.collapsed}
              onClick={() => handle.get().toggleGroupCollapsed(item.group.key)}
            >
              <ChevronRight size={14} aria-hidden="true" className="record-cards__chevron" />
              <span className="record-cards__group-label">{item.group.isEmpty ? "No value" : item.group.label}</span>
              <span className="record-cards__group-count">{item.group.records.length}</span>
            </button>
          </div>
        ) : (
          <div key={item.key} className="record-cards__item" role="listitem">
            {renderCard(item.record)}
          </div>
        ),
      )}
    </div>
  );
}
