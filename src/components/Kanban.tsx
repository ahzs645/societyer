import { ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { RecordBoard } from "./RecordBoard";

export type KanbanColumn<T> = {
  id: string;
  label: string;
  accent?: string;
  items: T[];
};

/** Backwards-compatible wrapper around the generalized RecordBoard.
 * Prefer importing RecordBoard directly for new uses. */
export function Kanban<T extends { _id: string; status: string }>({
  columns,
  renderCard,
  onMove,
  onItemClick,
  onItemContextMenu,
}: {
  columns: KanbanColumn<T>[];
  renderCard: (item: T) => ReactNode;
  onMove: (itemId: string, toStatus: string) => void;
  onItemClick?: (item: T) => void;
  onItemContextMenu?: (item: T, event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const flat = columns.flatMap((col) => col.items.map((item) => ({ col: col.id, item })));
  return (
    <RecordBoard<{ col: string; item: T }>
      columns={columns.map((col) => ({ id: col.id, label: col.label, count: col.items.length }))}
      items={flat}
      getItemId={(row) => row.item._id}
      getColumnId={(row) => row.col}
      renderCard={(row) => renderCard(row.item)}
      onMove={(row, toColumnId) => onMove(row.item._id, toColumnId)}
      onItemClick={onItemClick ? (row) => onItemClick(row.item) : undefined}
      onItemContextMenu={onItemContextMenu ? (row, event) => onItemContextMenu(row.item, event) : undefined}
    />
  );
}
