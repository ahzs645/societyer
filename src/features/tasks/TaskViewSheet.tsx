import { useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Modal } from "../../components/Modal";
import { TaskScopeBar, taskScopeLabel } from "./TaskScopeBar";
import { TASK_GROUP_OPTIONS, type TaskGroupBy, type TaskScope } from "./taskModel";

/**
 * Phones: the Tasks page's register switch (Current / History), scopes and
 * "Group by" fold into one compact summary button — "Current · All · Status"
 * — that opens a sheet holding those controls, so the list starts near the
 * top of the screen instead of under four rows of controls.
 */
export function TaskViewSummaryButton({
  registerSwitch,
  register,
  scope,
  onScope,
  counts,
  groupBy,
  onGroupBy,
  showGrouping,
}: {
  /** The page's own Current / History switch, rendered inside the sheet. */
  registerSwitch: ReactNode;
  register: "current" | "historical";
  scope: TaskScope;
  onScope: (scope: TaskScope) => void;
  counts: Record<TaskScope, number>;
  groupBy: TaskGroupBy;
  onGroupBy: (groupBy: TaskGroupBy) => void;
  showGrouping: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parts = [register === "current" ? "Current" : "History"];
  if (register === "current") {
    parts.push(taskScopeLabel(scope));
    if (showGrouping) parts.push(TASK_GROUP_OPTIONS.find((option) => option.value === groupBy)?.label ?? "Status");
  }
  const summary = parts.join(" · ");
  return (
    <>
      <button
        type="button"
        className="btn-action task-summary-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Task view: ${summary}`}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={12} aria-hidden="true" />
        <span className="task-summary-button__text">{summary}</span>
        <ChevronDown size={12} aria-hidden="true" className="task-summary-button__caret" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Show tasks" size="sm">
        <div className="task-view-sheet">
          {registerSwitch}
          {register === "current" && (
            <TaskScopeBar
              scope={scope}
              onScope={onScope}
              counts={counts}
              groupBy={groupBy}
              onGroupBy={onGroupBy}
              showGrouping={showGrouping}
            />
          )}
        </div>
      </Modal>
    </>
  );
}
