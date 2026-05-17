/**
 * Global quick-create task modal. Listens for the
 * `quickaction:add-task` window event and opens a centered popup that
 * persists straight to the tasks board — same popup style as the command
 * palette's other quick actions (e.g. DraftMinutesPicker).
 *
 * Mounted once in Layout so the command palette's "Add task" command (and
 * any other caller) can pop this from anywhere in the app.
 */
import { useEffect, useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { TaskCreateModal } from "../features/tasks/TaskCreateModal";

export const OPEN_TASK_CREATE_EVENT = "quickaction:add-task";

export function openGlobalTaskCreate() {
  window.dispatchEvent(new Event(OPEN_TASK_CREATE_EVENT));
}

export function GlobalTaskCreate() {
  const society = useSociety();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_TASK_CREATE_EVENT, handler);
    return () => window.removeEventListener(OPEN_TASK_CREATE_EVENT, handler);
  }, []);

  if (!society) return null;

  return (
    <TaskCreateModal
      open={open}
      onClose={() => setOpen(false)}
      societyId={society._id}
    />
  );
}
