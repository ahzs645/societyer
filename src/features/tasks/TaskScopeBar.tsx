import { AlarmClock, CalendarRange, CircleDashed, Inbox, UserRound, UserX } from "lucide-react";
import type { ReactNode } from "react";
import { Select } from "../../components/Select";
import { TASK_GROUP_OPTIONS, type TaskGroupBy, type TaskScope } from "./taskModel";

const SCOPES: { value: TaskScope; label: string; icon: ReactNode; tone?: "danger" }[] = [
  { value: "all", label: "All", icon: <Inbox size={12} /> },
  { value: "open", label: "Open", icon: <CircleDashed size={12} /> },
  { value: "mine", label: "Assigned to me", icon: <UserRound size={12} /> },
  { value: "overdue", label: "Overdue", icon: <AlarmClock size={12} />, tone: "danger" },
  { value: "week", label: "Due this week", icon: <CalendarRange size={12} /> },
  { value: "unowned", label: "No owner", icon: <UserX size={12} /> },
];

export function taskScopeLabel(scope: TaskScope): string {
  return SCOPES.find((option) => option.value === scope)?.label ?? "All";
}

/**
 * Quick scopes over current tasks, with counts, plus the list's grouping.
 * A scope narrows the records before the table's own search and filters.
 */
export function TaskScopeBar({
  scope,
  onScope,
  counts,
  groupBy,
  onGroupBy,
  showGrouping,
}: {
  scope: TaskScope;
  onScope: (scope: TaskScope) => void;
  counts: Record<TaskScope, number>;
  groupBy: TaskGroupBy;
  onGroupBy: (groupBy: TaskGroupBy) => void;
  showGrouping: boolean;
}) {
  return (
    <div className="task-scope-bar">
      <div className="task-scope-bar__chips" role="group" aria-label="Show tasks">
        {SCOPES.map((option) => {
          const count = counts[option.value];
          if (option.value !== "all" && option.value !== "open" && option.value !== "mine" && count === 0 && scope !== option.value) return null;
          return (
            <button
              key={option.value}
              type="button"
              className={`task-scope-chip${scope === option.value ? " is-active" : ""}${option.tone === "danger" && count > 0 ? " task-scope-chip--danger" : ""}`}
              aria-pressed={scope === option.value}
              onClick={() => onScope(scope === option.value && option.value !== "all" ? "all" : option.value)}
            >
              {option.icon}
              {option.label}
              <span className="task-scope-chip__count">{count}</span>
            </button>
          );
        })}
      </div>
      {showGrouping && (
        <label className="task-scope-bar__group">
          <span>Group by</span>
          <Select<TaskGroupBy> size="sm" value={groupBy} onChange={onGroupBy} options={TASK_GROUP_OPTIONS} aria-label="Group tasks by" />
        </label>
      )}
    </div>
  );
}
