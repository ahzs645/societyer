/**
 * Recording a meeting in the app: the microphone, plus the audio of a shared
 * tab, window or screen when the browser offers it (system audio on desktop
 * Chrome and Edge; tab audio elsewhere). Both are mixed into one file.
 *
 * One recording at a time, held in this module so it keeps running while the
 * person moves around the app; the floating RecordingBar shows and stops it.
 * When it stops, the file is handed to whoever is waiting (`takeFinishedRecording`)
 * and to the save step (src/features/meetings/recorder/saveRecording.ts).
 *
 * Nothing here is sent anywhere: the audio stays in this browser until it is
 * saved where the workspace keeps recordings, or downloaded.
 */
import { useSyncExternalStore } from "react";

export type RecorderPhase = "idle" | "starting" | "recording" | "stopping" | "finished" | "error";

export type RecorderState = {
  phase: RecorderPhase;
  meetingId?: string;
  meetingTitle?: string;
  startedAt?: number;
  /** Seconds recorded so far, excluding nothing (there is no pause). */
  elapsed: number;
  /** 0..1, the louder of the two inputs. */
  level: number;
  /** Whether a tab/window/system audio source is being mixed in. */
  sharedAudio: boolean;
  /** A warning that didn't stop the recording (no shared audio, for example). */
  notice?: string;
  error?: string;
  /** Set once finished: the file, until the save step takes it. */
  file?: File;
};

const IDLE: RecorderState = { phase: "idle", elapsed: 0, level: 0, sharedAudio: false };
let state: RecorderState = IDLE;
const listeners = new Set<() => void>();

function set(next: Partial<RecorderState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeRecorder(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const recorderSnapshot = () => state;
export function useMeetingRecorder(): RecorderState {
  return useSyncExternalStore(subscribeRecorder, recorderSnapshot, recorderSnapshot);
}

export function recordingSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function sharedAudioSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

/** The first container the browser can record: WebM/Opus in Chrome and Firefox, MP4 in Safari. */
export function recordingMimeType(): { mimeType: string; extension: string } {
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/mp4", extension: "m4a" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  ];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(candidate.mimeType)) return candidate;
  }
  return { mimeType: "", extension: "webm" };
}

/** "Partner call 2026-11-12 14-05.webm": readable, and safe as a file name. */
export function recordingFileName(title: string | undefined, startedAt: number, extension: string): string {
  const date = new Date(startedAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  const base = String(title ?? "Meeting").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Meeting";
  return `${base} ${stamp}.${extension}`;
}

type Session = {
  recorder: MediaRecorder;
  streams: MediaStream[];
  context: AudioContext;
  chunks: Blob[];
  timer: number;
  extension: string;
  mimeType: string;
};
let session: Session | null = null;

function stopTracks(streams: MediaStream[]) {
  for (const stream of streams) for (const track of stream.getTracks()) track.stop();
}

/**
 * Starts recording. Asks for the microphone; with `sharedAudio`, also asks the
 * person to pick a tab, window or screen to share audio from (a video track
 * is required by browsers and is dropped at once). Shared audio that isn't
 * granted leaves a notice and records the microphone alone.
 */
export async function startMeetingRecording(input: { meetingId: string; meetingTitle: string; sharedAudio?: boolean }) {
  if (session || state.phase === "starting" || state.phase === "recording" || state.phase === "stopping") {
    throw new Error("A recording is already running. Stop it first.");
  }
  if (!recordingSupported()) throw new Error("This browser can't record audio.");
  set({ ...IDLE, phase: "starting", meetingId: input.meetingId, meetingTitle: input.meetingTitle });
  const streams: MediaStream[] = [];
  let notice: string | undefined;
  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    streams.push(mic);
    if (input.sharedAudio && sharedAudioSupported()) {
      try {
        const shared = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true } as DisplayMediaStreamOptions);
        for (const track of shared.getVideoTracks()) track.stop();
        if (shared.getAudioTracks().length) streams.push(shared);
        else notice = "The shared source had no audio, so only your microphone is recorded. In Chrome, tick \"Share audio\" when choosing what to share.";
      } catch {
        notice = "Sharing was cancelled, so only your microphone is recorded.";
      }
    }
  } catch (error) {
    stopTracks(streams);
    const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
    set({ ...IDLE, phase: "error", meetingId: input.meetingId, meetingTitle: input.meetingTitle, error: denied ? "Microphone access was blocked. Allow it in the browser's site settings, then try again." : "No microphone could be opened." });
    throw error;
  }

  // Mix every source into one track, and measure the level on the way.
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const analysers: AnalyserNode[] = [];
  for (const stream of streams) {
    if (!stream.getAudioTracks().length) continue;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    source.connect(destination);
    analysers.push(analyser);
  }
  const { mimeType, extension } = recordingMimeType();
  const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  // A shared tab closing ends its track; keep recording the microphone.
  for (const stream of streams.slice(1)) {
    for (const track of stream.getAudioTracks()) track.onended = () => set({ sharedAudio: false, notice: "Sharing stopped; still recording your microphone." });
  }
  const buffer = new Uint8Array(512);
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    let level = 0;
    for (const analyser of analysers) {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128) / 128);
      level = Math.max(level, peak);
    }
    set({ elapsed: Math.floor((Date.now() - startedAt) / 1000), level });
  }, 200);
  // Chunks every few seconds, so a crash mid-meeting loses little.
  recorder.start(5_000);
  session = { recorder, streams, context, chunks, timer, extension, mimeType: mimeType || recorder.mimeType || "audio/webm" };
  set({ phase: "recording", startedAt, sharedAudio: streams.length > 1, notice });
}

/** Stops and returns the recorded file (also kept in the state until taken). */
export function stopMeetingRecording(): Promise<File> {
  const current = session;
  if (!current) return Promise.reject(new Error("Nothing is recording."));
  set({ phase: "stopping", level: 0 });
  return new Promise((resolve, reject) => {
    current.recorder.onstop = () => {
      window.clearInterval(current.timer);
      stopTracks(current.streams);
      void current.context.close().catch(() => undefined);
      session = null;
      if (!current.chunks.length) {
        set({ phase: "error", error: "Nothing was recorded." });
        reject(new Error("Nothing was recorded."));
        return;
      }
      const type = current.mimeType.split(";")[0] || "audio/webm";
      const file = new File(current.chunks, recordingFileName(state.meetingTitle, state.startedAt ?? Date.now(), current.extension), { type });
      set({ phase: "finished", file });
      resolve(file);
    };
    current.recorder.stop();
  });
}

/** Stops and throws the audio away. */
export function discardMeetingRecording() {
  const current = session;
  session = null;
  if (current) {
    window.clearInterval(current.timer);
    current.recorder.onstop = null;
    try { current.recorder.stop(); } catch { /* already stopped */ }
    stopTracks(current.streams);
    void current.context.close().catch(() => undefined);
  }
  set(IDLE);
}

/** The finished file for this meeting, once; the bar then returns to idle. */
export function takeFinishedRecording(meetingId: string): File | null {
  if (state.phase !== "finished" || state.meetingId !== meetingId || !state.file) return null;
  const file = state.file;
  set({ file: undefined });
  return file;
}

export function resetRecorder() {
  if (!session) set(IDLE);
}

/** For the save step: mark progress on the bar without exposing the setter. */
export function setRecorderNotice(notice: string | undefined, error?: string) {
  set({ notice, error });
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}
