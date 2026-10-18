import { speakerName } from "../../../../shared/transcriptModel";
import type { TranscriptSegment, TranscriptSpeaker } from "./timedTranscript";
import { formatTranscriptTime } from "./activeIndex";
import { SpeakerActions } from "./SpeakerActions";
import { MergedLabels, SpeakerAssignment } from "./SpeakerControls";
import type { SpeakerStat } from "./speakerSuggestions";
import type { AssignSpeaker, Attendee, UnmergeSpeaker } from "./SpeakerPanel";

type SpeakerRowProps = {
  label: string;
  index: number;
  row: SpeakerStat;
  segments: readonly TranscriptSegment[];
  speakers: readonly TranscriptSpeaker[];
  labels: readonly string[];
  attendees: readonly Attendee[];
  total: number;
  canWrite: boolean;
  hasMedia: boolean;
  onAssign: AssignSpeaker;
  onJump: (index: number) => void;
  onPlaySample: (index: number) => void;
  onOpenMerge: (label: string) => void;
  /** Raw labels combined into this speaker. */
  merged: readonly string[];
  rawStats: ReadonlyMap<string, SpeakerStat>;
  onUnmerge: UnmergeSpeaker;
};

export function SpeakerRow({
  label,
  index,
  row,
  segments,
  speakers,
  labels,
  attendees,
  total,
  canWrite,
  hasMedia,
  onAssign,
  onJump,
  onPlaySample,
  onOpenMerge,
  merged,
  rawStats,
  onUnmerge,
}: SpeakerRowProps) {
  const name = speakerName(label, speakers);
  const assigned = name !== label;
  const sampleIndex = row.sample ?? row.first;
  const quote = segments[sampleIndex].text;
  const percent = total ? Math.round((row.time / total) * 100) : 0;
  return (
    <section
      className={`transcript-speaker transcript-color-${(Math.max(0, index) % 8) + 1}`}
      data-speaker-row={label}
    >
      <div className="transcript-speaker__head">
        <span className="transcript-speaker-name">
          <span className="transcript-swatch" />
          <strong>{name}</strong>
        </span>
        <SpeakerActions
          label={label}
          speakers={speakers}
          first={row.first}
          sample={sampleIndex}
          canMerge={labels.length > 1}
          canWrite={canWrite}
          hasMedia={hasMedia}
          onAssign={onAssign}
          onJump={onJump}
          onPlaySample={onPlaySample}
          onOpenMerge={onOpenMerge}
        />
      </div>
      <p className="transcript-speaker__meta">
        {assigned ? `${label} · ` : ""}
        {formatTranscriptTime(row.time)} · {percent}%
      </p>
      <div className="transcript-talk-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <MergedLabels name={name} labels={merged} stats={rawStats} canWrite={canWrite} onUnmerge={onUnmerge} />
      {!assigned && (
        <p className="transcript-speaker__quote">
          “{quote.length > 90 ? `${quote.slice(0, 89).trimEnd()}…` : quote}”
        </p>
      )}
      {canWrite && (
        <SpeakerAssignment label={label} speakers={speakers} attendees={attendees} onAssign={onAssign} />
      )}
    </section>
  );
}
