import { useCallback, useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { IN_CAMERA_TITLE, inCameraRecordingRanges, inCameraSessionChoices } from "../../../../shared/minutesPrivacy";
import type { TranscriptRef } from "../../../../shared/transcriptModel";
import { usePermissionedMutation } from "../../../hooks/usePermissionedMutation";
import { usePermissions } from "../../../hooks/usePermissions";
import { formatTranscriptTime } from "./activeIndex";

/** An in-camera session the editor can mark, with its range when it has one. */
export type InCameraChoice = { title: string; startSec?: number; endSec?: number };
/** A marked session, as the scrubber band and the transcript divider show it. */
export type InCameraMark = { title: string; startSec: number; endSec: number };
/** `null` adds a new "In-camera session". */
export type MarkInCamera = (sessionTitle: string | null, range: TranscriptRef) => Promise<void>;

export type InCameraMarks = {
  marks: readonly InCameraMark[];
  choices: readonly InCameraChoice[];
  /** Editors of unapproved minutes; approved minutes are the record and stay as they are. */
  canMark: boolean;
  /** Whether readers without in-camera access get the transcript with these parts cut out, or not at all. */
  allMarked: boolean;
  onMark: MarkInCamera;
  onClear: (sessionTitle: string) => Promise<void>;
  status: string;
  error: string;
};

type MarkMinutes = {
  approvedAt?: string;
  adoptedSnapshot?: unknown;
  motionSnapshots?: unknown[];
  sessionSegments?: unknown[];
  sections?: unknown[];
};

const NO_MARKS: InCameraMark[] = [];

function markedRanges(choices: readonly InCameraChoice[]): InCameraMark[] {
  return choices
    .filter((choice): choice is InCameraMark => typeof choice.startSec === "number" && typeof choice.endSec === "number")
    .sort((a, b) => a.startSec - b.startSec);
}

/**
 * The minutes' in-camera sessions on the Transcript tab (decision A2): where
 * each sits in the recording, and marking a range as one. Marking a session
 * that already has a range extends it to cover both.
 */
export function useInCameraMarks({
  societyId,
  meetingId,
  minutes,
}: {
  societyId: Id<"societies">;
  meetingId: Id<"meetings">;
  minutes?: MarkMinutes | null;
}): InCameraMarks {
  const { can } = usePermissions();
  const choices = useMemo(() => inCameraSessionChoices(minutes), [minutes]);
  const marks = useMemo(() => (choices.length ? markedRanges(choices) : NO_MARKS), [choices]);
  const allMarked = useMemo(() => Boolean(inCameraRecordingRanges(minutes)), [minutes]);
  const frozen = Boolean(minutes?.approvedAt || minutes?.adoptedSnapshot || Array.isArray(minutes?.motionSnapshots));
  const canMark = can("minutes:write") && can("meetings:write") && Boolean(minutes) && !frozen;
  const mark = usePermissionedMutation(api.transcripts.markInCameraRange, canMark);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const run = useCallback(
    async (args: { sessionTitle?: string; startSec?: number; endSec?: number }, success: (title: string) => string) => {
      setError("");
      setStatus("");
      try {
        const saved = await mark({ societyId, meetingId, ...args });
        setStatus(success(saved.title));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not mark the in-camera session.");
      }
    },
    [mark, societyId, meetingId],
  );
  const onMark = useCallback<MarkInCamera>(
    async (sessionTitle, range) => {
      const existing = sessionTitle ? marks.find((entry) => entry.title === sessionTitle) : undefined;
      const startSec = existing ? Math.min(existing.startSec, range.startSec) : range.startSec;
      const endSec = existing ? Math.max(existing.endSec, range.endSec) : range.endSec;
      await run(
        { ...(sessionTitle ? { sessionTitle } : {}), startSec, endSec },
        (title) => `Marked ${formatTranscriptTime(startSec)}–${formatTranscriptTime(endSec)} as ${title || IN_CAMERA_TITLE}.`,
      );
    },
    [marks, run],
  );
  const onClear = useCallback(
    (sessionTitle: string) => run({ sessionTitle }, (title) => `Cleared the recording range of ${title}.`),
    [run],
  );
  // One object per change, so the memoized transcript doesn't re-render on clock ticks.
  return useMemo(
    () => ({ marks, choices, canMark, allMarked, onMark, onClear, status, error }),
    [marks, choices, canMark, allMarked, onMark, onClear, status, error],
  );
}
