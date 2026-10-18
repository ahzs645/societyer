import { Loader2, X } from "lucide-react";
import { cancelDeviceDraft, deviceDraftLabel, useDeviceDraftProgress } from "../deviceDraftProgress";

/**
 * "Drafting part 2 of 4…" with Cancel, wherever an on-device minutes draft
 * can be started. Renders nothing unless this meeting has a draft running on
 * this device (server drafts cannot be cancelled).
 */
export function DeviceDraftStatus({ meetingId, className }: { meetingId: string; className?: string }) {
  const progress = useDeviceDraftProgress(meetingId);
  if (!progress) return null;
  return (
    <div className={`device-draft-status${className ? ` ${className}` : ""}`}>
      <Loader2 size={14} className="spin" aria-hidden="true" />
      <span role="status">{deviceDraftLabel(progress)}</span>
      <button type="button" className="btn-action" onClick={cancelDeviceDraft}>
        <X size={14} aria-hidden="true" />
        Cancel
      </button>
    </div>
  );
}
