import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { TranscriptSegment } from "./timedTranscript";
import type { MediaClock } from "./useMediaClock";
import { linkedTranscriptRange } from "./transcriptLinks";
import type { MergeUndo } from "./useTranscriptMutations";

export function useTranscriptPlayerLayout() {
  const workspace = useRef<HTMLElement>(null);
  useEffect(() => {
    const player = workspace.current?.querySelector<HTMLElement>(".transcript-player");
    if (!player) return;
    const observer = new ResizeObserver(() =>
      workspace.current?.style.setProperty("--transcript-player-height", `${player.offsetHeight}px`),
    );
    observer.observe(player);
    return () => observer.disconnect();
  }, []);
  return workspace;
}

const NOTICE_MS = 4000;

type Feedback = { kind: "notice"; text: string; key: number } | { kind: "undo"; undo: MergeUndo };

/**
 * One status toast for every transcript action. The latest event wins: a new
 * message (assign, edit, link, import, copy, waveform) replaces whatever is
 * showing, including an earlier Undo. Messages clear after 4 seconds; an Undo
 * stays until its own timer drops it.
 */
export function useTranscriptFeedback({
  status,
  linkStatus,
  markStatus = "",
  waveformNote,
  undo,
}: {
  status: string;
  linkStatus: string;
  /** In-camera marking (useInCameraMarks). */
  markStatus?: string;
  waveformNote: string;
  undo: MergeUndo | null;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [copyError, setCopyError] = useState("");
  const show = useCallback((text: string) => {
    if (text) setFeedback({ kind: "notice", text, key: Date.now() });
  }, []);
  useEffect(() => show(status), [show, status]);
  useEffect(() => show(linkStatus), [show, linkStatus]);
  useEffect(() => show(markStatus), [show, markStatus]);
  useEffect(() => show(waveformNote), [show, waveformNote]);
  useEffect(() => {
    if (undo) setFeedback({ kind: "undo", undo });
    else setFeedback((current) => (current?.kind === "undo" ? null : current));
  }, [undo]);
  useEffect(() => {
    if (feedback?.kind !== "notice") return;
    const timer = window.setTimeout(() => setFeedback(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [feedback]);
  const onCopy = useCallback(
    (text: string) => {
      setCopyError("");
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(text);
          show(text.startsWith("file:") ? "Local desktop link copied. It is not a publicly hosted URL." : "Copied to clipboard.");
        } catch {
          setCopyError(
            "Could not copy. Select the transcript text and copy it using your device’s copy command.",
          );
        }
      };
      void copy();
    },
    [show],
  );
  return {
    notice: feedback?.kind === "notice" ? feedback.text : "",
    undo: feedback?.kind === "undo" ? feedback.undo : null,
    copyError,
    onCopy,
  };
}

export function useTranscriptPlayback(
  clock: MediaClock,
  segments: readonly TranscriptSegment[],
  source: string,
) {
  const location = useLocation();
  const { seek: seekMedia, skip: skipMedia, play: playMedia } = clock;
  const [followRevision, setFollowRevision] = useState(0);
  const seek = useCallback(
    (seconds: number) => {
      setFollowRevision((revision) => revision + 1);
      seekMedia(seconds);
    },
    [seekMedia],
  );
  const skip = useCallback(
    (delta: number) => {
      setFollowRevision((revision) => revision + 1);
      skipMedia(delta);
    },
    [skipMedia],
  );
  const [jump, setJump] = useState({ index: 0, revision: 0 });
  const [speakerFocus, setSpeakerFocus] = useState({ label: "", revision: 0 });
  const onOpenSpeaker = useCallback(
    (label: string) => setSpeakerFocus((previous) => ({ label, revision: previous.revision + 1 })),
    [],
  );
  const linkedSource = useRef("");
  useEffect(() => {
    const range = linkedTranscriptRange(location.search);
    const key = `${source}|${location.search}`;
    if (!range) linkedSource.current = "";
    if (range && source && segments.length && linkedSource.current !== key) {
      linkedSource.current = key;
      seek(range.start);
    }
  }, [source, segments, seek, location.search]);
  const onPlaySample = useCallback(
    (index: number) => {
      if (!segments[index]) return;
      seek(segments[index].startSec);
      playMedia();
    },
    [segments, seek, playMedia],
  );
  const onJump = useCallback(
    (index: number) => {
      setJump((previous) => ({ index, revision: previous.revision + 1 }));
      if (segments[index]) seek(segments[index].startSec);
    },
    [segments, seek],
  );
  return {
    playerClock: { ...clock, seek, skip },
    seek,
    skip,
    followRevision,
    jump,
    speakerFocus,
    onOpenSpeaker,
    onPlaySample,
    onJump,
  };
}
