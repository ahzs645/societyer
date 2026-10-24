import { ReactNode, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowRightLeft } from "lucide-react";
import { Menu } from "./Menu";
import type { ToneVariant } from "./ui";

export type RecordBoardColumn = {
  id: string;
  label: string;
  /** Colored dot on the column header. */
  tone?: ToneVariant;
  /** Override the item count shown on the header; defaults to grouped length. */
  count?: number;
};

type RecordBoardProps<T> = {
  columns: RecordBoardColumn[];
  items: T[];
  getItemId: (item: T) => string;
  getColumnId: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onMove: (item: T, toColumnId: string) => void;
  /** Disable every move affordance when the caller cannot persist a move. */
  canMove?: boolean;
  /** Keep derived or locked records readable while other cards remain movable. */
  canMoveItem?: (item: T) => boolean;
  onItemClick?: (item: T) => void;
  /** Right-click on a card. Receive the item plus the original event so the
   * caller can position a portal'd menu at the click coordinates. */
  onItemContextMenu?: (item: T, event: ReactMouseEvent<HTMLDivElement>) => void;
  emptyLabel?: string;
  /**
   * Items whose column id matches no column (an empty value, a retired
   * option) are shown in an extra column with this label rather than
   * dropped from the board. Cards can move out of it but not into it.
   */
  unassignedLabel?: string;
};

const UNASSIGNED_COLUMN_ID = "__record-board-unassigned__";

function groupBoardItems<T>(
  columns: RecordBoardColumn[],
  items: T[],
  getColumnId: (item: T) => string,
) {
  const grouped = new Map<string, T[]>(columns.map((column) => [column.id, []]));
  const unassigned: T[] = [];
  for (const item of items) {
    const bucket = grouped.get(getColumnId(item));
    if (bucket) bucket.push(item);
    else unassigned.push(item);
  }
  grouped.set(UNASSIGNED_COLUMN_ID, unassigned);
  return grouped;
}

/** Generic drag-and-drop board. Works with any enum-status-ish record:
 * pass columns, items, a getColumnId to group, and onMove to persist changes. */
export function RecordBoard<T>({
  columns,
  items,
  getItemId,
  getColumnId,
  renderCard,
  onMove,
  canMove = true,
  canMoveItem,
  onItemClick,
  onItemContextMenu,
  emptyLabel,
  unassignedLabel = "Other",
}: RecordBoardProps<T>) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const grouped = groupBoardItems(columns, items, getColumnId);
  const unassignedCount = grouped.get(UNASSIGNED_COLUMN_ID)?.length ?? 0;
  const shownColumns: RecordBoardColumn[] = unassignedCount > 0
    ? [...columns, { id: UNASSIGNED_COLUMN_ID, label: unassignedLabel, tone: "gray" }]
    : columns;

  return (
    <div className="kanban">
      {shownColumns.map((col) => {
        const colItems = grouped.get(col.id) ?? [];
        const acceptsDrop = canMove && col.id !== UNASSIGNED_COLUMN_ID;
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
              onDragOver={
                acceptsDrop
                  ? (e) => {
                      e.preventDefault();
                      setOverCol(col.id);
                    }
                  : undefined
              }
              onDragLeave={
                acceptsDrop
                  ? () => setOverCol((current) => (current === col.id ? null : current))
                  : undefined
              }
              onDrop={
                acceptsDrop
                  ? (e) => {
                      e.preventDefault();
                      if (dragId) {
                        const found = items.find((item) => getItemId(item) === dragId);
                        if (found && (!canMoveItem || canMoveItem(found))) onMove(found, col.id);
                      }
                      setDragId(null);
                      setOverCol(null);
                    }
                  : undefined
              }
            >
              {colItems.map((item) => {
                const id = getItemId(item);
                const movable = canMove && (!canMoveItem || canMoveItem(item));
                return (
                  <div
                    key={id}
                    className={`kanban__card${movable ? " is-movable" : ""}${dragId === id ? " is-dragging" : ""}${onItemClick ? " is-clickable" : ""}`}
                    draggable={movable}
                    onDragStart={
                      movable
                        ? (e) => {
                            e.dataTransfer.effectAllowed = "move";
                            setDragId(id);
                          }
                        : undefined
                    }
                    onDragEnd={
                      movable
                        ? () => {
                            setDragId(null);
                            setOverCol(null);
                          }
                        : undefined
                    }
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
                    {/* Touch can't drag cards between columns, so each card
                      * gets a move-menu trigger (bottom sheet on phones via
                      * Menu). CSS shows it only on coarse-pointer devices —
                      * desktop keeps drag-and-drop with no extra chrome. */}
                    {movable && (
                      <Menu
                        trigger={
                          <button
                            type="button"
                            className="kanban__card-move"
                            aria-label="Move to column"
                          >
                            <ArrowRightLeft size={14} />
                          </button>
                        }
                        align="right"
                        sections={[
                          {
                            id: "move",
                            label: "Move to",
                            items: columns.map((column) => ({
                              id: column.id,
                              label: column.label,
                              disabled: column.id === col.id,
                              onSelect: () => onMove(item, column.id),
                            })),
                          },
                        ]}
                      />
                    )}
                  </div>
                );
              })}
              {colItems.length === 0 && (
                <div className="empty-state empty-state--sm">
                  {emptyLabel ?? (canMove ? "Drop here" : "No records")}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
