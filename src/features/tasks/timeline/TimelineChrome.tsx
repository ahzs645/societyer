/**
 * The timeline's surroundings: the controls above it (range, Earlier /
 * Today / Later, Fit, scale), the key, the sticky date header with the
 * resizable task-grid corner, the gridlines behind the rows, and the hover
 * card for a bar.
 */
import { useRef } from "react";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { taskStatusLabel } from "../../../../shared/taskStatus";
import { TaskStatusIcon } from "../TaskVisuals";
import { taskOwnerName, type TaskRecord } from "../taskModel";
import { TIMELINE_SCALES, TIMELINE_SCALE_LABELS, dayToX, describeSchedule, type TaskSchedule, type TimelineScale, type TimelineTick } from "./timelineMath";
import { TIMELINE_HEADER_H, isOverdue } from "./TimelineRowViews";

export const GRID_MIN = 220;
export const GRID_MAX = 560;
/** Arrow keys on the grid resizer move it this far. */
const GRID_STEP = 16;

export type TimelineTicks = { major: TimelineTick[]; minor: TimelineTick[] };
/** Where the timeline is drawn: its first day and pixels per day. */
export type TimelineGeometry = { origin: number; dayWidth: number };

export function TimelineToolbar({
  rangeLabel,
  scale,
  canFit,
  onPage,
  onToday,
  onFit,
  onScale,
}: {
  rangeLabel: string;
  scale: TimelineScale;
  canFit: boolean;
  onPage: (direction: -1 | 1) => void;
  onToday: () => void;
  onFit: () => void;
  onScale: (scale: TimelineScale) => void;
}) {
  return (
    <div className="task-timeline__head">
      <div className="task-timeline__range" aria-live="polite">{rangeLabel}</div>
      <div className="task-timeline__nav">
        <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="Earlier" title="Earlier" onClick={() => onPage(-1)}><ChevronLeft size={14} /></button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onToday}>Today</button>
        <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="Later" title="Later" onClick={() => onPage(1)}><ChevronRight size={14} /></button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onFit} disabled={!canFit} title="Show every scheduled task">
          <Maximize2 size={12} aria-hidden="true" /> Fit
        </button>
      </div>
      <div className="record-table__segmented task-timeline__scales" role="group" aria-label="Timeline scale">
        {TIMELINE_SCALES.map((value) => (
          <button key={value} type="button" aria-pressed={scale === value} className={scale === value ? "is-active" : ""} onClick={() => onScale(value)}>
            {TIMELINE_SCALE_LABELS[value]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Shapes and patterns, so status never rests on colour alone. */
export function TimelineLegend() {
  return (
    <ul className="task-timeline__legend" aria-label="Key">
      <li><span className="task-timeline__key task-timeline__key--bar" aria-hidden="true" />Start to due</li>
      <li><span className="task-timeline__key task-timeline__key--milestone" aria-hidden="true" />Due date only</li>
      <li><span className="task-timeline__key task-timeline__key--open" aria-hidden="true" />Start date only</li>
      <li><span className="task-timeline__key task-timeline__key--overdue" aria-hidden="true" />Overdue</li>
      <li><span className="task-timeline__key task-timeline__key--done" aria-hidden="true" />Done</li>
    </ul>
  );
}

/**
 * The sticky header: the grid's column names (with a resizer on desktop)
 * and two rows of date ticks. Only the ticks in view are passed in.
 */
export function TimelineHeader({
  gridW,
  laneWidth,
  isPhone,
  scale,
  ticks,
  geometry,
  today,
  onResize,
}: {
  gridW: number;
  laneWidth: number;
  isPhone: boolean;
  scale: TimelineScale;
  ticks: TimelineTicks;
  geometry: TimelineGeometry;
  today: number;
  /** New grid width; `persist` once the drag ends or a key sets it. */
  onResize: (width: number, persist: boolean) => void;
}) {
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const { origin, dayWidth } = geometry;
  return (
    <div className="task-timeline__header" style={{ height: TIMELINE_HEADER_H }}>
      <div className="task-timeline__corner" style={{ width: gridW }}>
        <span className="task-timeline__col-title">Task</span>
        {!isPhone && <span className="task-timeline__col-owner">Owner</span>}
        {!isPhone && <span className="task-timeline__col-status">Status</span>}
        {!isPhone && (
          <div
            className="task-timeline__resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the task list"
            aria-valuemin={GRID_MIN}
            aria-valuemax={GRID_MAX}
            aria-valuenow={gridW}
            tabIndex={0}
            onPointerDown={(event) => {
              event.stopPropagation();
              resizeRef.current = { startX: event.clientX, startWidth: gridW };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              event.stopPropagation();
              const resize = resizeRef.current;
              if (resize) onResize(resize.startWidth + event.clientX - resize.startX, false);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              const resize = resizeRef.current;
              if (resize) onResize(resize.startWidth + event.clientX - resize.startX, true);
              resizeRef.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              event.stopPropagation();
              onResize(gridW + (event.key === "ArrowLeft" ? -GRID_STEP : GRID_STEP), true);
            }}
          />
        )}
      </div>
      <div className="task-timeline__scale" style={{ width: laneWidth }} aria-hidden="true">
        <div className="task-timeline__ticks task-timeline__ticks--major">
          {ticks.major.map((tick) => (
            <div key={tick.day} className="task-timeline__tick" style={{ left: dayToX(tick.day, origin, dayWidth), width: tick.days * dayWidth }} title={tick.title}>
              {/* Sticks beside the grid, so a long month keeps its name in view. */}
              <span className="task-timeline__tick-label" style={{ left: gridW }}>{tick.label}</span>
            </div>
          ))}
        </div>
        <div className="task-timeline__ticks task-timeline__ticks--minor">
          {ticks.minor.map((tick) => (
            <div
              key={tick.day}
              className={`task-timeline__tick${tick.weekend ? " is-weekend" : ""}${scale === "day" && tick.day === today ? " is-today" : ""}`}
              style={{ left: dayToX(tick.day, origin, dayWidth), width: tick.days * dayWidth }}
              title={tick.title}
            >
              {tick.sub && <span className="task-timeline__tick-sub">{tick.sub}</span>}
              {tick.label}
            </div>
          ))}
        </div>
        <div className="task-timeline__today-flag" style={{ left: dayToX(today, origin, dayWidth) + dayWidth / 2 }} title="Today" />
      </div>
    </div>
  );
}

/** Column lines, weekend shading (day scale) and the today line behind the rows. */
export function TimelineGridLines({
  gridW,
  laneWidth,
  scale,
  ticks,
  geometry,
  today,
}: {
  gridW: number;
  laneWidth: number;
  scale: TimelineScale;
  ticks: TimelineTicks;
  geometry: TimelineGeometry;
  today: number;
}) {
  const { origin, dayWidth } = geometry;
  return (
    <div className="task-timeline__grid-lines" style={{ left: gridW, width: laneWidth }} aria-hidden="true">
      {scale === "day" && ticks.minor.filter((tick) => tick.weekend).map((tick) => (
        <div key={tick.day} className="task-timeline__weekend" style={{ left: dayToX(tick.day, origin, dayWidth), width: dayWidth }} />
      ))}
      {ticks.minor.map((tick) => (
        <div key={tick.day} className="task-timeline__line" style={{ left: dayToX(tick.day, origin, dayWidth) }} />
      ))}
      {ticks.major.map((tick) => (
        <div key={tick.day} className="task-timeline__line task-timeline__line--major" style={{ left: dayToX(tick.day, origin, dayWidth) }} />
      ))}
      <div className="task-timeline__today" style={{ left: dayToX(today, origin, dayWidth) + dayWidth / 2 }} />
    </div>
  );
}

/**
 * Hover (or focus) card for a bar: title, dates, status and owner. Visual
 * only: the bar's own label already says all of it to a screen reader.
 */
export function TimelineHint({
  task,
  schedule,
  today,
  currentYear,
  left,
  top,
  above,
}: {
  task: TaskRecord;
  schedule: TaskSchedule;
  today: number;
  currentYear: number;
  left: number;
  top: number;
  above: boolean;
}) {
  return (
    <div className={`task-timeline__hint${above ? " is-above" : ""}`} style={{ left, top }} aria-hidden="true">
      <strong>{task.title}</strong>
      <span>{describeSchedule(schedule, currentYear)}</span>
      <span className="task-timeline__hint-status">
        <TaskStatusIcon status={task.status} size={12} />
        {taskStatusLabel(task.status)}
        {isOverdue(task, schedule, today) && <> · <span className="task-timeline__hint-overdue">Overdue</span></>}
      </span>
      <span className="muted">{taskOwnerName(task) || "No owner"}</span>
    </div>
  );
}
