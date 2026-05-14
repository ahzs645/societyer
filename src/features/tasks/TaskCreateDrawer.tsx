import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";

const STATUSES = ["Todo", "InProgress", "Blocked", "Done"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

export type TaskCreateInitialValues = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  dueDate?: string;
  responsibleUserId?: string;
  committeeId?: Id<"committees">;
  goalId?: Id<"goals">;
  meetingId?: Id<"meetings">;
  filingId?: Id<"filings">;
  workflowId?: Id<"workflows">;
  documentId?: Id<"documents">;
  commitmentId?: Id<"commitments">;
  eventId?: string;
};

type FormState = {
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
};

function makeDefaults(initial?: TaskCreateInitialValues): FormState {
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
  };
}

export function TaskCreateDrawer({
  open,
  onClose,
  societyId,
  initialValues,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  societyId: Id<"societies">;
  initialValues?: TaskCreateInitialValues;
  onCreated?: (taskId: Id<"tasks">) => void;
}) {
  const create = useMutation(api.tasks.create);
  const toast = useToast();

  // Dropdown sources. Always load — small lists, and avoids "no options" flicker
  // the first time the drawer opens.
  const committees = useQuery(api.committees.list, { societyId });
  const goals = useQuery(api.goals.list, { societyId });
  const users = useQuery(api.users.list, { societyId });
  const filings = useQuery(api.filings.list, { societyId });
  const workflows = useQuery(api.workflows.list, { societyId });
  const documents = useQuery(api.documents.list, { societyId });
  const commitments = useQuery(api.commitments.list, { societyId });

  const [form, setForm] = useState<FormState>(() => makeDefaults(initialValues));
  const [saving, setSaving] = useState(false);

  // Reset the form whenever the drawer is reopened. The deps deliberately
  // exclude `initialValues` itself — most callers pass a new object each
  // render, which would otherwise wipe the user's edits while they're typing.
  useEffect(() => {
    if (open) {
      setForm(makeDefaults(initialValues));
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    const title = form.title.trim();
    if (!title) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const id = await create({
        societyId,
        title,
        description: form.description || undefined,
        status: form.status,
        priority: form.priority,
        assignee: form.assignee || undefined,
        responsibleUserIds: form.responsibleUserId
          ? [form.responsibleUserId as Id<"users">]
          : undefined,
        dueDate: form.dueDate || undefined,
        committeeId: (form.committeeId || undefined) as Id<"committees"> | undefined,
        goalId: (form.goalId || undefined) as Id<"goals"> | undefined,
        meetingId: (form.meetingId || undefined) as Id<"meetings"> | undefined,
        filingId: (form.filingId || undefined) as Id<"filings"> | undefined,
        workflowId: (form.workflowId || undefined) as Id<"workflows"> | undefined,
        documentId: (form.documentId || undefined) as Id<"documents"> | undefined,
        commitmentId: (form.commitmentId || undefined) as Id<"commitments"> | undefined,
        eventId: form.eventId || undefined,
        tags: [],
      });
      toast.success("Task created", title);
      onCreated?.(id as Id<"tasks">);
      onClose();
    } catch (error: any) {
      toast.error("Could not create task", error?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New task"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--accent" onClick={save} disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      <div>
        <Field label="Title">
          <input
            className="input"
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Description">
          <textarea
            className="textarea"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={STATUSES.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={form.priority}
              onChange={(v) => setForm({ ...form, priority: v })}
              options={PRIORITIES.map((p) => ({ value: p, label: p }))}
            />
          </Field>
          <Field label="Due">
            <DatePicker
              value={form.dueDate}
              onChange={(v) => setForm({ ...form, dueDate: v })}
            />
          </Field>
        </div>
        <Field label="Assignee">
          <input
            className="input"
            value={form.assignee}
            onChange={(e) => setForm({ ...form, assignee: e.target.value })}
          />
        </Field>
        <Field label="Responsible user">
          <Select
            value={form.responsibleUserId}
            onChange={(v) => setForm({ ...form, responsibleUserId: v })}
            clearable
            searchable
            options={(users ?? []).map((u: any) => ({ value: u._id, label: u.displayName }))}
          />
        </Field>
        <Field label="Committee (optional)">
          <Select
            value={form.committeeId}
            onChange={(v) => setForm({ ...form, committeeId: v })}
            clearable
            searchable
            options={(committees ?? []).map((c: any) => ({ value: c._id, label: c.name }))}
          />
        </Field>
        <Field label="Goal (optional)">
          <Select
            value={form.goalId}
            onChange={(v) => setForm({ ...form, goalId: v })}
            clearable
            searchable
            options={(goals ?? []).map((g: any) => ({ value: g._id, label: g.title }))}
          />
        </Field>
        <Field label="Filing (optional)">
          <Select
            value={form.filingId}
            onChange={(v) => setForm({ ...form, filingId: v })}
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
            value={form.workflowId}
            onChange={(v) => setForm({ ...form, workflowId: v })}
            clearable
            searchable
            options={(workflows ?? []).map((w: any) => ({ value: w._id, label: w.name }))}
          />
        </Field>
        <Field label="Document (optional)">
          <Select
            value={form.documentId}
            onChange={(v) => setForm({ ...form, documentId: v })}
            clearable
            searchable
            options={(documents ?? []).map((d: any) => ({ value: d._id, label: d.title }))}
          />
        </Field>
        <Field label="Commitment (optional)">
          <Select
            value={form.commitmentId}
            onChange={(v) => setForm({ ...form, commitmentId: v })}
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
            value={form.eventId}
            onChange={(e) => setForm({ ...form, eventId: e.target.value })}
            placeholder="custom.event or imported event id"
          />
        </Field>
      </div>
    </Drawer>
  );
}
