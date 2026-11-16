/**
 * Recording a meeting in the app: the microphone, plus the audio of a shared
 * tab, window or screen when the browser offers it (system audio on desktop
 * Chrome and Edge; tab audio elsewhere). Both are mixed into one file.
 *
 * One recording at a time, held in this module so it keeps running while the
 * person moves around the app. Whoever stops it (the floating RecordingBar or
 * the Notes tab's Stop), the finished file stays in the state: the bar saves
 * it where the workspace keeps recordings, and the meeting's Transcript view
 * opens it (`takeFinishedRecording`).
 *
 * Each chunk is also written to this browser's IndexedDB as it is recorded
 * (recordingStash.ts), so a crash or closed tab doesn't lose the meeting.
 * Nothing here is sent anywhere: the audio stays in this browser until it is
 * saved where the workspace keeps recordings, or downloaded.
 */
import { useSyncExternalStore } from "react";
import { dropStash, stashChunk, type StashMeta } from "./recordingStash";

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
  /** Set once finished: the file, kept until the recording is closed. */
  file?: File;
  /** The Transcript view has opened the file. */
  transcriptTaken?: boolean;
  /** The crash-safe copy in this browser (recordingStash.ts). */
  stashId?: string;
  /** Brought back from the stash after a crash or a closed tab. */
  recovered?: boolean;
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

/** Small files: speech at 32 kbps mono is about 14 MB an hour, under transcription upload limits. */
export const RECORDING_BITS_PER_SECOND = 32_000;

type WakeLockLike = { release: () => Promise<void> };
let wakeLock: WakeLockLike | null = null;
/** Keeps a phone or laptop screen awake while recording, where the browser allows it. */
async function holdWakeLock() {
  try {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockLike> } }).wakeLock;
    if (api && !wakeLock && document.visibilityState === "visible") wakeLock = await api.request("screen");
  } catch {
    /* not allowed here; recording continues */
  }
}
function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  void lock?.release().catch(() => undefined);
}
function onVisibility() {
  // Browsers drop the lock when the page is hidden; take it again on return.
  if (session && document.visibilityState === "visible") { wakeLock = null; void holdWakeLock(); }
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
  destination.channelCount = 1;
  const { mimeType, extension } = recordingMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(destination.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
  } catch {
    recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
  }
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  const stash: StashMeta = {
    id: `${input.meetingId}:${startedAt}`,
    meetingId: input.meetingId,
    meetingTitle: input.meetingTitle,
    startedAt,
    mimeType: mimeType || recorder.mimeType || "audio/webm",
    extension,
    updatedAt: startedAt,
    elapsed: 0,
  };
  let seq = 0;
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    chunks.push(event.data);
    const now = Date.now();
    void stashChunk({ ...stash, updatedAt: now, elapsed: Math.floor((now - startedAt) / 1000) }, seq++, event.data);
  };
  // A recorder error keeps what was recorded: stop and hand the file on.
  recorder.onerror = () => {
    set({ notice: "The recording hit an error and stopped. What was recorded is kept." });
    if (session?.recorder === recorder && recorder.state !== "inactive") void stopMeetingRecording().catch(() => undefined);
  };
  // An unplugged microphone (or one another app takes) ends its track: say so, it would record silence.
  for (const track of streams[0].getAudioTracks()) {
    track.onended = () => set({
      notice: streams.length > 1
        ? "The microphone stopped (unplugged, or taken by another app). Still recording the shared audio."
        : "The microphone stopped (unplugged, or taken by another app). Stop, then start a new recording to keep going.",
    });
  }
  // A shared tab closing ends its track; keep recording the microphone.
  for (const stream of streams.slice(1)) {
    for (const track of stream.getAudioTracks()) track.onended = () => set({ sharedAudio: false, notice: "Sharing stopped; still recording your microphone." });
  }
  const buffer = new Uint8Array(512);
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
  // A chunk every few seconds, each written to the stash: a crash loses only the last few seconds.
  recorder.start(5_000);
  session = { recorder, streams, context, chunks, timer, extension, mimeType: stash.mimeType };
  document.addEventListener("visibilitychange", onVisibility);
  void holdWakeLock();
  set({ phase: "recording", startedAt, sharedAudio: streams.length > 1, notice, stashId: stash.id });
}

function endSession(current: Session) {
  window.clearInterval(current.timer);
  stopTracks(current.streams);
  void current.context.close().catch(() => undefined);
  document.removeEventListener("visibilitychange", onVisibility);
  releaseWakeLock();
}

/** Stops and returns the recorded file (also kept in the state until taken). */
export function stopMeetingRecording(): Promise<File> {
  const current = session;
  if (!current) return Promise.reject(new Error("Nothing is recording."));
  set({ phase: "stopping", level: 0 });
  return new Promise((resolve, reject) => {
    current.recorder.onstop = () => {
      endSession(current);
      session = null;
      if (!current.chunks.length) {
        set({ phase: "error", error: "Nothing was recorded." });
        reject(new Error("Nothing was recorded."));
        return;
      }
      const type = current.mimeType.split(";")[0] || "audio/webm";
      const file = new File(current.chunks, recordingFileName(state.meetingTitle, state.startedAt ?? Date.now(), current.extension), { type });
      set({ phase: "finished", file, transcriptTaken: false });
      resolve(file);
    };
    current.recorder.stop();
  });
}

/** Stops and throws the audio away, including the crash-safe copy. */
export function discardMeetingRecording() {
  const current = session;
  const stashId = state.stashId;
  session = null;
  if (current) {
    current.recorder.onstop = null;
    current.recorder.ondataavailable = null;
    try { current.recorder.stop(); } catch { /* already stopped */ }
    endSession(current);
  }
  if (stashId) void dropStash(stashId);
  set(IDLE);
}

/** The finished file for this meeting, once, for the Transcript view. The file stays for saving. */
export function takeFinishedRecording(meetingId: string): File | null {
  if (state.phase !== "finished" || state.meetingId !== meetingId || !state.file || state.transcriptTaken) return null;
  set({ transcriptTaken: true });
  return state.file;
}

/** A recording recovered from the stash: finished, to be saved like any other. */
export function adoptRecoveredRecording(meta: StashMeta, file: File) {
  if (session || (state.phase !== "idle" && state.phase !== "error")) return false;
  set({ ...IDLE, phase: "finished", meetingId: meta.meetingId, meetingTitle: meta.meetingTitle, startedAt: meta.startedAt, elapsed: meta.elapsed, file, transcriptTaken: false, stashId: meta.id, recovered: true });
  return true;
}

/** The recording is saved, downloaded or let go: forget it and its crash-safe copy. */
export function closeFinishedRecording() {
  if (session) return;
  if (state.stashId) void dropStash(state.stashId);
  set(IDLE);
}

/** Saved where the workspace keeps recordings: the crash-safe copy is no longer needed. */
export function recordingSaved() {
  if (state.stashId) void dropStash(state.stashId);
  set({ stashId: undefined });
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
