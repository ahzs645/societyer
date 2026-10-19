/**
 * "Transcribe on this device": the open recording → the speech-to-text server
 * in Settings → On-device AI → `transcripts:importTimed` (provider
 * "local-whisper"), then Review speakers as after an import.
 *
 * Nothing is saved until the whole recording is transcribed; Cancel (or
 * opening another recording, or leaving the tab) stops the request and leaves
 * the transcript as it was.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DeviceAiError } from "../../../lib/localAi/transport";
import { deviceSpeechTransport, transcribeRecording, type SpeechProgress } from "../../../lib/localAi/transcription";
import { useDeviceSpeechToText } from "../../../lib/localAi/useDeviceAi";
import type { TimedTranscript } from "./timedTranscript";

export type LocalTranscriptionStep = SpeechProgress | { phase: "starting" } | { phase: "saving" };

export type LocalTranscriptionJob = { fileName: string; step: LocalTranscriptionStep; startedAt: number };

export const TRANSCRIPTION_CANCELLED = "Transcription cancelled. Nothing was changed.";

/**
 * Why Draft minutes is disabled, if it is: no AI to draft with (lasting, so it
 * wins), or a transcription in progress that will replace the transcript.
 */
export function draftMinutesDisabledReason({ aiAvailable, transcribing }: { aiAvailable: boolean; transcribing: boolean }): string | undefined {
  if (!aiAvailable) return "AI minutes drafting needs a connected server or an on-device model.";
  if (transcribing) return "Wait for the transcription to finish.";
  return undefined;
}

export function useLocalTranscription({
  recording,
  canWrite,
  importTranscribed,
  announce,
  onSaved,
}: {
  recording: File | null;
  canWrite: boolean;
  /** Confirms a replace and saves; null when the person declined. */
  importTranscribed: (parsed: TimedTranscript, summary: string) => Promise<TimedTranscript | null>;
  announce: (message: string) => void;
  /** After saving, e.g. to open Review speakers. */
  onSaved?: (saved: TimedTranscript) => void;
}) {
  const speech = useDeviceSpeechToText();
  const [job, setJob] = useState<LocalTranscriptionJob | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => controller.current?.abort(), []);
  // A different recording, or leaving the tab, stops a transcription in progress.
  useEffect(() => () => controller.current?.abort(), [recording]);

  const start = useCallback(async (): Promise<void> => {
    if (!recording || !canWrite || !speech.ready || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    const fileName = recording.name || "recording";
    setJob({ fileName, step: { phase: "starting" }, startedAt: Date.now() });
    const step = (next: LocalTranscriptionStep) => {
      if (!abort.signal.aborted) setJob((current) => (current ? { ...current, step: next } : current));
    };
    try {
      const result = await transcribeRecording({
        transport: deviceSpeechTransport(),
        file: recording,
        fileName,
        signal: abort.signal,
        onProgress: step,
      });
      if (abort.signal.aborted) throw new DeviceAiError("aborted", TRANSCRIPTION_CANCELLED);
      step({ phase: "saving" });
      const lines = `${result.segments.length.toLocaleString()} ${result.segments.length === 1 ? "line" : "lines"}`;
      const speakers = result.speakerCount > 1 ? `, ${result.speakerCount} speakers` : "";
      const saved = await importTranscribed(
        { provider: result.provider, segments: result.segments, durationSeconds: result.durationSeconds },
        `Transcribed on this device: ${lines}${speakers}.`,
      );
      if (saved) onSaved?.(saved);
      else announce("Transcript not replaced. The new transcription was discarded.");
    } catch (cause) {
      if (abort.signal.aborted || (cause instanceof DeviceAiError && cause.code === "aborted")) {
        announce(TRANSCRIPTION_CANCELLED);
      } else {
        setError({
          message: cause instanceof Error && cause.message ? cause.message : "Could not transcribe the recording.",
          hint: cause instanceof DeviceAiError ? cause.hint : undefined,
        });
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      setJob(null);
    }
  }, [recording, canWrite, speech.ready, importTranscribed, announce, onSaved]);

  return {
    /** Offer the button: a recording is open, the person can edit, and speech-to-text is set up. */
    available: Boolean(recording) && canWrite && speech.ready,
    /** Speech-to-text could be set up here (local or desktop workspace, not the demo). */
    canSetUp: speech.supported && !speech.ready && canWrite,
    serverHost: hostOf(speech.speech.baseUrl),
    job,
    error,
    dismissError: () => setError(null),
    start,
    cancel,
  };
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** "Transcribing part 2 of 6…" and a progress value for the bar (null: indeterminate). */
export function describeTranscriptionStep(step: LocalTranscriptionStep, serverHost: string): { label: string; value: number | null } {
  switch (step.phase) {
    case "starting":
      return { label: "Starting…", value: null };
    case "uploading":
      return {
        label: `Handing the recording to the desktop app… ${Math.floor((100 * step.sentBytes) / Math.max(1, step.totalBytes))}%`,
        value: step.sentBytes / Math.max(1, step.totalBytes),
      };
    case "converting":
      return { label: "Preparing the audio with ffmpeg…", value: null };
    case "transcribing":
      return step.parts > 1
        ? { label: `Transcribing part ${step.part} of ${step.parts}…`, value: (step.part - 1) / step.parts }
        : { label: `Transcribing${serverHost ? ` on ${serverHost}` : ""}…`, value: null };
    case "saving":
      return { label: "Saving the transcript…", value: null };
  }
}
