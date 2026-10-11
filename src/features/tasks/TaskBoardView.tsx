/**
 * Task board: one column per status (or priority), cards that carry the
 * task's link, checklist progress, priority, due date and owner, drag to
 * move between columns, and a composer at the foot of each column.
 */
import { useMemo, useState, type DragEvent } from "react";
import { Check, ChevronsLeftRight, Plus } from "lucide-react";
import { useFilteredRecords } from "@/platform/record-engine";
import { TaskQuickAdd } from "./TaskQuickAdd";
import { TaskAvatar, TaskChecklistBadge, TaskLinkChip, TaskPriorityIcon, TaskStatusIcon } from "./TaskVisuals";
import { TaskDueMenu, TaskMoreMenu, TaskPriorityMenu, type TaskViewActions } from "./TaskMenus";
import { groupTasks, isClosedStatus, taskOwnerName, taskPrimaryLink, type TaskGroup, type TaskRecord } from "./taskModel";

export function TaskBoardView({ by, actions }: { by: "status" | "priority"; actions: TaskViewActions }) {
  const records = useFilteredRecords() as TaskRecord[];
  const columns = useMemo(() => groupTasks(records, by), [records, by]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);

  const move = (task: TaskRecord, column: TaskGroup) => {
    if (!column.defaults) return;
    if (column.defaults.status && column.defaults.status !== task.status) void actions.setStatus(task, column.defaults.status);
    if (column.defaults.priority && column.defaults.priority !== task.priority) void actions.setPriority(task, column.defaults.priority);
  };

  return (
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
        const onDragOver = (event: DragEvent) => {
          if (!canDrop || !dragId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (overColumn !== column.key) setOverColumn(column.key);
        };
        const onDrop = (event: DragEvent) => {
          event.preventDefault();
          const id = event.dataTransfer.getData("text/task-id") || dragId;
          const task = records.find((record) => String(record._id) === id);
          setDragId(null);
          setOverColumn(null);
          if (task) move(task, column);
        };
        return (
          <section
            key={column.key}
            role="listitem"
            className={`kanban__col task-board__col${overColumn === column.key ? " is-drop-target" : ""}`}
            aria-label={`${column.label}, ${column.tasks.length} task${column.tasks.length === 1 ? "" : "s"}`}
            onDragOver={onDragOver}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverColumn((current) => (current === column.key ? null : current));
            }}
            onDrop={onDrop}
          >
            <header className="task-board__head">
              <ColumnIcon column={column} />
              <span className="task-board__col-label">{column.label}</span>
              <span className="task-board__col-count">{column.tasks.length}</span>
              <span className="task-board__head-actions">
                {actions.canManage && column.defaults && (
                  <button type="button" className="task-icon-button" aria-label={`Add task to ${column.label}`} title="Add task" onClick={() => setComposerFor(column.key)}>
                    <Plus size={14} />
                  </button>
                )}
                <button type="button" className="task-icon-button" aria-label={`Collapse ${column.label}`} title="Collapse column" onClick={toggle}>
                  <ChevronsLeftRight size={13} />
                </button>
              </span>
            </header>
            <div className="kanban__body task-board__body">
              {column.tasks.map((task) => (
                <TaskCard
                  key={task._id}
                  task={task}
                  actions={actions}
                  dragging={dragId === String(task._id)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/task-id", String(task._id));
                    event.dataTransfer.effectAllowed = "move";
                    setDragId(String(task._id));
                  }}
                  onDragEnd={() => { setDragId(null); setOverColumn(null); }}
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
  );
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
  onDragStart,
  onDragEnd,
}: {
  task: TaskRecord;
  actions: TaskViewActions;
  dragging: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const link = taskPrimaryLink(task);
  const owner = taskOwnerName(task);
  const closed = isClosedStatus(task.status);
  return (
    <article
      className={`kanban__card task-card${dragging ? " is-dragging" : ""}${closed ? " is-closed" : ""}${actions.canManage ? " is-movable" : ""}`}
      draggable={actions.canManage}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      role="button"
      tabIndex={0}
      aria-label={task.title}
      onClick={() => actions.open(task)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); actions.open(task); }
      }}
    >
      {link && <div className="task-card__link"><TaskLinkChip link={link} /></div>}
      <div className="task-card__title">
        {task.status === "Done" && <TaskStatusIcon status="Done" />}
        <span>{task.title}</span>
      </div>
      <TaskChecklistBadge checklist={task.checklist} />
      <div className="task-card__meta">
        <TaskPriorityMenu task={task} actions={actions} />
        <TaskDueMenu task={task} actions={actions} />
        <span className="task-card__owner"><TaskAvatar name={owner} /></span>
      </div>
      <div className="task-card__hover-actions">
        {!closed && actions.canManage && (
          <button
            type="button"
            className="task-icon-button"
            aria-label={`Mark ${task.title} complete`}
            title="Mark complete"
            onClick={(event) => { event.stopPropagation(); void actions.setStatus(task, "Done"); }}
          >
            <Check size={14} />
          </button>
        )}
        <TaskMoreMenu task={task} actions={actions} />
      </div>
    </article>
  );
}
