import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { Id } from "../../../../convex/_generated/dataModel";
import { usePermissions } from "../../../hooks/usePermissions";
import { isLocalDataRuntime } from "../../../lib/staticRuntime";
import { DEVICE_AI_SETTINGS_HREF, useAiDraftAvailability } from "../../../lib/localAi/useDeviceAi";
import type { TimedTranscript, TranscriptSegment, TranscriptSpeaker } from "./timedTranscript";
import { useMediaClock } from "./useMediaClock";
import { MediaPlayerBar } from "./MediaPlayerBar";
import { SpeakerPanel, type Attendee } from "./SpeakerPanel";
import { speakerCandidates } from "./speakerCandidates";
import { SpeakerReview } from "./SpeakerReview";
import { needsSpeakerReview } from "./speakerSuggestions";
import { displaySegments, speakerPalette } from "./speakerTurns";
import { REVIEW_SPEAKERS_INTENT } from "./timedImportOffer";
import { TranscriptView } from "./TranscriptView";

import { useTranscriptRecording } from "./useTranscriptRecording";
import { useLocalTranscription } from "./useLocalTranscription";
import { useTranscriptMutations, type MergeUndo } from "./useTranscriptMutations";
import { TranscriptWorkspaceHeader } from "./TranscriptWorkspaceHeader";
import {
  useTranscriptFeedback,
  useTranscriptPlayback,
  useTranscriptPlayerLayout,
} from "./useTranscriptWorkspaceState";
import { handleWorkspaceKeyDown } from "./useTranscriptNavigation";
import { activeIndex } from "./activeIndex";
import { citationsBySegment, type LinkableMotion } from "./transcriptLinks";
import { useMinutesLinks, type LinkMinutes } from "./useMinutesLinks";
import { useInCameraMarks } from "./useInCameraMarks";
import { InCameraNote } from "./InCameraTranscript";

const EMPTY_SEGMENTS: TranscriptSegment[] = [];
const TRANSCRIPT_FORMATS_HINT = "VTT, SRT or Whisper JSON";
const EMPTY_SPEAKERS: TranscriptSpeaker[] = [];
type WorkspaceTranscript = {
  text: string;
  segments?: TranscriptSegment[];
  speakers?: TranscriptSpeaker[];
  durationSeconds?: number;
  provider?: string;
  wordsDropped?: boolean;
};
type WorkspaceMinutes = LinkMinutes & { attendees?: string[]; detailedAttendance?: Attendee[]; sessionSegments?: unknown[] };

export function TranscriptWorkspace({
  societyId,
  meetingId,
  transcript,
  minutes,
  motions,
  attendees: attendeesProp,
  onDraftMinutes,
  draftingMinutes,
  plainTextNote,
}: {
  societyId: Id<"societies">;
  meetingId: Id<"meetings">;
  transcript: WorkspaceTranscript | null | undefined;
  minutes?: WorkspaceMinutes | null;
  /** The minutes' display motions (live rows for drafts, snapshots once approved). */
  motions?: readonly LinkableMotion[];
  /** Speaker assignment candidates (`speakerCandidates`); defaults to the minutes attendance. */
  attendees?: readonly Attendee[];
  onDraftMinutes?: () => Promise<void> | void;
  draftingMinutes?: boolean;
  /** Where an untimed transcript is kept and edited, shown with its text. */
  plainTextNote?: ReactNode;
}) {
  const workspace = useTranscriptPlayerLayout();
  const { can } = usePermissions();
  const aiDraft = useAiDraftAvailability();
  const canWrite = can("meetings:write");
  const { onAssign, onUpdate, onMerge, onUnmerge, importFile, importTranscribed, announce, importing, error, status, undo } =
    useTranscriptMutations({
      societyId,
      meetingId,
      canWrite,
      hasTranscript: Boolean(transcript),
      speakers: transcript?.speakers ?? EMPTY_SPEAKERS,
    });
  const clock = useMediaClock();
  const { recording, recordingOrigin, setRecording, lastRecording, source, peaks, waveformNote } =
    useTranscriptRecording(meetingId);
  const links = useMinutesLinks({ societyId, meetingId, minutes, motions });
  const inCamera = useInCameraMarks({ societyId, meetingId, minutes });
  const feedback = useTranscriptFeedback({ status, linkStatus: links.status, markStatus: inCamera.status, waveformNote, undo });
  const segments = transcript?.segments ?? EMPTY_SEGMENTS;
  const speakers = transcript?.speakers ?? EMPTY_SPEAKERS;
  const { playerClock, seek, skip, followRevision, jump, speakerFocus, onOpenSpeaker, onPlaySample, onJump } =
    useTranscriptPlayback(clock, segments, source);
  // Combined labels resolve at read time: the transcript, lane and colours use
  // the speaker each segment resolves to; the speaker panel nests the raw labels.
  const shown = useMemo(() => displaySegments(segments, speakers), [segments, speakers]);
  const labels = useMemo(() => [...new Set(shown.map((segment) => segment.speaker))], [shown]);
  const palette = useMemo(() => speakerPalette(segments), [segments]);
  const review = useSpeakerReview(canWrite, segments.length > 0, importFile);
  const localTranscription = useLocalTranscription({ recording, canWrite, importTranscribed, announce, onSaved: review.openIfNeeded });
  const attendees = useMemo(() => attendeesProp ?? speakerCandidates({ minutes }), [attendeesProp, minutes]);
  // Shared by the speaker panel and Review speakers (raw segments: they nest combined labels).
  const speakerData = { segments, speakers, labels, attendees, hasMedia: Boolean(source) };
  const speakerActions = { onAssign, onMerge, onUnmerge, onPlaySample };
  const citations = useMemo(() => citationsBySegment(shown, links.targets), [shown, links.targets]);
  // A marker scrolls the transcript to its line and seeks there (which resumes following).
  const onMarker = useCallback(
    (seconds: number) => {
      const index = activeIndex(segments, seconds);
      if (index >= 0) onJump(index);
      seek(seconds);
    },
    [segments, onJump, seek],
  );
  // saveText creates synthetic five-second segments; those are not recording timestamps.
  const timed =
    segments.some((segment) => segment.endSec > 0) &&
    !["manual", "text", "txt"].includes(transcript?.provider ?? "manual");
  const duration =
    transcript?.durationSeconds ?? segments.reduce((max, segment) => Math.max(max, segment.endSec), 0);
  return (
    <section
      ref={workspace}
      className="transcript-workspace"
      aria-label="Transcript workspace"
      onKeyDown={(event) => handleWorkspaceKeyDown(event, Boolean(source), clock.toggle, skip)}
    >
      <TranscriptWorkspaceHeader
        meetingId={meetingId}
        provider={transcript?.provider}
        recording={recording ? { name: recording.name, origin: recordingOrigin, size: recording.size, duration: clock.duration } : undefined}
        localTranscription={localTranscription}
        // Untimed text cannot play along with a recording, so it gets no reopen hint.
        reopenHint={transcript && timed && !recording ? { lastRecording } : undefined}
        onDraftMinutes={
          onDraftMinutes && can("minutes:write") && (transcript?.text.trim() || segments.length)
            ? onDraftMinutes
            : undefined
        }
        draftUnavailableReason={
          aiDraft.available ? undefined : "AI minutes drafting needs a connected server or an on-device model."
        }
        draftSetUpHref={aiDraft.canSetUpDevice ? DEVICE_AI_SETTINGS_HREF : undefined}
        draftingMinutes={draftingMinutes}
        canWrite={canWrite}
        importing={importing}
        importFile={review.importFile}
        setRecording={setRecording}
      />
      {(error || feedback.copyError || links.error || inCamera.error) && (
        <p role="alert" className="transcript-error">
          {error || feedback.copyError || links.error || inCamera.error}
        </p>
      )}
      <TranscriptStatus notice={feedback.notice} undo={feedback.undo} />
      {transcript?.wordsDropped && (
        <p className="transcript-muted">
          Word timings were omitted to keep this transcript within the storage limit. Segment timings are
          preserved.
        </p>
      )}
      {/* No recording and no timeline to show: an empty 0:00 player is noise.
          A timed transcript keeps the bar for its speaker lane and minutes markers. */}
      {(source || timed) && <MediaPlayerBar
        clock={playerClock}
        source={source}
        video={Boolean(
          recording && (recording.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(recording.name)),
        )}
        peaks={peaks}
        segments={timed ? shown : EMPTY_SEGMENTS}
        labels={palette}
        transcriptDuration={timed ? duration : 0}
        markers={timed ? links.targets : []}
        onMarker={onMarker}
        inCameraMarks={timed ? inCamera.marks : []}
      />}
      {timed && inCamera.choices.length > 0 && !inCamera.allMarked && <InCameraNote canMark={inCamera.canMark} />}
      <TranscriptFallback transcript={transcript} segments={segments} timed={timed} canWrite={canWrite} note={plainTextNote} />
      {timed && (
        <div className="transcript-columns">
          <SpeakerPanel
            {...speakerData}
            {...speakerActions}
            canWrite={canWrite}
            onReview={canWrite ? review.open : undefined}
            onJump={onJump}
            onPlaySample={onPlaySample}
            focusRequest={speakerFocus}
          />
          <TranscriptView
            segments={shown}
            palette={palette}
            speakers={speakers}
            labels={labels}
            currentTime={clock.currentTime}
            hasMedia={Boolean(source)}
            canWrite={canWrite}
            onSeek={seek}
            onOpenSpeaker={onOpenSpeaker}
            followRevision={followRevision}
            onCopy={feedback.onCopy}
            linkTargets={links.linkTargets}
            citations={citations}
            onLink={links.onLink}
            inCamera={inCamera}
            onUpdate={onUpdate}
            jumpIndex={jump.index}
            jumpRevision={jump.revision}
          />
        </div>
      )}
      {timed && canWrite && (
        <SpeakerReview {...speakerData} {...speakerActions} open={review.isOpen} onClose={review.close} />
      )}
    </section>
  );
}

/**
 * Review speakers opens after a timed import, from the speaker panel, or once
 * on arrival with `?intent=review-speakers` (the Meeting source files handoff).
 */
function useSpeakerReview(
  canWrite: boolean,
  hasSegments: boolean,
  importTimedFile: (file: File) => Promise<TimedTranscript | null>,
) {
  const [isOpen, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const intent = searchParams.get("intent") === REVIEW_SPEAKERS_INTENT;
  useEffect(() => {
    if (!intent || !hasSegments) return;
    if (canWrite) setOpen(true);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("intent");
        return next;
      },
      { replace: true },
    );
  }, [intent, hasSegments, canWrite, setSearchParams]);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const openIfNeeded = useCallback(
    (parsed: TimedTranscript) => {
      if (canWrite && needsSpeakerReview(parsed.segments)) setOpen(true);
    },
    [canWrite],
  );
  const importFile = useCallback(
    async (file: File) => {
      const parsed = await importTimedFile(file);
      if (parsed) openIfNeeded(parsed);
    },
    [importTimedFile, openIfNeeded],
  );
  return { isOpen, open, close, importFile, openIfNeeded };
}

/** Announcements, and Undo after combining speakers, in a toast outside the workspace. */
function TranscriptStatus({ notice, undo }: { notice: string; undo: MergeUndo | null }) {
  return createPortal(
    <div role="status" className={notice || undo ? "transcript-status" : "transcript-status-empty"}>
      {undo ? (
        <>
          <span>{undo.message}</span>
          <button type="button" className="transcript-status__action" onClick={() => void undo.run()}>
            Undo
          </button>
        </>
      ) : (
        notice
      )}
    </div>,
    document.body,
  );
}

function TranscriptFallback({
  transcript,
  segments,
  timed,
  canWrite,
  note,
}: {
  transcript: WorkspaceTranscript | null | undefined;
  segments: readonly TranscriptSegment[];
  timed: boolean;
  canWrite: boolean;
  note?: ReactNode;
}) {
  return transcript === undefined ? (
    <p role="status">Loading transcript…</p>
  ) : !transcript || (!transcript.text && !segments.length) ? (
    <div className="card transcript-empty">
      <p>{canWrite ? "Upload a transcript file to read it alongside the recording." : "No transcript yet."}</p>
      <p className="transcript-muted">{canWrite ? TRANSCRIPT_FORMATS_HINT : "A meeting editor can add the transcript."}</p>
      {isLocalDataRuntime() && (
        <p className="transcript-muted">Transcript imports and edits are saved in this local workspace.</p>
      )}
    </div>
  ) : !timed ? (
    <div className="card transcript-plain">
      {note && <p className="transcript-plain__note">{note}</p>}
      <div>{transcript.text}</div>
      <p className="transcript-muted">
        No timestamps, so it can't play along with a recording.
        {canWrite ? ` To do that, upload a transcript file with timestamps (${TRANSCRIPT_FORMATS_HINT}).` : ""}
      </p>
    </div>
  ) : null;
}
