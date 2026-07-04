import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { daysUntil, isGeneralMeeting } from "../lib/noticeWindow";
import {
  MeetingFormFields,
  blankMeetingDraft,
  makeMeetingDraft,
  numberOrUndefined,
  useMeetingFormData,
  type MeetingDraft,
} from "./MeetingFormFields";

/**
 * Global "Schedule meeting" popup — same meeting form the Meetings page uses,
 * presented as a centered dialog so the command-palette / quick action can pop
 * it from anywhere. Navigates to the new meeting on success.
 */
export function MeetingCreateModal({
  open,
  onClose,
  societyId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  societyId: Id<"societies">;
  onCreated?: (meetingId: Id<"meetings">) => void;
}) {
  const create = useMutation(api.meetings.create);
  const toast = useToast();
  const navigate = useNavigate();
  // Seed the draft synchronously (non-null) so the resizable dialog measures the
  // full form height on open, rather than an empty body.
  const [form, setForm] = useState<MeetingDraft>(() => blankMeetingDraft());
  const data = useMeetingFormData(societyId, open ? form.scheduledAt : undefined);
  const [saving, setSaving] = useState(false);

  // Refresh the draft when the dialog opens. Re-run once the default template /
  // notice window load so the fresh draft reflects them.
  useEffect(() => {
    if (open) {
      setForm(makeMeetingDraft(data));
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data.defaultTemplate?._id, data.noticeMinDays, data.rules?.allowElectronicMeetings]);

  const save = async () => {
    if (isGeneralMeeting(form.type)) {
      const days = daysUntil(form.scheduledAt);
      if (days == null || days < data.effectiveNoticeMinDays) {
        toast.error(`General meetings need at least ${data.effectiveNoticeMinDays} days of notice.`);
        return;
      }
    }
    setSaving(true);
    try {
      const meetingId = await create({
        societyId,
        ...form,
        meetingTemplateId: form.meetingTemplateId || undefined,
        quorumRequired: numberOrUndefined(form.quorumRequired),
      });
      toast.success("Meeting scheduled", form.title);
      onClose();
      if (meetingId) {
        onCreated?.(meetingId as Id<"meetings">);
        navigate(`/app/meetings/${meetingId}`);
      }
    } catch (error: any) {
      toast.error("Could not schedule meeting", error?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule meeting"
      size="lg"
      resizeKey="meeting-create"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--accent" type="button" onClick={save} disabled={saving}>
            {saving ? "Scheduling…" : "Schedule"}
          </button>
        </>
      }
    >
      <MeetingFormFields
        value={form}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        data={data}
      />
    </Modal>
  );
}
