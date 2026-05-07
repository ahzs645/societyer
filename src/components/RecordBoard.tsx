import { ReactNode, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ToneVariant } from "./ui";

export type RecordBoardColumn = {
  id: string;
  label: string;
  /** Colored dot on the column header. */
  tone?: ToneVariant;
  /** Override the item count shown on the header; defaults to grouped length. */
  count?: number;
};

/** Generic drag-and-drop board. Works with any enum-status-ish record:
 * pass columns, items, a getColumnId to group, and onMove to persist changes. */
export function RecordBoard<T>({
  columns,
  items,
  getItemId,
  getColumnId,
  renderCard,
  onMove,
  onItemClick,
  onItemContextMenu,
  emptyLabel = "Drop here",
}: {
  columns: RecordBoardColumn[];
  items: T[];
  getItemId: (item: T) => string;
  getColumnId: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onMove: (item: T, toColumnId: string) => void;
  onItemClick?: (item: T) => void;
  /** Right-click on a card. Receive the item plus the original event so the
   * caller can position a portal'd menu at the click coordinates. */
  onItemContextMenu?: (item: T, event: ReactMouseEvent<HTMLDivElement>) => void;
  emptyLabel?: string;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const grouped = new Map<string, T[]>();
  for (const col of columns) grouped.set(col.id, []);
  for (const item of items) {
    const colId = getColumnId(item);
    const list = grouped.get(colId) ?? [];
    list.push(item);
    grouped.set(colId, list);
  }

  return (
    <div className="kanban">
      {columns.map((col) => {
        const colItems = grouped.get(col.id) ?? [];
        return (
          <div className="kanban__col" key={col.id}>
            <div className="kanban__head">
              {col.tone && <span className={`dot dot--${col.tone}`} aria-hidden="true" />}
              {col.label}
              <span className="tab__count" style={{ marginLeft: "auto" }}>
                {col.count ?? colItems.length}
              </span>
            </div>
            <div
              className={`kanban__body${overCol === col.id ? " is-dragging-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.id);
              }}
              onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) {
                  const found = items.find((i) => getItemId(i) === dragId);
                  if (found) onMove(found, col.id);
                }
                setDragId(null);
                setOverCol(null);
              }}
            >
              {colItems.map((item) => {
                const id = getItemId(item);
                return (
                  <div
                    key={id}
                    className={`kanban__card${dragId === id ? " is-dragging" : ""}${onItemClick ? " is-clickable" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverCol(null);
                    }}
                    onClick={(e) => {
                      if (!onItemClick) return;
                      // Don't fire on text selection drags inside the card.
                      if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
                      onItemClick(item);
                    }}
                    onContextMenu={
                      onItemContextMenu
                        ? (e) => {
                            e.preventDefault();
                            onItemContextMenu(item, e);
                          }
                        : undefined
                    }
                    role={onItemClick ? "button" : undefined}
                    tabIndex={onItemClick ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (!onItemClick) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onItemClick(item);
                      }
                    }}
                  >
                    {renderCard(item)}
                  </div>
                );
              })}
              {colItems.length === 0 && (
                <div className="empty-state empty-state--sm">{emptyLabel}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
