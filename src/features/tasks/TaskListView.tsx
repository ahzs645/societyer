/**
 * Grouped task list: collapsible groups (status, due date, priority or
 * owner), rows whose properties change in place, and an inline composer at
 * the end of each group that starts a task with that group's values.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronRight, Plus } from "lucide-react";
import { useFilteredRecords } from "@/platform/record-engine";
import { useRecordTableState, useRecordTableStoreHandle } from "../../platform/record-engine/record-table/state/recordTableStore";
import { useLongPress } from "../../platform/record-engine/record-table/hooks/useLongPress";
import { useIsMobile } from "../../lib/useIsMobile";
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
  // Roving tab stop: the rows are one stop in the Tab order (the last row
  // used, else the first shown); ↑ / ↓ / Home / End move between rows.
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  usePhoneTaskSelection(actions.canManage);

  if (records.length === 0 && !actions.canManage) {
    return <TaskListEmpty hasTasks={hasTasks} />;
  }

  const isCollapsed = (group: TaskGroup) => toggled[`${groupBy}:${group.key}`] ?? Boolean(group.collapsedByDefault);
  const toggle = (group: TaskGroup) => setToggled((current) => ({ ...current, [`${groupBy}:${group.key}`]: !isCollapsed(group) }));
  const shownRowIds = groups.flatMap((group) => (isCollapsed(group) ? [] : group.tasks.map((task) => String(task._id))));
  const tabStopRowId = activeRowId && shownRowIds.includes(activeRowId) ? activeRowId : shownRowIds[0] ?? null;

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".task-row") ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0
      : event.key === "End" ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
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
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task._id}
                    task={task}
                    actions={actions}
                    tabStop={String(task._id) === tabStopRowId}
                    onActivate={() => setActiveRowId(String(task._id))}
                  />
                ))}
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

/** The row's own controls (selection, status, priority, due, actions), in order. */
function rowControls(row: HTMLElement) {
  return [...row.querySelectorAll<HTMLElement>("input, button")].filter(
    (control) => !(control as HTMLButtonElement | HTMLInputElement).disabled,
  );
}

function TaskRow({
  task,
  actions,
  tabStop,
  onActivate,
}: {
  task: TaskRecord;
  actions: TaskViewActions;
  /** Whether this row holds the list's single Tab stop. */
  tabStop: boolean;
  /** Focus landed on the row or one of its controls. */
  onActivate: () => void;
}) {
  const selected = useRecordTableState((s) => s.selectedRecordIds.has(String(task._id)));
  const anySelected = useRecordTableState((s) => s.selectedRecordIds.size > 0);
  const setSelected = useRecordTableState((s) => s.setSelectedRecordIds);
  // Phones: "Select records" (Options menu) or a long-press turns rows into
  // checkboxes; a tap then ticks the row instead of opening it.
  const selecting = useRecordTableState((s) => s.mobileSelectable && s.mobileSelectionMode);
  const handle = useRecordTableStoreHandle();
  const longPress = useLongPress(actions.canManage ? () => {
    if (handle.get().mobileSelectable) handle.get().setMobileSelectionMode(true);
    setSelected((previous) => new Set(previous).add(String(task._id)));
  } : undefined);
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
      className={`task-row${selected ? " is-selected" : ""}${closed ? " is-closed" : ""}${anySelected || selecting ? " has-selection" : ""}`}
      role="button"
      tabIndex={tabStop ? 0 : -1}
      aria-label={task.title}
      aria-pressed={selecting ? selected : undefined}
      aria-keyshortcuts="ArrowRight ArrowLeft"
      onFocus={onActivate}
      {...longPress}
      onClickCapture={(event) => {
        longPress.onClickCapture?.(event);
        if (event.isPropagationStopped() || !selecting) return;
        if ((event.target as Element).closest(".task-row__select-touch")) return;
        event.preventDefault();
        event.stopPropagation();
        toggleSelected();
      }}
      onClick={() => actions.open(task)}
      // Capture: the inline menus stop their keydowns from bubbling.
      onKeyDownCapture={(event) => {
        const row = event.currentTarget;
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Escape") return;
        if (event.target === row && event.key !== "ArrowRight") return;
        const controls = rowControls(row);
        const index = controls.indexOf(event.target as HTMLElement);
        if (event.target !== row && index === -1) return;
        // An open inline menu keeps focus on its trigger and owns the keys.
        if ((event.target as HTMLElement).getAttribute("aria-expanded") === "true") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") { row.focus(); return; }
        const next = event.target === row ? 0 : index + (event.key === "ArrowRight" ? 1 : -1);
        if (next < 0) row.focus();
        else controls[Math.min(next, controls.length - 1)]?.focus();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter") { event.preventDefault(); actions.open(task); }
        if (event.key === " " && actions.canManage) { event.preventDefault(); toggleSelected(); }
      }}
    >
      {actions.canManage && (
        <span className="task-row__select" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={toggleSelected} aria-label={`Select ${task.title}`} tabIndex={-1} />
        </span>
      )}
      {selecting ? (
        // Sits in the status slot of the phone layout, so it needs no grid
        // changes; a real checkbox with a full-height tap area.
        <label
          className="task-menu-anchor task-row__select-touch"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, minHeight: 32 }}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={toggleSelected}
            aria-label={`Select ${task.title}`}
            style={{ width: 20, height: 20, margin: 0 }}
          />
        </label>
      ) : (
        <TaskStatusMenu task={task} actions={actions} tabIndex={-1} />
      )}
      <span className="task-row__title">
        <span className="task-row__title-text">{task.title}</span>
        <TaskChecklistBadge checklist={task.checklist} />
      </span>
      {/* One grid cell each on wide screens; a wrapped second line on phones. */}
      <span className="task-row__meta">
        <span className="task-row__link">{link && <TaskLinkChip link={link} />}</span>
        <span className="task-row__priority"><TaskPriorityMenu task={task} actions={actions} tabIndex={-1} /></span>
        <span className="task-row__due"><TaskDueMenu task={task} actions={actions} emptyLabel={actions.canManage ? "Set date" : ""} tabIndex={-1} /></span>
      </span>
      <span className="task-row__owner"><TaskAvatar name={owner} /></span>
      <span className="task-row__more"><TaskMoreMenu task={task} actions={actions} tabIndex={-1} /></span>
    </div>
  );
}

/**
 * Offers the phone "Select records" toggle (the toolbar's Options menu) for
 * the task list, as RecordTable does for its own rows, and leaves selection
 * mode when the list goes away or the screen grows past phone width.
 */
export function usePhoneTaskSelection(canManage: boolean) {
  const isMobile = useIsMobile();
  const handle = useRecordTableStoreHandle();
  const enabled = canManage && isMobile;
  useEffect(() => {
    handle.get().setMobileSelectable(enabled);
    return () => {
      handle.get().setMobileSelectable(false);
      if (handle.get().mobileSelectionMode) {
        handle.get().setMobileSelectionMode(false);
        handle.get().clearSelection();
      }
    };
  }, [enabled, handle]);
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
