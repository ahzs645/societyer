import { Lock } from "lucide-react";
import { EmptyState } from "../../../components/ui";

/**
 * Why the Transcript tab can't show this meeting's working transcript.
 * `permission`: the role doesn't keep the minutes (decision A1).
 * `in_camera`: an in-camera session isn't marked in the recording, so the
 * transcript can't be shown without it (only reachable by a reader who may
 * read transcripts but not in-camera content).
 */
export type TranscriptAccess = "permission" | "in_camera";

const DESCRIPTIONS: Record<TranscriptAccess, string> = {
  permission: "Transcripts are available to people who keep the minutes. Read the minutes for the record.",
  in_camera: "This meeting had an in-camera session that isn't marked in the recording, so the transcript can't be shown without it. Read the minutes for the record.",
};

export function TranscriptAccessNotice({ reason, onReadMinutes }: { reason: TranscriptAccess; onReadMinutes?: () => void }) {
  return (
    <div role="status">
      <EmptyState
        icon={<Lock size={20} aria-hidden="true" />}
        title="Transcript not available"
        description={DESCRIPTIONS[reason]}
        action={onReadMinutes ? (
          <button type="button" className="btn btn--sm" onClick={onReadMinutes}>
            Read the minutes
          </button>
        ) : undefined}
      />
    </div>
  );
}
