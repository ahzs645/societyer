import { Link, useLocation } from "react-router-dom";
import { Play } from "lucide-react";
import type { TranscriptRef } from "../../../../shared/transcriptModel";
import { motionDisplayName } from "../../../lib/motionDisplay";
import { formatTranscriptTime } from "./activeIndex";
import { transcriptSearch } from "./transcriptLinks";

/** "▶ 14:22" on a minutes item linked to the recording; opens the Transcript tab there. */
export function TranscriptTimeChip({
  transcriptRef,
  label,
}: {
  transcriptRef?: TranscriptRef;
  label: string;
}) {
  const location = useLocation();
  if (!transcriptRef) return null;
  const time = formatTranscriptTime(transcriptRef.startSec);
  return (
    <Link
      className="transcript-time-chip"
      to={{ pathname: location.pathname, search: transcriptSearch(location.search, transcriptRef) }}
      aria-label={`Open the transcript at ${time}: ${label}`}
    >
      <Play size={10} aria-hidden="true" />
      {time}
    </Link>
  );
}

/** `MotionEditor`'s `renderMotionAccessory`: the motion's recording time, when linked. */
export function motionTranscriptChip(
  motion: { transcriptRef?: TranscriptRef; name?: string; text: string },
  number: number | null,
) {
  return <TranscriptTimeChip transcriptRef={motion.transcriptRef} label={motionDisplayName(number, motion)} />;
}
