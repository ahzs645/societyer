import { useState } from "react";
import { Pencil, Save } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { useToast } from "@/components/Toast";
import { StructuredMinutesEditor, StructuredMinutesSummary } from "./MeetingDetailSupport";
import { structuredEditFromMinutes, structuredMetadataChanges, type StructuredMinutesEdit } from "../lib/structuredMinutes";

export function MinutesMetadataCard({ minutes, meetingType }: { minutes: any; meetingType: string }) {
  const { can } = usePermissions();
  const canWrite = can("minutes:write");
  const update = usePermissionedMutation(api.minutes.update, canWrite);
  const toast = useToast();
  const [draft, setDraft] = useState<StructuredMinutesEdit | null>(null);
  const [original, setOriginal] = useState<StructuredMinutesEdit | null>(null);
  const [saving, setSaving] = useState(false);
  if (!minutes) return null;

  const save = async () => {
    if (!canWrite || !draft || !original || saving) return;
    setSaving(true);
    try {
      // Only submit fields the user edited. Untouched source arrays may contain
      // richer values than the legacy pipe-row editor can represent.
      const patch = structuredMetadataChanges(draft, original);
      if (Object.keys(patch).length) await update({ id: minutes._id, patch });
      setDraft(null);
      setOriginal(null);
      toast.success("Minutes details saved");
    } catch (error) {
      toast.error("Could not save minutes details", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Minutes details</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {draft && canWrite ? <>
            <button className="btn-action" disabled={saving} onClick={() => { setDraft(null); setOriginal(null); }}>Cancel</button>
            <button className="btn-action btn-action--primary" disabled={saving} onClick={() => { void save(); }}><Save size={12} /> {saving ? "Saving..." : "Save details"}</button>
          </> : canWrite && <button className="btn-action" onClick={() => { const value = structuredEditFromMinutes(minutes); setOriginal(value); setDraft(value); }}><Pencil size={12} /> Edit details</button>}
        </div>
      </div>
      <div className="card__body">
        {draft && canWrite
          ? <StructuredMinutesEditor value={draft} onChange={setDraft} isAgm={meetingType === "AGM"} includeRecordArrays={false} />
          : <StructuredMinutesSummary minutes={minutes} />}
      </div>
    </div>
  );
}
