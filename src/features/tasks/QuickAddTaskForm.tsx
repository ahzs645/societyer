import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { TASK_PRIORITIES } from "./TaskFormFields";

const STATUS_OPTIONS = [
  { id: "Todo", label: "To do" },
  { id: "InProgress", label: "In progress" },
  { id: "Blocked", label: "Blocked" },
  { id: "Done", label: "Done" },
];

export type QuickAddTaskInput = {
  title: string;
  priority: string;
  status: string;
  dueDate?: string;
};

export function QuickAddTaskForm({
  onSubmit,
  onCreated,
  defaultStatus = "Todo",
  defaultPriority = "Medium",
  triggerLabel = "Create task",
}: {
  onSubmit: (input: QuickAddTaskInput) => Promise<string | void | undefined> | string | void | undefined;
  onCreated?: (taskId: string) => void;
  defaultStatus?: string;
  defaultPriority?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<QuickAddTaskInput>({
    title: "",
    priority: defaultPriority,
    status: defaultStatus,
    dueDate: "",
  });

  const reset = () =>
    setDraft({ title: "", priority: defaultPriority, status: defaultStatus, dueDate: "" });

  const submit = async () => {
    const title = draft.title.trim();
    if (!title) return;
    const result = await onSubmit({
      title,
      priority: draft.priority,
      status: draft.status,
      dueDate: draft.dueDate || undefined,
    });
    if (typeof result === "string" && onCreated) onCreated(result);
    reset();
  };

  return (
    <div className="quick-add-task">
      <button
        className="btn-action"
        type="button"
        onClick={() => {
          setOpen((value) => {
            if (value) reset();
            return !value;
          });
        }}
      >
        {open ? <X size={12} /> : <Plus size={12} />}
        {open ? "Cancel" : triggerLabel}
      </button>
      {open && (
        <div className="quick-add-task__form">
          <input
            className="input"
            placeholder="Task title (Enter to add)"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.title.trim()) {
                event.preventDefault();
                void submit();
              }
            }}
            autoFocus
          />
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ width: 130 }}>
              <Select
                value={draft.priority}
                onChange={(value) => setDraft({ ...draft, priority: value })}
                options={TASK_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
                placeholder="Priority"
              />
            </div>
            <div style={{ width: 150 }}>
              <Select
                value={draft.status}
                onChange={(value) => setDraft({ ...draft, status: value })}
                options={STATUS_OPTIONS.map((status) => ({ value: status.id, label: status.label }))}
                placeholder="Status"
              />
            </div>
            <div style={{ width: 160 }}>
              <DatePicker
                value={draft.dueDate ?? ""}
                onChange={(value) => setDraft({ ...draft, dueDate: value })}
                placeholder="Due date"
              />
            </div>
            <button
              className="btn-action btn-action--primary"
              type="button"
              onClick={submit}
              disabled={!draft.title.trim()}
            >
              <Plus size={12} /> Add task
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
