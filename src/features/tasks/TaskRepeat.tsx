/**
 * Repeating tasks in the interface: the "Repeats" control in the task form,
 * the small repeat badge on list rows and board cards, and the helpers that
 * turn the form's text fields into the rule the server stores
 * (`shared/taskRecurrence.ts`).
 */
import { Repeat2 } from "lucide-react";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { formatDate, formatShortDate } from "../../lib/format";
import {
  MAX_TASK_RECURRENCE_INTERVAL,
  describeTaskRecurrence,
  isIsoDay,
  isTaskRecurrenceFrequency,
  nextTaskOccurrence,
  type TaskRecurrence,
  type TaskRecurrenceFrequency,
} from "../../../shared/taskRecurrence";

/** The form keeps the rule as text so drafts stay plain strings. */
export type TaskRepeatChoice = "none" | TaskRecurrenceFrequency | "custom";
export type TaskRepeatFormValue = {
  /** "none", a frequency, or "custom" for every N of a unit. */
  repeat: string;
  repeatInterval: string;
  repeatUnit: string;
  repeatUntil: string;
};

const REPEAT_OPTIONS: { value: TaskRepeatChoice; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
];

const UNIT_OPTIONS: { value: TaskRecurrenceFrequency; label: string }[] = [
  { value: "daily", label: "days" },
  { value: "weekly", label: "weeks" },
  { value: "monthly", label: "months" },
  { value: "yearly", label: "years" },
];

function isRepeatChoice(value: string): value is TaskRepeatChoice {
  return REPEAT_OPTIONS.some((option) => option.value === value);
}

/** The form fields for a stored rule (or none). */
export function repeatFormDefaults(recurrence?: TaskRecurrence | null): TaskRepeatFormValue {
  if (!recurrence || !isTaskRecurrenceFrequency(recurrence.frequency)) {
    return { repeat: "none", repeatInterval: "2", repeatUnit: "weekly", repeatUntil: "" };
  }
  const custom = recurrence.interval > 1;
  return {
    repeat: custom ? "custom" : recurrence.frequency,
    repeatInterval: String(custom ? recurrence.interval : 2),
    repeatUnit: recurrence.frequency,
    repeatUntil: recurrence.until ?? "",
  };
}

/**
 * The rule to send for the form: null for "Does not repeat". The server fills
 * in the anchor day and validates the rest.
 */
export function recurrenceFromForm(value: TaskRepeatFormValue): TaskRecurrence | null {
  if (!isRepeatChoice(value.repeat) || value.repeat === "none") return null;
  const frequency: TaskRecurrenceFrequency = value.repeat === "custom"
    ? (isTaskRecurrenceFrequency(value.repeatUnit) ? value.repeatUnit : "weekly")
    : value.repeat;
  const parsed = Number(value.repeatInterval);
  const interval = value.repeat === "custom" && Number.isInteger(parsed) ? parsed : 1;
  return { frequency, interval, ...(value.repeatUntil ? { until: value.repeatUntil } : {}) };
}

/** When the next one is due after completing `task` today, or null when the series ends. */
export function nextOccurrenceDueDate(task: { dueDate?: string | null; recurrence?: TaskRecurrence | null }, today: string): string | null {
  if (!task.recurrence || !isIsoDay(task.dueDate)) return null;
  return nextTaskOccurrence({ dueDate: task.dueDate }, task.recurrence, { today })?.dueDate ?? null;
}

/** "Next one due Mar 31." for the completion toast. */
export function nextOccurrenceMessage(task: { dueDate?: string | null; recurrence?: TaskRecurrence | null }, today: string): string | null {
  if (!task.recurrence) return null;
  const next = nextOccurrenceDueDate(task, today);
  return next ? `Next one due ${formatShortDate(next, today)}.` : "That was the last one.";
}

/** The "Repeats" control: a choice, "every N unit" for Custom, and an optional end date. */
export function TaskRepeatField({
  value,
  dueDate,
  onChange,
  readOnly = false,
}: {
  value: TaskRepeatFormValue;
  dueDate: string;
  onChange: (patch: Partial<TaskRepeatFormValue>) => void;
  readOnly?: boolean;
}) {
  const repeating = value.repeat !== "none" && isRepeatChoice(value.repeat);
  const intervalNumber = Number(value.repeatInterval);
  const intervalInvalid = value.repeat === "custom"
    && !(Number.isInteger(intervalNumber) && intervalNumber >= 1 && intervalNumber <= MAX_TASK_RECURRENCE_INTERVAL);
  const needsDate = repeating && !isIsoDay(dueDate);
  const untilInvalid = repeating && Boolean(value.repeatUntil) && isIsoDay(dueDate) && value.repeatUntil < dueDate;
  return (
    <div className="row task-repeat" data-task-repeat>
      <Field
        label="Repeats"
        hint={repeating && !needsDate ? "The next one is created when this one is done." : undefined}
        error={needsDate ? "Add a due date to make this task repeat." : undefined}
      >
        <Select
          value={isRepeatChoice(value.repeat) ? value.repeat : "none"}
          onChange={(repeat) => onChange({ repeat })}
          options={REPEAT_OPTIONS}
          disabled={readOnly}
          aria-invalid={needsDate || undefined}
        />
      </Field>
      {value.repeat === "custom" && (
        <Field label="Every" error={intervalInvalid ? `Use a whole number from 1 to ${MAX_TASK_RECURRENCE_INTERVAL}.` : undefined}>
          <div className="row row--nowrap task-repeat__every">
            <input
              className="input task-repeat__interval"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_TASK_RECURRENCE_INTERVAL}
              step={1}
              aria-label="Repeat every"
              aria-invalid={intervalInvalid || undefined}
              value={value.repeatInterval}
              disabled={readOnly}
              onChange={(event) => onChange({ repeatInterval: event.target.value })}
            />
            <Select
              value={isTaskRecurrenceFrequency(value.repeatUnit) ? value.repeatUnit : "weekly"}
              onChange={(repeatUnit) => onChange({ repeatUnit })}
              options={UNIT_OPTIONS}
              disabled={readOnly}
              aria-label="Repeat unit"
            />
          </div>
        </Field>
      )}
      {repeating && (
        <Field label="Ends (optional)" error={untilInvalid ? "The end date can't be before the due date." : undefined}>
          <DatePicker
            value={value.repeatUntil}
            onChange={(repeatUntil) => onChange({ repeatUntil })}
            placeholder="Never"
            min={isIsoDay(dueDate) ? dueDate : undefined}
            disabled={readOnly}
            aria-invalid={untilInvalid || undefined}
          />
        </Field>
      )}
    </div>
  );
}

/** A small repeat mark for list rows and board cards. */
export function TaskRepeatBadge({ recurrence }: { recurrence?: TaskRecurrence | null }) {
  if (!recurrence || !isTaskRecurrenceFrequency(recurrence.frequency)) return null;
  const label = `Repeats: ${describeTaskRecurrence(recurrence, (day) => formatDate(day))}`;
  return (
    <span className="task-repeat-badge" title={label} aria-label={label} role="img">
      <Repeat2 size={12} aria-hidden="true" />
    </span>
  );
}
