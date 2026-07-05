import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import {
  CommitmentFormFields,
  commitmentPayload,
  makeCommitmentFormDefaults,
  useCommitmentFormData,
  type CommitmentFormInitialValues,
  type CommitmentFormValue,
} from "./CommitmentFormFields";

export function CommitmentCreateModal({
  open,
  onClose,
  societyId,
  initialValues,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  societyId: Id<"societies">;
  initialValues?: CommitmentFormInitialValues;
  onCreated?: (commitmentId: Id<"commitments">) => void;
}) {
  const create = useMutation(api.commitments.create);
  const toast = useToast();

  // Always load dropdown sources — small lists, avoids "no options" flicker the
  // first time the modal opens.
  const data = useCommitmentFormData(societyId);

  const [form, setForm] = useState<CommitmentFormValue>(() => makeCommitmentFormDefaults(initialValues));
  const [saving, setSaving] = useState(false);

  // Reset the form whenever the modal is reopened. The deps deliberately
  // exclude `initialValues` — most callers pass a new object each render, which
  // would otherwise wipe the user's edits while they're typing.
  useEffect(() => {
    if (open) {
      setForm(makeCommitmentFormDefaults(initialValues));
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
    if (!form.requirement.trim()) {
      toast.error("Requirement is required");
      return;
    }
    setSaving(true);
    try {
      const id = await create({ societyId, ...commitmentPayload(form) });
      toast.success("Commitment added", title);
      onCreated?.(id as Id<"commitments">);
      onClose();
    } catch (error: any) {
      toast.error("Could not create commitment", error?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New commitment"
      size="md"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn--accent"
            onClick={save}
            disabled={saving || !form.title.trim() || !form.requirement.trim()}
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      <CommitmentFormFields
        value={form}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        data={data}
        autoFocusTitle
      />
    </Modal>
  );
}
