import { isLocalDataRuntime } from "../../../lib/staticRuntime";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { speakerName, TIMED_TRANSCRIPT_FILE_LIMIT } from "../../../../shared/transcriptModel";
import { usePermissionedMutation } from "../../../hooks/usePermissionedMutation";
import { useConfirm } from "../../../components/Modal";
import { parseTimedTranscript, type TimedTranscript, type TranscriptSpeaker } from "./timedTranscript";
import type { AssignSpeaker, MergeSpeakers, UnmergeSpeaker } from "./SpeakerPanel";
import type { UpdateSegment } from "./TranscriptTurns";
import { REPLACE_TRANSCRIPT_CONFIRM } from "./timedImportOffer";

export function useTranscriptMutations({
  societyId,
  meetingId,
  canWrite,
  hasTranscript,
  speakers,
  paged,
}: {
  societyId: Id<"societies">;
  meetingId: Id<"meetings">;
  canWrite: boolean;
  hasTranscript: boolean;
  /** The current speaker map, to name the combine target in the toast. */
  speakers: readonly TranscriptSpeaker[];
  paged?: { jobId: Id<"meetingTranscriptionJobs">; page: number; revision: number };
}) {
  const assignSpeaker = usePermissionedMutation(api.transcripts.assignSpeaker, canWrite);
  const updateSegment = usePermissionedMutation(api.transcripts.updateSegment, canWrite);
  const mergeSpeakers = usePermissionedMutation(api.transcripts.mergeSpeakers, canWrite);
  const unmergeSpeaker = usePermissionedMutation(api.transcripts.unmergeSpeaker, canWrite);
  const importTimed = usePermissionedMutation(api.transcripts.importTimed, canWrite);
  const editPaged = usePermissionedMutation(api.meetingTranscription.editSegment, canWrite && !isLocalDataRuntime());
  const confirm = useConfirm();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(false);
  /** The last combine, offered as Undo in the status toast. */
  const [undo, setUndo] = useState<MergeUndo | null>(null);
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 4000);
    return () => clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), MERGE_UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);
  const onAssign = useCallback<AssignSpeaker>(
    async (label, name, personId) => {
      setError("");
      setStatus("");
      try {
        const result = await assignSpeaker({
          societyId,
          meetingId,
          label,
          name: name ?? "",
          ...(personId ? { personId: personId as Id<"peopleDirectory"> } : {}),
        });
        setStatus(
          `Speaker assignment saved.${result.wordsDropped ? " Word timings were omitted to keep the transcript within the storage limit." : ""}`,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not assign speaker.");
        throw cause;
      }
    },
    [assignSpeaker, societyId, meetingId],
  );
  const onUpdate = useCallback<UpdateSegment>(
    async (index, patch) => {
      setError("");
      setStatus("");
      try {
        const result = paged ? await editPaged({ ...paged, index, ...patch }) : await updateSegment({ societyId, meetingId, index, ...patch });
        setStatus(
          `Segment saved.${result.wordsDropped ? " Word timings were omitted to keep the transcript within the storage limit." : ""}`,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save segment.");
        throw cause;
      }
    },
    [updateSegment, editPaged, paged, societyId, meetingId],
  );
  const onUnmerge = useCallback<UnmergeSpeaker>(
    async (label) => {
      setError("");
      setStatus("");
      setUndo(null);
      try {
        const result = await unmergeSpeaker({ societyId, meetingId, label });
        setStatus(`${label} is its own speaker again.${dropNote(result.wordsDropped)}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not unmerge speaker.");
        throw cause;
      }
    },
    [unmergeSpeaker, societyId, meetingId],
  );
  // Combining is undoable (the speaker map records it), so it needs no confirmation.
  const onMerge = useCallback<MergeSpeakers>(
    async (from, to) => {
      setError("");
      try {
        const result = await mergeSpeakers({ societyId, meetingId, from: [...from], to });
        const what = from.length === 1 ? from[0] : `${from.length} speakers`;
        setStatus("");
        setUndo({
          message: `Combined ${what} into ${speakerName(to, speakers)}.${dropNote(result.wordsDropped)}`,
          run: async () => {
            setUndo(null);
            setError("");
            try {
              for (const label of from) await unmergeSpeaker({ societyId, meetingId, label });
              setStatus(from.length === 1 ? `Unmerged ${from[0]}.` : `Unmerged ${from.length} speakers.`);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not undo the combine.");
            }
          },
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not combine speakers.");
        throw cause;
      }
    },
    [mergeSpeakers, unmergeSpeaker, societyId, meetingId, speakers],
  );
  /** Asks before replacing a transcript, saves, and announces. Null when the person declined. */
  async function save(parsed: TimedTranscript, announce: (wordsDropped: boolean) => string) {
    if (hasTranscript && !(await confirm(REPLACE_TRANSCRIPT_CONFIRM))) return null;
    const { provider, segments, durationSeconds } = parsed;
    const result = await importTimed({ societyId, meetingId, provider, segments, durationSeconds });
    setUndo(null);
    setStatus(announce(result.wordsDropped));
    return parsed;
  }
  /** Resolves with the parsed transcript once it is saved, or null when nothing was imported. */
  async function importFile(file: File): Promise<TimedTranscript | null> {
    setError("");
    setStatus("");
    setImporting(true);
    try {
      if (file.size > TIMED_TRANSCRIPT_FILE_LIMIT)
        throw new Error("Timed transcript files must be 16 MB or smaller.");
      const parsed = parseTimedTranscript(file.name, await file.text());
      return await save(
        parsed,
        (wordsDropped) => `Imported ${parsed.segments.length.toLocaleString()} segments.${dropNote(wordsDropped)}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import transcript.");
      return null;
    } finally {
      setImporting(false);
    }
  }
  /**
   * Saves a transcript made on this device (same confirmation and limits as an
   * import). Throws when saving fails, so the caller can keep the result.
   */
  async function importTranscribed(parsed: TimedTranscript, summary: string): Promise<TimedTranscript | null> {
    setError("");
    setStatus("");
    return await save(parsed, (wordsDropped) => `${summary}${dropNote(wordsDropped)}`);
  }
  /** A neutral announcement in the status toast (e.g. a cancelled transcription). */
  const announce = useCallback((message: string) => { setUndo(null); setStatus(message); }, []);
  return { onAssign, onUpdate, onMerge, onUnmerge, importFile, importTranscribed, announce, importing, error, status, undo };
}

export type MergeUndo = { message: string; run: () => Promise<void> };
/** Long enough to read the toast and reach Undo. */
const MERGE_UNDO_MS = 10_000;
const dropNote = (wordsDropped: boolean) =>
  wordsDropped ? " Word timings were omitted to keep the transcript within the storage limit." : "";
