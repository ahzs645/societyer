import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import {
  TaskFormFields,
  makeTaskFormDefaults,
  useTaskFormData,
  type TaskFormValue,
} from "./TaskFormFields";

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

export function TaskCreateModal({
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

  // Always load dropdown sources — small lists, and avoids "no options"
  // flicker the first time the modal opens.
  const data = useTaskFormData(societyId);

  const [form, setForm] = useState<TaskFormValue>(() => makeTaskFormDefaults(initialValues));
  const [saving, setSaving] = useState(false);

  // Reset the form whenever the modal is reopened. The deps deliberately
  // exclude `initialValues` itself — most callers pass a new object each
  // render, which would otherwise wipe the user's edits while they're typing.
  useEffect(() => {
    if (open) {
      setForm(makeTaskFormDefaults(initialValues));
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
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      size="md"
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
      <TaskFormFields
        value={form}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        data={data}
        mode="create"
      />
    </Modal>
  );
}
