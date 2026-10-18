import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ListFilter } from "lucide-react";
import { Modal } from "../../components/Modal";
import { TaskScopeBar, taskScopeLabel } from "./TaskScopeBar";
import { TASK_GROUP_OPTIONS, type TaskGroupBy, type TaskScope } from "./taskModel";

/**
 * Phones: the Tasks page's register switch (Current / History), scopes and
 * "Group by" fold into one compact summary button — "Current · All · Status"
 * — that opens a sheet holding those controls, so the list starts near the
 * top of the screen instead of under four rows of controls. The sheet also
 * lists the saved views, so one sheet answers "which tasks am I looking at".
 */
export type TaskSavedViewChoice = {
  views: { id: string; name: string }[];
  currentId: string | null;
  onPick: (viewId: string) => void;
};

export function TaskViewSummaryButton({
  registerSwitch,
  register,
  scope,
  onScope,
  counts,
  groupBy,
  onGroupBy,
  showGrouping,
  savedViews,
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
  /** The table's saved views; picking one here works like the toolbar's view picker. */
  savedViews?: TaskSavedViewChoice;
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
        {/* Narrow phones show just the icon and the register ("Current"); a
          * list-filter glyph so it doesn't read as the table's view-options
          * sliders beside it. */}
        <ListFilter size={12} aria-hidden="true" />
        <span className="task-summary-button__short" aria-hidden="true">{parts[0]}</span>
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
          {savedViews && savedViews.views.length > 0 && (
            <div className="task-view-sheet__section">
              <span className="task-view-sheet__label" id="task-view-sheet-saved">Saved view</span>
              <div className="task-view-sheet__views" role="group" aria-labelledby="task-view-sheet-saved">
                {savedViews.views.map((view) => {
                  const active = view.id === savedViews.currentId;
                  return (
                    <button
                      key={view.id}
                      type="button"
                      className={`task-view-sheet__view${active ? " is-active" : ""}`}
                      aria-pressed={active}
                      onClick={() => { savedViews.onPick(view.id); setOpen(false); }}
                    >
                      <span>{view.name}</span>
                      {active && <Check size={14} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
