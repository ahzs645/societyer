/**
 * The task visual language: a ring that fills as work moves forward, bars for
 * priority, relative due dates and owner initials. Used by the Tasks list,
 * board, drawer and the dashboard.
 */
import { CalendarDays, CheckSquare, Flag, FileText, Landmark, Repeat2, Target, Users, Workflow, Handshake } from "lucide-react";
import { taskStatusLabel } from "../../../shared/taskStatus";
import { taskChecklistProgress, type TaskChecklistItem } from "../../../shared/taskChecklist";
import { dueInfo, initials, type TaskPrimaryLink } from "./taskModel";

export function TaskStatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 14 14", "aria-hidden": true, className: `task-status-icon task-status-icon--${status}` } as const;
  switch (status) {
    case "InProgress":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </svg>
      );
    case "Blocked":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4.4 7h5.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "Done":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" />
          <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="var(--bg-panel)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "Cancelled":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" />
          <path d="M5 5l4 4M9 5l-4 4" stroke="var(--bg-panel)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "Unknown":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.9 2.1" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
  }
}

const PRIORITY_WEIGHT: Record<string, number> = { Low: 1, Medium: 2, High: 3, Urgent: 4 };

export function TaskPriorityIcon({ priority, size = 14 }: { priority: string; size?: number }) {
  const weight = PRIORITY_WEIGHT[priority] ?? 0;
  if (weight === 4) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="task-priority-icon task-priority-icon--Urgent">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <path d="M7 3.8v4" stroke="var(--bg-panel)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r="0.95" fill="var(--bg-panel)" />
      </svg>
    );
  }
  if (weight === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="task-priority-icon task-priority-icon--none">
        {[2, 6, 10].map((x) => <rect key={x} x={x} y="6.25" width="2.5" height="1.5" rx="0.5" fill="currentColor" />)}
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className={`task-priority-icon task-priority-icon--${priority}`}>
      {[4.5, 7.5, 10.5].map((height, index) => (
        <rect
          key={height}
          x={1.5 + index * 4}
          y={12 - height}
          width="3"
          height={height}
          rx="1"
          fill="currentColor"
          opacity={index < weight ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}

export function TaskStatusPill({ status }: { status: string }) {
  return (
    <span className={`task-pill task-pill--status-${status}`}>
      <TaskStatusIcon status={status} />
      {taskStatusLabel(status)}
    </span>
  );
}

export function TaskPriorityPill({ priority }: { priority: string }) {
  return (
    <span className="task-pill">
      <TaskPriorityIcon priority={priority} />
      {priority || "No priority"}
    </span>
  );
}

export function TaskDue({ dueDate, status, showIcon = false, emptyLabel }: { dueDate?: string; status: string; showIcon?: boolean; emptyLabel?: string }) {
  const info = dueInfo(dueDate, status);
  if (!info) {
    return emptyLabel ? (
      <span className="task-due task-due--empty">
        <CalendarDays size={12} aria-hidden="true" />
        {emptyLabel}
      </span>
    ) : null;
  }
  return (
    <span className={`task-due task-due--${info.tone}`} title={info.title}>
      {showIcon && <CalendarDays size={12} aria-hidden="true" />}
      {info.label}
    </span>
  );
}

const AVATAR_TONES = ["blue", "green", "amber", "purple", "teal", "pink", "violet"] as const;

export function TaskAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  if (!name) {
    return <span className={`task-avatar task-avatar--${size} task-avatar--empty`} title="No owner" aria-label="No owner" />;
  }
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];
  return (
    <span className={`task-avatar task-avatar--${size} task-avatar--${tone}`} title={name} aria-label={name}>
      {initials(name)}
    </span>
  );
}

export function TaskChecklistBadge({ checklist }: { checklist?: TaskChecklistItem[] }) {
  const { done, total } = taskChecklistProgress(checklist);
  if (total === 0) return null;
  const complete = done === total;
  return (
    <span className={`task-checklist-badge${complete ? " is-complete" : ""}`} title={`${done} of ${total} checklist steps done`}>
      <CheckSquare size={12} aria-hidden="true" />
      {done}/{total}
      <span className="task-checklist-badge__bar" aria-hidden="true"><span style={{ width: `${(done / total) * 100}%` }} /></span>
    </span>
  );
}

const LINK_ICONS = {
  meeting: Users,
  filing: Landmark,
  goal: Target,
  commitment: Handshake,
  document: FileText,
  workflow: Workflow,
  committee: Flag,
} as const;

export function TaskLinkChip({ link }: { link: TaskPrimaryLink }) {
  const Icon = LINK_ICONS[link.kind] ?? Repeat2;
  return (
    <span className={`task-link-chip task-link-chip--${link.kind}`} title={`${link.kind[0].toUpperCase()}${link.kind.slice(1)}: ${link.label}`}>
      <Icon size={11} aria-hidden="true" />
      <span className="task-link-chip__label">{link.label}</span>
    </span>
  );
}
