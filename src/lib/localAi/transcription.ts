/**
 * ON-DEVICE SPEECH-TO-TEXT — "Transcribe on this device" in the Transcript tab.
 *
 * - Browser-local workspace: one multipart POST from this page, straight from
 *   the `File` the person opened (the browser reads it from disk as it sends).
 *   The server must allow this page's origin (CORS).
 * - Desktop app: the recording is copied to the main process in 8 MB pieces
 *   (never one huge IPC message). The main process keeps it in a private
 *   temporary file, converts it with ffmpeg when ffmpeg is installed (16 kHz
 *   mono WAV, ~10-minute overlapping parts for long recordings), sends it to
 *   the configured server with the key from the OS keychain, and deletes it.
 *   See electron/localTranscription.ts.
 *
 * Either way the replies are parsed and merged here with the shared rules in
 * shared/ai/transcription.ts, and the caller saves the result through the
 * portable `transcripts:importTimed`. Errors are DeviceAiError with a plain
 * message; provider bodies are never shown.
 */
import { getDesktopBridge, type DesktopTranscriptionEvent, type SocietyerDesktopBridge } from "../desktopBridge";
import {
  finishTranscription,
  mergeTranscriptionParts,
  parseTranscriptionReply,
  speechFormFields,
  speechRequestUrl,
  type SpeechToTextKind,
} from "../../../shared/ai/transcription";
import type { TranscriptSegment } from "../../../shared/transcriptModel";
import { browserDeviceAiKey, deviceAiSnapshot } from "./config";
import { DeviceAiError, browserNetworkError } from "./transport";

/** Pieces copied to the desktop main process. */
export const DESKTOP_UPLOAD_PIECE_BYTES = 8 * 1024 * 1024;
/** Larger recordings are refused before anything is sent. */
export const LOCAL_TRANSCRIPTION_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** A runaway bound only; the person can cancel at any time. */
export const TRANSCRIPTION_TIMEOUT_MS = 3 * 60 * 60_000;
export const SPEECH_TEST_TIMEOUT_MS = 60_000;

/** How to allow this page's origin on the common speech servers. */
const SPEECH_SERVER_CORS_STEPS =
  "whisper.cpp's server allows this by default; for speaches or faster-whisper-server, allow this page's address in its CORS setting. The desktop app does not need this.";

export type SpeechProgress =
  | { phase: "uploading"; sentBytes: number; totalBytes: number }
  | { phase: "converting" }
  /** `part` counts from 1. */
  | { phase: "transcribing"; part: number; parts: number };

export type SpeechReplies = {
  parts: Array<{ offsetSec: number; body: string }>;
  overlapSec: number;
  /** The desktop app prepared the audio with ffmpeg. */
  converted: boolean;
};

export type SpeechTransport = {
  kind: "direct" | "desktop";
  transcribe(input: {
    file: Blob;
    fileName: string;
    signal: AbortSignal;
    onProgress?: (progress: SpeechProgress) => void;
  }): Promise<SpeechReplies>;
};

export type SpeechEndpoint = { kind: SpeechToTextKind; baseUrl: string; model: string; apiKey: string };

/** Plain messages for HTTP failures from a speech-to-text server. */
export function speechStatusMessage(status: number): string {
  if (status === 400 || status === 422) return "The speech-to-text server could not read this request. Check the server kind, the model name, and that the server accepts this audio format.";
  if (status === 401 || status === 403) return "The speech-to-text server rejected the API key.";
  if (status === 404) return "The speech-to-text address was not found. Check the server kind and address in Settings.";
  if (status === 413) return "The recording is too large for the speech-to-text server.";
  if (status === 415) return "The speech-to-text server does not accept this audio format. whisper.cpp needs --convert (and ffmpeg) for anything but WAV.";
  if (status === 408 || status === 504) return "The speech-to-text server took too long to answer.";
  if (status >= 500) return "The speech-to-text server had an internal error. Try again shortly.";
  return `The speech-to-text server returned an error (status ${status}).`;
}

function stopped(signal?: AbortSignal): DeviceAiError {
  const reason: unknown = signal?.reason;
  return reason instanceof DeviceAiError ? reason : new DeviceAiError("aborted", "Transcription was cancelled.");
}

export function directSpeechTransport(endpoint: () => SpeechEndpoint, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): SpeechTransport {
  return {
    kind: "direct",
    async transcribe({ file, fileName, signal, onProgress }) {
      const { kind, baseUrl, model, apiKey } = endpoint();
      if (!baseUrl) throw new DeviceAiError("not_configured", "On-device speech-to-text has no server address.");
      const form = new FormData();
      for (const [name, value] of speechFormFields(kind, { model })) form.append(name, value);
      form.append("file", file, fileName);
      const headers: Record<string, string> = { accept: "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      onProgress?.({ phase: "transcribing", part: 1, parts: 1 });
      const url = speechRequestUrl(kind, baseUrl);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers,
          body: form,
          signal,
          // A speech server never needs this page's cookies.
          credentials: "omit",
          redirect: "error",
        });
      } catch {
        if (signal.aborted) throw stopped(signal);
        const failure = await browserNetworkError(url, { fetchImpl, corsSteps: SPEECH_SERVER_CORS_STEPS, signal });
        throw signal.aborted ? stopped(signal) : failure;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new DeviceAiError("status", speechStatusMessage(response.status), { status: response.status });
      }
      try {
        return { parts: [{ offsetSec: 0, body: await response.text() }], overlapSec: 0, converted: false };
      } catch {
        if (signal.aborted) throw stopped(signal);
        throw new DeviceAiError("network", "The connection to the speech-to-text server was interrupted.");
      }
    },
  };
}

function newRequestId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `stt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Electron prefixes invoke failures with the channel name; keep the reason. */
function invokeMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") || fallback;
}

function desktopProgress(event: DesktopTranscriptionEvent): SpeechProgress {
  return event.type === "converting" ? { phase: "converting" } : { phase: "transcribing", part: event.index + 1, parts: event.total };
}

export function desktopSpeechTransport(bridge: Pick<SocietyerDesktopBridge, "localAiTranscriptionUpload" | "localAiTranscribe" | "localAiAbort">, pieceBytes = DESKTOP_UPLOAD_PIECE_BYTES): SpeechTransport {
  return {
    kind: "desktop",
    async transcribe({ file, fileName, signal, onProgress }) {
      const requestId = newRequestId();
      const abort = () => void bridge.localAiAbort(requestId).catch(() => undefined);
      if (signal.aborted) throw stopped(signal);
      signal.addEventListener("abort", abort, { once: true });
      try {
        // Ordered pieces, each read from the File only when it is sent.
        let offset = 0;
        while (offset < file.size) {
          const bytes = await file.slice(offset, offset + pieceBytes).arrayBuffer();
          if (signal.aborted) throw stopped(signal);
          const { received } = await bridge.localAiTranscriptionUpload({ requestId, fileName, totalBytes: file.size, offset, bytes });
          if (received <= offset) throw new DeviceAiError("network", "The recording could not be handed to the desktop app.");
          offset = received;
          onProgress?.({ phase: "uploading", sentBytes: received, totalBytes: file.size });
        }
        const result = await bridge.localAiTranscribe({ requestId }, (event) => onProgress?.(desktopProgress(event)));
        if (signal.aborted) throw stopped(signal);
        if (!result.ok) {
          throw new DeviceAiError(result.code, result.code === "status" && result.status ? speechStatusMessage(result.status) : result.message, { status: result.status });
        }
        return { parts: result.parts, overlapSec: result.overlapSec, converted: result.converted };
      } catch (error) {
        if (signal.aborted) throw stopped(signal);
        if (error instanceof DeviceAiError) throw error;
        throw new DeviceAiError("network", invokeMessage(error, "Could not reach the speech-to-text server."));
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
}

/** The transport for this runtime, reading the cached device settings. */
export function deviceSpeechTransport(): SpeechTransport {
  const bridge = getDesktopBridge();
  if (bridge) return desktopSpeechTransport(bridge);
  return directSpeechTransport(() => {
    const speech = deviceAiSnapshot().config.speechToText;
    if (speech.kind === "none") throw new DeviceAiError("not_configured", "On-device speech-to-text is off.");
    return { kind: speech.kind, baseUrl: speech.baseUrl, model: speech.model, apiKey: browserDeviceAiKey("speech") };
  });
}

export type LocalTranscript = {
  provider: "local-whisper";
  segments: TranscriptSegment[];
  durationSeconds: number;
  /** Distinct speaker labels from the server (0 without diarization). */
  speakerCount: number;
  /** Server requests made (more than one when a long recording was sent in parts). */
  parts: number;
};

/** An AbortSignal that fires on the caller's signal or after `ms`. */
function deadline(ms: number, outer?: AbortSignal) {
  const controller = new AbortController();
  const onOuter = () => controller.abort(new DeviceAiError("aborted", "Transcription was cancelled."));
  if (outer?.aborted) onOuter();
  outer?.addEventListener("abort", onOuter, { once: true });
  const timer = setTimeout(() => controller.abort(new DeviceAiError("timeout", "The speech-to-text server took too long to answer.")), ms);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

function parseReplies(replies: SpeechReplies) {
  try {
    return replies.parts.map((part) => ({ offsetSec: part.offsetSec, parsed: parseTranscriptionReply(part.body) }));
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new DeviceAiError("bad_reply", `The speech-to-text server's reply could not be read.${detail}`);
  }
}

/**
 * Transcribes one recording into timed segments ready for
 * `transcripts:importTimed`. Throws DeviceAiError; nothing is saved here.
 */
export async function transcribeRecording(input: {
  transport: SpeechTransport;
  file: Blob;
  fileName: string;
  signal?: AbortSignal;
  onProgress?: (progress: SpeechProgress) => void;
  timeoutMs?: number;
}): Promise<LocalTranscript> {
  if (!input.file.size) throw new DeviceAiError("refused", "The recording is empty.");
  if (input.file.size > LOCAL_TRANSCRIPTION_MAX_BYTES) throw new DeviceAiError("refused", "Recordings over 2 GB cannot be transcribed on this device.");
  const limit = deadline(input.timeoutMs ?? TRANSCRIPTION_TIMEOUT_MS, input.signal);
  try {
    const replies = await input.transport.transcribe({ file: input.file, fileName: input.fileName, signal: limit.signal, onProgress: input.onProgress });
    const parts = parseReplies(replies);
    const merged = mergeTranscriptionParts(
      parts.map((part) => ({ offsetSec: part.offsetSec, segments: part.parsed.segments })),
      replies.overlapSec,
    );
    const lastEnd = Math.max(0, ...parts.map((part) => part.offsetSec + part.parsed.durationSec));
    let finished: ReturnType<typeof finishTranscription>;
    try {
      finished = finishTranscription(merged, lastEnd);
    } catch (error) {
      throw new DeviceAiError("bad_reply", error instanceof Error ? error.message : "The transcription could not be used.");
    }
    return {
      provider: "local-whisper",
      ...finished,
      speakerCount: new Set(merged.map((segment) => segment.speaker).filter((label) => label !== "Speaker")).size,
      parts: parts.length,
    };
  } catch (error) {
    const reason: unknown = limit.signal.reason;
    if (limit.signal.aborted && reason instanceof DeviceAiError) throw reason;
    throw error;
  } finally {
    limit.clear();
  }
}

/** One second of 16 kHz mono silence as a WAV file, for Test connection. */
export function silentWav(seconds = 1, sampleRate = 16_000): Uint8Array {
  const samples = Math.round(seconds * sampleRate);
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples * 2));
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return bytes;
}

export type SpeechTestResult = { ok: true; latencyMs: number } | { ok: false; message: string; hint?: string };

/**
 * Sends a second of silence through the same path as a real recording and
 * checks the reply is readable (no speech is expected).
 */
export async function testSpeechToText(transport: SpeechTransport = deviceSpeechTransport(), signal?: AbortSignal): Promise<SpeechTestResult> {
  const started = Date.now();
  const limit = deadline(SPEECH_TEST_TIMEOUT_MS, signal);
  try {
    const replies = await transport.transcribe({ file: new Blob([silentWav()], { type: "audio/wav" }), fileName: "societyer-test.wav", signal: limit.signal });
    parseReplies(replies);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    const reason: unknown = limit.signal.reason;
    const failure = limit.signal.aborted && reason instanceof DeviceAiError ? reason : error;
    if (failure instanceof DeviceAiError) return { ok: false, message: failure.message, hint: failure.hint };
    return { ok: false, message: "Could not reach the speech-to-text server." };
  } finally {
    limit.clear();
  }
}
