/**
 * Timeline rows: a group header (the list's grouping, or "Not scheduled")
 * and a task row with its grid cell (title, owner, status) and its lane (a
 * bar, a milestone or an open-ended bar; or, for an unscheduled task, a lane
 * where a click sets the due date). Memoised: during a drag only the dragged
 * row re-renders.
 */
import { memo, type ReactNode } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { taskStatusLabel } from "../../../../shared/taskStatus";
import { TaskAvatar, TaskStatusIcon } from "../TaskVisuals";
import { isClosedStatus, taskOwnerName, type TaskRecord } from "../taskModel";
import { dayToX, describeSchedule, taskSpan, type TaskSchedule, type TaskSpan } from "./timelineMath";
import type { TimelineGroupRow, TimelineTaskRow } from "./timelineRows";

/** Height of the sticky date header. */
export const TIMELINE_HEADER_H = 48;
const HEADER_H = TIMELINE_HEADER_H;

/** Open work whose due date has passed (imported "Unknown" work never counts). */
export function isOverdue(task: TaskRecord, schedule: TaskSchedule, today: number) {
  return schedule.due !== null && schedule.due < today && !isClosedStatus(task.status) && task.status !== "Unknown";
}

export const TimelineGroupRowView = memo(function TimelineGroupRowView({
  row,
  top,
  height,
  gridW,
  laneWidth,
  canEdit,
  onToggle,
}: {
  row: TimelineGroupRow;
  top: number;
  height: number;
  gridW: number;
  laneWidth: number;
  canEdit: boolean;
  onToggle: (row: TimelineGroupRow) => void;
}) {
  return (
    <div className="task-timeline__row task-timeline__row--group" style={{ top, height }}>
      <div className="task-timeline__cell" style={{ width: gridW }}>
        <button type="button" className="task-timeline__group-toggle" aria-expanded={!row.collapsed} onClick={() => onToggle(row)}>
          <ChevronRight size={14} className="task-timeline__chevron" aria-hidden="true" />
          <span className="task-timeline__group-label">{row.label}</span>
          <span className="task-timeline__group-count">{row.count}</span>
        </button>
      </div>
      <div className="task-timeline__lane" style={{ width: laneWidth }}>
        {row.variant === "unscheduled" && !row.collapsed && (
          <span className="task-timeline__lane-note" style={{ left: gridW + 8 }}>{canEdit ? "Click a day in a row to set its due date, or open the task." : "Open a task to see or add its dates."}</span>
        )}
      </div>
    </div>
  );
});

export const TimelineTaskRowView = memo(function TimelineTaskRowView({
  row,
  top,
  height,
  gridW,
  laneWidth,
  origin,
  dayWidth,
  today,
  openDays,
  currentYear,
  isPhone,
  canEdit,
  tabStop,
  preview,
  ghostDay,
  helpId,
}: {
  row: TimelineTaskRow;
  top: number;
  height: number;
  gridW: number;
  laneWidth: number;
  origin: number;
  dayWidth: number;
  today: number;
  openDays: number;
  currentYear: number;
  isPhone: boolean;
  canEdit: boolean;
  tabStop: boolean;
  preview: TaskSchedule | null;
  ghostDay: number | null;
  helpId: string;
}) {
  const { task } = row;
  const schedule: TaskSchedule = preview ? { start: preview.start ?? row.schedule.start, due: preview.due ?? row.schedule.due } : row.schedule;
  // A dragged milestone keeps its shape; anything else is redrawn from the new dates.
  const span: TaskSpan = preview && row.span.kind === "milestone" && preview.due !== null
    ? { kind: "milestone", start: preview.due, end: preview.due }
    : preview ? taskSpan(schedule, openDays) : row.span;
  const owner = taskOwnerName(task);
  const overdue = isOverdue(task, schedule, today);
  const done = task.status === "Done";
  const statusLabel = taskStatusLabel(task.status);
  const label = `${task.title}. ${describeSchedule(schedule, currentYear)}. ${statusLabel}${overdue ? ", overdue" : ""}. ${owner ? `Owner: ${owner}` : "No owner"}.`;
  const unscheduled = span.kind === "none";
  const stateClass = `is-${task.status}${overdue ? " is-overdue" : ""}${done ? " is-done" : ""}${preview ? " is-preview" : ""}`;

  let bar: ReactNode = null;
  if (span.kind !== "none") {
    const milestone = span.kind === "milestone";
    const left = milestone ? dayToX(span.start, origin, dayWidth) + dayWidth / 2 - 8 : dayToX(span.start, origin, dayWidth) + 1;
    const width = milestone ? 16 : Math.max(6, (span.end - span.start + 1) * dayWidth - 2);
    bar = (
      <>
        <button
          type="button"
          className={`task-timeline__bar task-timeline__bar--${span.kind} ${stateClass}`}
          style={{ left, width, scrollMarginLeft: gridW + 8, scrollMarginTop: HEADER_H }}
          data-bar={row.key}
          data-focus-key={row.key}
          tabIndex={tabStop ? 0 : -1}
          aria-label={label}
          aria-describedby={helpId}
        >
          {span.kind === "bar" && canEdit && <span className="task-timeline__handle task-timeline__handle--start" data-handle="start" aria-hidden="true" />}
          {!milestone && width >= 26 && <TaskStatusIcon status={task.status} size={12} />}
          {!milestone && overdue && width >= 44 && <AlertTriangle size={12} aria-hidden="true" className="task-timeline__bar-alert" />}
          {span.kind !== "milestone" && canEdit && <span className="task-timeline__handle task-timeline__handle--end" data-handle="end" aria-hidden="true" />}
        </button>
        <span className={`task-timeline__bar-label ${stateClass}`} style={{ left: left + width + 6 }} aria-hidden="true">
          {overdue && <AlertTriangle size={12} aria-hidden="true" />}
          {task.title}
        </span>
      </>
    );
  }

  return (
    <div className={`task-timeline__row${unscheduled ? " task-timeline__row--unscheduled" : ""}`} style={{ top, height }}>
      <div className="task-timeline__cell" style={{ width: gridW, paddingLeft: 8 + row.depth * 16 }}>
        <button
          type="button"
          className={`task-timeline__title${done ? " is-done" : ""}`}
          data-open-task={row.key}
          data-focus-key={unscheduled ? row.key : undefined}
          tabIndex={unscheduled && tabStop ? 0 : -1}
          aria-label={unscheduled ? `${task.title}. Not scheduled. Open to add dates.` : undefined}
          aria-describedby={unscheduled ? helpId : undefined}
          title={task.title}
          style={unscheduled ? { scrollMarginTop: HEADER_H } : undefined}
        >
          {isPhone && <TaskStatusIcon status={task.status} size={12} />}
          <span className="task-timeline__title-text">{task.title}</span>
        </button>
        {!isPhone && (
          <span className="task-timeline__owner" title={owner || "No owner"}>
            <TaskAvatar name={owner} />
          </span>
        )}
        {!isPhone && (
          <span className="task-timeline__status" title={statusLabel}>
            <TaskStatusIcon status={task.status} size={12} />
            <span className="task-timeline__status-text">{statusLabel}</span>
          </span>
        )}
      </div>
      <div className="task-timeline__lane" style={{ width: laneWidth }}>
        {bar}
        {unscheduled && canEdit && (
          <div className="task-timeline__schedule-lane" data-schedule-lane={row.key} aria-hidden="true">
            {ghostDay !== null && (
              <span className="task-timeline__ghost" style={{ left: dayToX(ghostDay, origin, dayWidth) + dayWidth / 2 - 8 }}>
                <span className="task-timeline__ghost-label">{describeSchedule({ start: null, due: ghostDay }, currentYear)}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
