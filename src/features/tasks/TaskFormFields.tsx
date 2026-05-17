/**
 * Shared task form fields + form-state utilities.
 *
 * Single source of truth for the task create/edit schema. Every surface that
 * captures a task (the popup TaskCreateDrawer launched from the command
 * palette, the inline drawer on the Tasks page, and any future caller) renders
 * these same fields so the shape and parity are guaranteed.
 *
 * Surfaces own their own form state and pass a `value` + `onChange` patch
 * callback — this component is presentational. Status/priority constants and
 * the dropdown-data hook live here too so callers never re-declare them.
 */
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Field } from "../../components/ui";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { formatDate } from "../../lib/format";

export const TASK_STATUSES = ["Todo", "InProgress", "Blocked", "Done"] as const;
export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

export type TaskFormValue = {
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee: string;
  dueDate: string;
  responsibleUserId: string;
  committeeId: string;
  goalId: string;
  meetingId: string;
  filingId: string;
  workflowId: string;
  documentId: string;
  commitmentId: string;
  eventId: string;
  completionNote: string;
};

export type TaskFormInitialValues = Partial<TaskFormValue>;

export function makeTaskFormDefaults(initial?: TaskFormInitialValues): TaskFormValue {
  return {
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    status: initial?.status ?? "Todo",
    priority: initial?.priority ?? "Medium",
    assignee: initial?.assignee ?? "",
    dueDate: initial?.dueDate ?? "",
    responsibleUserId: initial?.responsibleUserId ?? "",
    committeeId: initial?.committeeId ?? "",
    goalId: initial?.goalId ?? "",
    meetingId: initial?.meetingId ?? "",
    filingId: initial?.filingId ?? "",
    workflowId: initial?.workflowId ?? "",
    documentId: initial?.documentId ?? "",
    commitmentId: initial?.commitmentId ?? "",
    eventId: initial?.eventId ?? "",
    completionNote: initial?.completionNote ?? "",
  };
}

export type TaskFormData = {
  committees: any[] | undefined;
  goals: any[] | undefined;
  users: any[] | undefined;
  filings: any[] | undefined;
  workflows: any[] | undefined;
  documents: any[] | undefined;
  commitments: any[] | undefined;
};

/** Load every dropdown source the task form needs. Centralized so callers
 * never miss one and every surface sees the same option set. Accepts a
 * nullable societyId so callers can call this above an early-return for
 * still-loading workspaces without violating hook ordering. */
export function useTaskFormData(societyId: Id<"societies"> | null | undefined): TaskFormData {
  const args = societyId ? { societyId } : "skip";
  const committees = useQuery(api.committees.list, args);
  const goals = useQuery(api.goals.list, args);
  const users = useQuery(api.users.list, args);
  const filings = useQuery(api.filings.list, args);
  const workflows = useQuery(api.workflows.list, args);
  const documents = useQuery(api.documents.list, args);
  const commitments = useQuery(api.commitments.list, args);
  return { committees, goals, users, filings, workflows, documents, commitments };
}

export function TaskFormFields({
  value,
  onChange,
  data,
  mode = "create",
  autoFocusTitle = true,
}: {
  value: TaskFormValue;
  onChange: (patch: Partial<TaskFormValue>) => void;
  data: TaskFormData;
  /** "edit" reveals the completion-note field — only meaningful for tasks
   * that already exist. */
  mode?: "create" | "edit";
  autoFocusTitle?: boolean;
}) {
  const { committees, goals, users, filings, workflows, documents, commitments } = data;
  return (
    <div>
      <Field label="Title">
        <input
          className="input"
          autoFocus={autoFocusTitle}
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>
      <Field label="Description">
        <MarkdownEditor
          rows={4}
          value={value.description}
          onChange={(markdown) => onChange({ description: markdown })}
        />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Status">
          <Select
            value={value.status}
            onChange={(v) => onChange({ status: v })}
            options={TASK_STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </Field>
        <Field label="Priority">
          <Select
            value={value.priority}
            onChange={(v) => onChange({ priority: v })}
            options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
        </Field>
        <Field label="Due">
          <DatePicker
            value={value.dueDate}
            onChange={(v) => onChange({ dueDate: v })}
          />
        </Field>
      </div>
      <Field label="Assignee">
        <input
          className="input"
          value={value.assignee}
          onChange={(e) => onChange({ assignee: e.target.value })}
        />
      </Field>
      <Field label="Responsible user">
        <Select
          value={value.responsibleUserId}
          onChange={(v) => onChange({ responsibleUserId: v })}
          clearable
          searchable
          options={(users ?? []).map((u: any) => ({ value: u._id, label: u.displayName }))}
        />
      </Field>
      <Field label="Committee (optional)">
        <Select
          value={value.committeeId}
          onChange={(v) => onChange({ committeeId: v })}
          clearable
          searchable
          options={(committees ?? []).map((c: any) => ({ value: c._id, label: c.name }))}
        />
      </Field>
      <Field label="Goal (optional)">
        <Select
          value={value.goalId}
          onChange={(v) => onChange({ goalId: v })}
          clearable
          searchable
          options={(goals ?? []).map((g: any) => ({ value: g._id, label: g.title }))}
        />
      </Field>
      <Field label="Filing (optional)">
        <Select
          value={value.filingId}
          onChange={(v) => onChange({ filingId: v })}
          clearable
          searchable
          options={(filings ?? []).map((f: any) => ({
            value: f._id,
            label: `${f.kind}${f.periodLabel ? ` - ${f.periodLabel}` : ""}`,
          }))}
        />
      </Field>
      <Field label="Workflow (optional)">
        <Select
          value={value.workflowId}
          onChange={(v) => onChange({ workflowId: v })}
          clearable
          searchable
          options={(workflows ?? []).map((w: any) => ({ value: w._id, label: w.name }))}
        />
      </Field>
      <Field label="Document (optional)">
        <Select
          value={value.documentId}
          onChange={(v) => onChange({ documentId: v })}
          clearable
          searchable
          options={(documents ?? []).map((d: any) => ({ value: d._id, label: d.title }))}
        />
      </Field>
      <Field label="Commitment (optional)">
        <Select
          value={value.commitmentId}
          onChange={(v) => onChange({ commitmentId: v })}
          clearable
          searchable
          options={(commitments ?? []).map((c: any) => ({
            value: c._id,
            label: c.title,
            hint: c.nextDueDate ? `Due ${formatDate(c.nextDueDate)}` : c.status,
          }))}
        />
      </Field>
      <Field label="Event ID (optional)">
        <input
          className="input mono"
          value={value.eventId}
          onChange={(e) => onChange({ eventId: e.target.value })}
          placeholder="custom.event or imported event id"
        />
      </Field>
      {mode === "edit" && (
        <Field label="Completion note">
          <MarkdownEditor
            rows={4}
            value={value.completionNote}
            onChange={(markdown) => onChange({ completionNote: markdown })}
            placeholder="Evidence captured, filed confirmation, or blocker resolution."
          />
        </Field>
      )}
    </div>
  );
}
