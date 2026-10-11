import { useState } from "react";
import { AlarmClock, CheckCircle2, OctagonAlert } from "lucide-react";
import { Tabs } from "../../components/primitives";
import { NotesPanel } from "../../components/NotesPanel";
import { ActivityTimeline } from "../../components/ActivityTimeline";
import { relative } from "../../lib/format";
import { dueInfo, type TaskRecord } from "./taskModel";

/** The one thing to know before editing: overdue, blocked or already done. */
export function TaskStateBanner({
  task,
  canManage,
  onReopen,
  onRescheduleToday,
}: {
  task: TaskRecord;
  canManage: boolean;
  onReopen: () => void;
  onRescheduleToday: () => void;
}) {
  if (task.status === "Done") {
    return (
      <div className="task-banner task-banner--done" role="status">
        <CheckCircle2 size={14} aria-hidden="true" />
        <span>
          Completed {task.completedAt ? relative(task.completedAt) : ""}
          {task.completedByUserIdLabel ? ` by ${task.completedByUserIdLabel}` : ""}.
        </span>
        {canManage && <button type="button" className="task-banner__action" onClick={onReopen}>Reopen</button>}
      </div>
    );
  }
  const due = dueInfo(task.dueDate, task.status);
  if (due?.tone === "overdue" && due.days !== null) {
    return (
      <div className="task-banner task-banner--overdue" role="status">
        <AlarmClock size={14} aria-hidden="true" />
        <span>Overdue by {-due.days} day{due.days === -1 ? "" : "s"}.</span>
        {canManage && <button type="button" className="task-banner__action" onClick={onRescheduleToday}>Move to today</button>}
      </div>
    );
  }
  if (task.status === "Blocked") {
    return (
      <div className="task-banner task-banner--blocked" role="status">
        <OctagonAlert size={14} aria-hidden="true" />
        <span>Blocked. Note what it is waiting on below so the next person can pick it up.</span>
      </div>
    );
  }
  return null;
}

type DetailTab = "notes" | "activity";

/** Discussion and history for an existing task, under the form. */
export function TaskDiscussion({ taskId }: { taskId: string }) {
  const [tab, setTab] = useState<DetailTab>("notes");
  return (
    <section className="task-discussion">
      <Tabs<DetailTab>
        value={tab}
        onChange={setTab}
        tabRoles
        ariaLabel="Task notes and activity"
        items={[
          { id: "notes", label: "Notes" },
          { id: "activity", label: "Activity" },
        ]}
      />
      <div className="task-discussion__body">
        {tab === "notes" ? <NotesPanel entityType="task" entityId={taskId} /> : <ActivityTimeline entityType="task" entityId={taskId} limit={50} />}
      </div>
    </section>
  );
}
