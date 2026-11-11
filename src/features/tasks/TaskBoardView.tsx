/**
 * Task board: one column per status (or priority), cards that carry the
 * task's link, checklist progress, priority, due date and owner, drag to
 * move between columns, and a composer at the foot of each column.
 *
 * Cards keep a manual order shared by the workspace (`position`, see
 * shared/taskPosition.ts): drag within a column, Alt+↑/↓ on a focused card,
 * or "Move to top" / "Move to bottom" in the card menu (phones have no drag).
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Check, ChevronsLeftRight, Plus } from "lucide-react";
import { useFilteredRecords } from "@/platform/record-engine";
import { TaskQuickAdd } from "./TaskQuickAdd";
import { TaskAvatar, TaskChecklistBadge, TaskLinkChip, TaskPriorityIcon, TaskStatusIcon } from "./TaskVisuals";
import { TaskDueMenu, TaskMoreMenu, TaskPriorityMenu, type TaskOrderMenu, type TaskViewActions } from "./TaskMenus";
import { TaskRepeatBadge } from "./TaskRepeat";
import { groupTasks, isClosedStatus, taskOwnerName, taskPrimaryLink, type TaskGroup, type TaskRecord } from "./taskModel";
import { TaskParentHint, TaskSubtaskBadge } from "./TaskSubtasks";
import { planTaskMove, sortByPosition } from "../../../shared/taskPosition";
import { Tooltip } from "../../components/Tooltip";

export function TaskBoardView({ by, actions }: { by: "status" | "priority"; actions: TaskViewActions }) {
  const records = useFilteredRecords() as TaskRecord[];
  const columns = useMemo(() => groupTasks(records, by).map((column) => ({ ...column, tasks: sortByPosition(column.tasks) })), [records, by]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  // Where a dragged card would land: a column and a place in it as shown (0 = top).
  const [dropAt, setDropAt] = useState<{ column: string; index: number } | null>(null);
  const { announcement, canReorder, place, orderMenu, onCardKeyDown } = useBoardOrder(columns, actions);
  const dragFrom = dragId ? columns.find((column) => column.tasks.some((entry) => String(entry._id) === dragId))?.key ?? null : null;

  return (
    <>
    <div className="kanban task-board" role="list" aria-label="Task board">
      {columns.map((column) => {
        const isCollapsed = collapsed[`${by}:${column.key}`] ?? false;
        const canDrop = actions.canManage && column.defaults !== null;
        const toggle = () => setCollapsed((current) => ({ ...current, [`${by}:${column.key}`]: !isCollapsed }));
        if (isCollapsed) {
          return (
            <button key={column.key} type="button" role="listitem" className="task-board__col task-board__col--collapsed" onClick={toggle} aria-label={`Expand ${column.label} (${column.tasks.length})`}>
              <ColumnIcon column={column} />
              <span className="task-board__col-count">{column.tasks.length}</span>
              <span className="task-board__col-vertical">{column.label}</span>
            </button>
          );
        }
        // Within its own column a card can always be reordered; across columns it needs the column's value.
        const acceptsDrag = dragFrom === column.key ? canReorder : canDrop;
        const onDragOver = (event: DragEvent) => {
          if (!acceptsDrag || !dragId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (overColumn !== column.key) setOverColumn(column.key);
          // Entering a column away from any card aims at its end; gaps between cards keep the last aim.
          const overCard = event.target instanceof Element && event.target.closest(".task-card");
          if (!overCard && dropAt?.column !== column.key) setDropAt({ column: column.key, index: column.tasks.length });
        };
        const onCardDragOver = (event: DragEvent, index: number) => {
          if (!acceptsDrag || !dragId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const shown = event.clientY > rect.top + rect.height / 2 ? index + 1 : index;
          if (dropAt?.column !== column.key || dropAt.index !== shown) setDropAt({ column: column.key, index: shown });
        };
        const onDrop = (event: DragEvent) => {
          event.preventDefault();
          const id = event.dataTransfer.getData("text/task-id") || dragId;
          const task = records.find((record) => String(record._id) === id);
          const index = dropAt?.column === column.key ? dropAt.index : column.tasks.length;
          setDragId(null);
          setOverColumn(null);
          setDropAt(null);
          if (task) place(task, column, index);
        };
        const aim = dragId && dropAt?.column === column.key ? dropAt.index : null;
        return (
          <section
            key={column.key}
            role="listitem"
            className={`kanban__col task-board__col${overColumn === column.key ? " is-drop-target" : ""}`}
            aria-label={`${column.label}, ${column.tasks.length} task${column.tasks.length === 1 ? "" : "s"}`}
            onDragOver={onDragOver}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setOverColumn((current) => (current === column.key ? null : current));
                setDropAt((current) => (current?.column === column.key ? null : current));
              }
            }}
            onDrop={onDrop}
          >
            <header className="task-board__head">
              <ColumnIcon column={column} />
              <span className="task-board__col-label">{column.label}</span>
              <span className="task-board__col-count">{column.tasks.length}</span>
              <span className="task-board__head-actions">
                {actions.canManage && column.defaults && (
                  <Tooltip content="Add task">
                    <button type="button" className="task-icon-button" aria-label={`Add task to ${column.label}`} onClick={() => setComposerFor(column.key)}>
                      <Plus size={14} />
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="Collapse column">
                  <button type="button" className="task-icon-button" aria-label={`Collapse ${column.label}`} onClick={toggle}>
                    <ChevronsLeftRight size={13} />
                  </button>
                </Tooltip>
              </span>
            </header>
            <div className="kanban__body task-board__body">
              {column.tasks.map((task, index) => (
                <TaskCard
                  key={task._id}
                  task={task}
                  actions={actions}
                  dragging={dragId === String(task._id)}
                  dropMark={aim === index ? "before" : aim === column.tasks.length && index === column.tasks.length - 1 ? "after" : null}
                  order={orderMenu(task, column)}
                  reorderKeys={canReorder}
                  onKeyDown={(event) => onCardKeyDown(event, task, column)}
                  onDragOver={(event) => onCardDragOver(event, index)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/task-id", String(task._id));
                    event.dataTransfer.effectAllowed = "move";
                    setDragId(String(task._id));
                  }}
                  onDragEnd={() => { setDragId(null); setOverColumn(null); setDropAt(null); }}
                />
              ))}
              {column.tasks.length === 0 && composerFor !== column.key && <div className="task-board__empty">{canDrop ? "Drop tasks here" : "Nothing here"}</div>}
              {actions.canManage && column.defaults && (
                <TaskQuickAdd
                  variant="card"
                  open={composerFor === column.key}
                  onOpen={() => setComposerFor(column.key)}
                  onClose={() => setComposerFor((current) => (current === column.key ? null : current))}
                  onSubmit={(title) => actions.quickAdd(title, column.defaults ?? {})}
                />
              )}
            </div>
          </section>
        );
      })}
    </div>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </>
  );
}

/**
 * Manual order on the board: where a card lands (`place`), the card menu's
 * "Move to top" / "Move to bottom", Alt+↑/↓ on a focused card, and a polite
 * announcement of each move for screen readers.
 */
function useBoardOrder(columns: TaskGroup[], actions: TaskViewActions) {
  const [announcement, setAnnouncement] = useState("");
  // A keyboard move re-renders the card elsewhere; keep focus on it.
  const refocus = useRef<{ id: string; until: number } | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    if (Date.now() > target.until) { refocus.current = null; return; }
    const card = document.querySelector<HTMLElement>(`[data-task-card="${CSS.escape(target.id)}"]`);
    if (card && document.activeElement !== card) card.focus();
  }, [columns]);
  const canReorder = actions.canManage && Boolean(actions.reorder);
  const columnOf = (task: TaskRecord) => columns.find((column) => column.tasks.some((entry) => entry._id === task._id));

  const move = (task: TaskRecord, column: TaskGroup) => {
    if (!column.defaults) return;
    if (column.defaults.status && column.defaults.status !== task.status) void actions.setStatus(task, column.defaults.status);
    if (column.defaults.priority && column.defaults.priority !== task.priority) void actions.setPriority(task, column.defaults.priority);
  };

  /** Put `task` at `shownIndex` of `column` (an index among the cards as shown). */
  const place = (task: TaskRecord, column: TaskGroup, shownIndex: number) => {
    const from = columnOf(task);
    const crossing = from?.key !== column.key;
    if (crossing && !column.defaults) return;
    if (!actions.reorder || !actions.canManage) { if (crossing) move(task, column); return; }
    const current = column.tasks.findIndex((entry) => entry._id === task._id);
    const index = current !== -1 && shownIndex > current ? shownIndex - 1 : shownIndex;
    const writes = planTaskMove(column.tasks.map((entry) => ({ id: String(entry._id), position: entry.position })), String(task._id), index);
    const changes = !crossing || !column.defaults ? {}
      : column.defaults.status ? { status: column.defaults.status }
      : column.defaults.priority ? { priority: column.defaults.priority } : {};
    if (writes.length === 0 && !crossing) return;
    void actions.reorder(task, writes, changes);
    const count = column.tasks.length + (crossing ? 1 : 0);
    setAnnouncement(`${task.title} moved to place ${index + 1} of ${count} in ${column.label}.`);
  };
  const orderMenu = (task: TaskRecord, column: TaskGroup): TaskOrderMenu | undefined => {
    if (!canReorder) return undefined;
    const index = column.tasks.findIndex((entry) => entry._id === task._id);
    return {
      toTop: index > 0 ? () => place(task, column, 0) : undefined,
      toBottom: index < column.tasks.length - 1 ? () => place(task, column, column.tasks.length) : undefined,
    };
  };
  const onCardKeyDown = (event: KeyboardEvent, task: TaskRecord, column: TaskGroup) => {
    if (!canReorder || !event.altKey || event.target !== event.currentTarget) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const index = column.tasks.findIndex((entry) => entry._id === task._id);
    const target = event.key === "ArrowUp" ? index - 1 : index + 2;
    if (target < 0 || target > column.tasks.length) return;
    refocus.current = { id: String(task._id), until: Date.now() + 1500 };
    place(task, column, target);
  };

  return { announcement, canReorder, place, orderMenu, onCardKeyDown };
}

function ColumnIcon({ column }: { column: TaskGroup }) {
  return column.kind === "priority"
    ? <TaskPriorityIcon priority={column.key === "other" ? "" : column.key} />
    : <TaskStatusIcon status={column.key} />;
}

function TaskCard({
  task,
  actions,
  dragging,
  dropMark,
  order,
  reorderKeys,
  onKeyDown,
  onDragOver,
  onDragStart,
  onDragEnd,
}: {
  task: TaskRecord;
  actions: TaskViewActions;
  dragging: boolean;
  /** Where a dragged card would land relative to this one. */
  dropMark: "before" | "after" | null;
  order?: TaskOrderMenu;
  /** Alt+↑/↓ reorders the focused card. */
  reorderKeys: boolean;
  onKeyDown: (event: KeyboardEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const link = taskPrimaryLink(task);
  const owner = taskOwnerName(task);
  const closed = isClosedStatus(task.status);
  return (
    <article
      className={`kanban__card task-card${dragging ? " is-dragging" : ""}${closed ? " is-closed" : ""}${actions.canManage ? " is-movable" : ""}${dropMark ? ` is-drop-${dropMark}` : ""}`}
      draggable={actions.canManage}
      data-task-card={String(task._id)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      role="button"
      tabIndex={0}
      aria-label={task.title}
      aria-keyshortcuts={reorderKeys ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
      onClick={() => actions.open(task)}
      onKeyDown={(event) => {
        onKeyDown(event);
        if (event.defaultPrevented) return;
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); actions.open(task); }
      }}
    >
      {link && <div className="task-card__link"><TaskLinkChip link={link} /></div>}
      <TaskParentHint title={task.parentTaskTitle} />
      <div className="task-card__title">
        {task.status === "Done" && <TaskStatusIcon status="Done" />}
        <span>{task.title}</span>
        <TaskRepeatBadge recurrence={task.recurrence} />
      </div>
      <TaskChecklistBadge checklist={task.checklist} />
      <TaskSubtaskBadge progress={task.subtaskProgress} />
      <div className="task-card__meta">
        <TaskPriorityMenu task={task} actions={actions} />
        <TaskDueMenu task={task} actions={actions} />
        <span className="task-card__owner"><TaskAvatar name={owner} /></span>
      </div>
      <div className="task-card__hover-actions">
        {!closed && actions.canManage && (
          <Tooltip content="Mark complete">
            <button
              type="button"
              className="task-icon-button"
              aria-label={`Mark ${task.title} complete`}
              onClick={(event) => { event.stopPropagation(); void actions.setStatus(task, "Done"); }}
            >
              <Check size={14} />
            </button>
          </Tooltip>
        )}
        <TaskMoreMenu task={task} actions={actions} order={order} />
      </div>
    </article>
  );
}
