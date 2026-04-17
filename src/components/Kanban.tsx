import { ReactNode, useState } from "react";

export type KanbanColumn<T> = {
  id: string;
  label: string;
  accent?: string;
  items: T[];
};

export function Kanban<T extends { _id: string; status: string }>({
  columns,
  renderCard,
  onMove,
}: {
  columns: KanbanColumn<T>[];
  renderCard: (item: T) => ReactNode;
  onMove: (itemId: string, toStatus: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  return (
    <div className="kanban">
      {columns.map((col) => (
        <div className="kanban__col" key={col.id}>
          <div className="kanban__head">
            {col.accent && <span className="dot" style={{ color: col.accent }} />}
            {col.label}
            <span className="tab__count" style={{ marginLeft: "auto" }}>{col.items.length}</span>
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
              if (dragId) onMove(dragId, col.id);
              setDragId(null);
              setOverCol(null);
            }}
          >
            {col.items.map((item) => (
              <div
                key={item._id}
                className={`kanban__card${dragId === item._id ? " is-dragging" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(item._id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverCol(null);
                }}
              >
                {renderCard(item)}
              </div>
            ))}
            {col.items.length === 0 && (
              <div className="empty-state empty-state--sm">
                Drop here
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
