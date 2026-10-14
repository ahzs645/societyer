/**
 * Grouped task list: collapsible groups (status, due date, priority or
 * owner), rows whose properties change in place, and an inline composer at
 * the end of each group that starts a task with that group's values.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronRight, Plus } from "lucide-react";
import { useFilteredRecords } from "@/platform/record-engine";
import { useRecordTableState } from "../../platform/record-engine/record-table/state/recordTableStore";
import { TaskQuickAdd } from "./TaskQuickAdd";
import { TaskAvatar, TaskChecklistBadge, TaskLinkChip, TaskPriorityIcon, TaskStatusIcon } from "./TaskVisuals";
import { TaskDueMenu, TaskMoreMenu, TaskPriorityMenu, TaskStatusMenu, type TaskViewActions } from "./TaskMenus";
import { groupTasks, isClosedStatus, taskOwnerName, taskPrimaryLink, type TaskGroup, type TaskGroupBy, type TaskRecord } from "./taskModel";
import { Tooltip } from "../../components/Tooltip";

export function TaskListView({
  groupBy,
  actions,
  hasTasks,
}: {
  groupBy: TaskGroupBy;
  actions: TaskViewActions;
  /** Whether the register has tasks before search and filters. */
  hasTasks: boolean;
}) {
  const records = useFilteredRecords() as TaskRecord[];
  const groups = useMemo(() => groupTasks(records, groupBy), [records, groupBy]);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  if (records.length === 0 && !actions.canManage) {
    return <TaskListEmpty hasTasks={hasTasks} />;
  }

  const isCollapsed = (group: TaskGroup) => toggled[`${groupBy}:${group.key}`] ?? Boolean(group.collapsedByDefault);
  const toggle = (group: TaskGroup) => setToggled((current) => ({ ...current, [`${groupBy}:${group.key}`]: !isCollapsed(group) }));

  // Arrow keys move between rows; Enter opens the focused task.
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".task-row") ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  return (
    <div className="task-list" ref={listRef} onKeyDown={onListKeyDown}>
      {records.length === 0 && <TaskListEmpty hasTasks={hasTasks} />}
      {groups.map((group) => {
        const collapsed = isCollapsed(group);
        const canAdd = actions.canManage && group.defaults !== null;
        const groupId = `task-group-${groupBy}-${group.key}`;
        if (records.length === 0 && !canAdd) return null;
        return (
          <section key={group.key} className="task-group" aria-labelledby={groupId}>
            {groupBy !== "none" && (
              <div className="task-group__head">
                <button
                  type="button"
                  className="task-group__toggle"
                  aria-expanded={!collapsed}
                  onClick={() => toggle(group)}
                >
                  <ChevronRight size={14} className="task-group__chevron" aria-hidden="true" />
                  <GroupIcon group={group} />
                  <span id={groupId} className="task-group__label">{group.label}</span>
                  <span className="task-group__count">{group.tasks.length}</span>
                </button>
                {canAdd && (
                  <Tooltip content={`Add task to ${group.label}`}>
                    <button
                      type="button"
                      className="task-icon-button task-group__add"
                      aria-label={`Add task to ${group.label}`}
                      onClick={() => {
                        if (collapsed) toggle(group);
                        setComposerFor(group.key);
                      }}
                    >
                      <Plus size={14} />
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
            {!collapsed && (
              <div className="task-group__rows">
                {group.tasks.map((task) => <TaskRow key={task._id} task={task} actions={actions} />)}
                {canAdd && (
                  <TaskQuickAdd
                    open={composerFor === group.key}
                    onOpen={() => setComposerFor(group.key)}
                    onClose={() => setComposerFor((current) => (current === group.key ? null : current))}
                    onSubmit={(title) => actions.quickAdd(title, group.defaults ?? {})}
                    variant="row"
                  />
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function GroupIcon({ group }: { group: TaskGroup }) {
  if (group.kind === "status") return <TaskStatusIcon status={group.key} />;
  if (group.kind === "priority") return <TaskPriorityIcon priority={group.key === "other" ? "" : group.key} />;
  if (group.kind === "due") return <CalendarDays size={14} className={`task-group__due-icon task-group__due-icon--${group.key}`} aria-hidden="true" />;
  if (group.kind === "owner") return <TaskAvatar name={group.key === "none" ? "" : group.label} />;
  return null;
}

function TaskRow({ task, actions }: { task: TaskRecord; actions: TaskViewActions }) {
  const selected = useRecordTableState((s) => s.selectedRecordIds.has(String(task._id)));
  const anySelected = useRecordTableState((s) => s.selectedRecordIds.size > 0);
  const setSelected = useRecordTableState((s) => s.setSelectedRecordIds);
  const link = taskPrimaryLink(task);
  const owner = taskOwnerName(task);
  const closed = isClosedStatus(task.status);
  const toggleSelected = () =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(String(task._id))) next.delete(String(task._id));
      else next.add(String(task._id));
      return next;
    });

  return (
    <div
      className={`task-row${selected ? " is-selected" : ""}${closed ? " is-closed" : ""}${anySelected ? " has-selection" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={task.title}
      onClick={() => actions.open(task)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter") { event.preventDefault(); actions.open(task); }
        if (event.key === " " && actions.canManage) { event.preventDefault(); toggleSelected(); }
      }}
    >
      {actions.canManage && (
        <span className="task-row__select" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={toggleSelected} aria-label={`Select ${task.title}`} />
        </span>
      )}
      <TaskStatusMenu task={task} actions={actions} />
      <span className="task-row__title">
        <span className="task-row__title-text">{task.title}</span>
        <TaskChecklistBadge checklist={task.checklist} />
      </span>
      {/* One grid cell each on wide screens; a wrapped second line on phones. */}
      <span className="task-row__meta">
        <span className="task-row__link">{link && <TaskLinkChip link={link} />}</span>
        <span className="task-row__priority"><TaskPriorityMenu task={task} actions={actions} /></span>
        <span className="task-row__due"><TaskDueMenu task={task} actions={actions} emptyLabel={actions.canManage ? "Set date" : ""} /></span>
      </span>
      <span className="task-row__owner"><TaskAvatar name={owner} /></span>
      <span className="task-row__more"><TaskMoreMenu task={task} actions={actions} /></span>
    </div>
  );
}

function TaskListEmpty({ hasTasks }: { hasTasks: boolean }) {
  return (
    <div className="record-table__empty">
      <div className="record-table__empty-title">{hasTasks ? "No matching tasks" : "No tasks yet"}</div>
      <div className="record-table__empty-desc">
        {hasTasks ? "Change or clear the current search and filters." : "Add a task below, or use New task to fill in every detail."}
      </div>
    </div>
  );
}
