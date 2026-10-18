import { useRef, useState } from "react";
import type { TranscriptSegment, TranscriptSpeaker } from "./timedTranscript";
import { TranscriptTurns, type InCameraProps, type MinutesLinkProps, type UpdateSegment } from "./TranscriptTurns";
import { TranscriptSearch, useTranscriptSearch } from "./TranscriptSearch";
import { useTranscriptSelection } from "./useTranscriptSelection";
import { useTranscriptTracking, useTranscriptActions } from "./useTranscriptNavigation";
export type { UpdateSegment } from "./TranscriptTurns";

export function TranscriptView({
  segments,
  speakers,
  labels,
  palette,
  currentTime,
  hasMedia,
  canWrite,
  onSeek,
  onUpdate,
  onOpenSpeaker,
  jumpIndex,
  jumpRevision,
  followRevision,
  onCopy,
  linkTargets,
  citations,
  onLink,
  inCamera,
}: {
  segments: readonly TranscriptSegment[];
  speakers: readonly TranscriptSpeaker[];
  labels: readonly string[];
  /** Raw labels in first-appearance order, for stable speaker colours. */
  palette: readonly string[];
  currentTime: number;
  hasMedia: boolean;
  canWrite: boolean;
  onSeek: (seconds: number) => void;
  onUpdate: UpdateSegment;
  onOpenSpeaker: (label: string) => void;
  jumpIndex: number;
  jumpRevision: number;
  followRevision: number;
  onCopy: (text: string) => void;
  inCamera: InCameraProps;
} & MinutesLinkProps) {
  const root = useRef<HTMLDivElement>(null);
  const selectionToolbar = useTranscriptSelection({ root, segments, speakers, onCopy, linkTargets, onLink, inCamera });
  const [query, setQuery] = useState("");
  const actions = useTranscriptActions({ root, hasMedia, canWrite, onSeek, onOpenSpeaker });
  const { editIndex, relabelIndex, done } = actions;
  const tracking = useTranscriptTracking({
    root,
    segments,
    currentTime,
    hasMedia,
    query,
    editIndex,
    relabelIndex,
    followRevision,
    jumpIndex,
    jumpRevision,
  });
  const search = useTranscriptSearch({
    root,
    segments,
    hasMedia,
    onSeek,
    query,
    setQuery,
    setFollowing: tracking.setFollowing,
    scrollTo: tracking.scrollTo,
  });
  return (
    <section className="transcript-document card">
      <TranscriptSearch {...search} />
      <div ref={root} className="transcript-turns" {...actions.handlers}>
        <TranscriptTurns
          segments={segments}
          speakers={speakers}
          labels={labels}
          palette={palette}
          matches={search.matches}
          canWrite={canWrite}
          editIndex={editIndex}
          relabelIndex={relabelIndex}
          onUpdate={onUpdate}
          onDone={done}
          onEdit={actions.edit}
          onRelabel={actions.relabel}
          onCopy={onCopy}
          linkTargets={linkTargets}
          citations={citations}
          onLink={onLink}
          inCamera={inCamera}
        />
      </div>
      {selectionToolbar}
      {!tracking.following && hasMedia && (
        <button type="button" className="btn-action transcript-resume" onClick={tracking.resume}>
          Resume following
        </button>
      )}
    </section>
  );
}
