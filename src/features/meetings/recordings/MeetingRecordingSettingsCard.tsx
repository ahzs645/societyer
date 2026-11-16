/**
 * Settings → Runtime: whether this workspace keeps meeting recordings, and
 * where they go here (shared/meetingRecordingStorage.ts). Where is decided by
 * the workspace's storage (SharePoint, workspace file storage, this computer
 * in the desktop app); administrators choose whether to keep them at all.
 */
import { useState } from "react";
import { AudioLines } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "@/hooks/useSociety";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { RadioGroup } from "@/components/Controls";
import { Badge } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { meetingRecordingRuntime, useMeetingRecordingStore } from "./workspaceRecordings";
import { meetingRecordingStore, type MeetingRecordingPreference } from "../../../../shared/meetingRecordingStorage";
import { meetingSourceBroker } from "../../../lib/meetingSourceUpload";

export function MeetingRecordingSettingsCard() {
  const society = useSociety();
  const { can } = usePermissions();
  const toast = useToast();
  const canEdit = can("settings:write");
  const current = useMeetingRecordingStore(society?._id ? String(society._id) : undefined);
  const setPreference = usePermissionedMutation(api.meetingRecordings.setPreference, canEdit);
  const [saving, setSaving] = useState(false);
  if (!society || !current) return null;

  // What "keep" would mean here, so the choice says where recordings would go.
  const ifKept = meetingRecordingStore({
    runtime: meetingRecordingRuntime(),
    preference: "keep",
    policy: current.settings.policy,
    sharePointBroker: Boolean(meetingSourceBroker),
  });

  const choose = async (preference: MeetingRecordingPreference) => {
    if (!canEdit || preference === current.settings.preference) return;
    setSaving(true);
    try {
      await setPreference({ societyId: society._id, preference });
      toast.success(
        preference === "keep" ? "Recordings will be kept" : "Transcripts only",
        preference === "keep" ? ifKept.detail : "Recordings already saved stay until someone removes them.",
      );
    } catch (error) {
      toast.error("Could not change the setting", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <AudioLines size={14} aria-hidden="true" /> Meeting recordings
        </h2>
        <Badge tone={current.store === "none" ? "neutral" : "success"}>{current.label}</Badge>
      </div>
      <div className="card__body col" style={{ gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>{current.detail}</p>
        <RadioGroup<MeetingRecordingPreference>
          name="meeting-recording-preference"
          value={current.settings.preference}
          onChange={(value) => { void choose(value); }}
          options={[
            {
              value: "keep",
              label: "Keep recordings",
              hint: ifKept.store === "none" ? `Not available here: ${ifKept.detail}` : `Saved to ${ifKept.label === "SharePoint" ? "SharePoint" : ifKept.label.toLowerCase()}. Meeting editors can play, download and transcribe them.`,
              disabled: !canEdit || saving,
            },
            {
              value: "transcripts_only",
              label: "Transcripts only",
              hint: "Recordings are opened from the device to play or transcribe, and never saved. Suits workspaces that don't retain audio.",
              disabled: !canEdit || saving,
            },
          ]}
        />
        {!canEdit && <p className="muted" style={{ margin: 0 }}>An administrator can change this.</p>}
      </div>
    </div>
  );
}
