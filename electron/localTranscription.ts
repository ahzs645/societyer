/**
 * Desktop on-device transcription (no Electron imports, so it runs under Node
 * in scripts/check-local-transcription.ts).
 *
 * Why a temporary file: a recording can be hundreds of megabytes. The renderer
 * copies the File it already holds in ordered 8 MB pieces
 * (`TranscriptionUploads.write`), so no IPC message is ever large and the main
 * process can only receive bytes the person chose. The file lives in a private
 * `societyer-stt-*` folder under the OS temp directory and is deleted when the
 * transcription ends, fails or is cancelled (or after 5 idle minutes).
 *
 * When ffmpeg is installed (found like LibreOffice in intakeFiles.ts), the
 * recording becomes 16 kHz mono WAV, in ~10-minute parts that overlap by 5 s
 * for long recordings. Servers that label speakers get the whole recording in
 * one part, because each part would be diarized with its own labels. Without
 * ffmpeg, or when it cannot read the file, the original is sent as it is.
 *
 * Replies are returned raw, in order, with each part's offset; the renderer
 * parses and merges them (shared/ai/transcription.ts).
 */
import { execFile, spawn } from "node:child_process";
import { openAsBlob } from "node:fs";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { DesktopLocalAiConfig, DesktopTranscriptionEvent, DesktopTranscriptionResult } from "../src/lib/desktopBridge";
import {
  planAudioChunks,
  SPEECH_CHUNK_OVERLAP_SECONDS,
  speechFormFields,
  speechKindInfo,
  type AudioChunk,
} from "../shared/ai/speechRequest.js";
import { LocalAiProxyError, speechProxyTargetUrl } from "./localAiProxy.js";

const run = promisify(execFile);

export const TRANSCRIPTION_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const TRANSCRIPTION_PIECE_MAX_BYTES = 16 * 1024 * 1024;
export const TRANSCRIPTION_REPLY_MAX_BYTES = 64 * 1024 * 1024;
/** One server request (one part); the renderer can cancel sooner. */
export const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 60 * 60_000;
const UPLOAD_IDLE_MS = 5 * 60_000;
const FFMPEG_TIMEOUT_MS = 30 * 60_000;

// --- Uploads -----------------------------------------------------------------

export type CompletedUpload = { dir: string; file: string; fileName: string; bytes: number };

type Upload = CompletedUpload & { totalBytes: number; received: number; handle: FileHandle | null; idle?: ReturnType<typeof setTimeout> };

function safeExtension(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

/** Recordings being copied from the renderer, keyed by `${senderId}:${requestId}`. */
export class TranscriptionUploads {
  private readonly uploads = new Map<string, Upload>();

  constructor(private readonly tempRoot = os.tmpdir()) {}

  /** Appends one piece; offset 0 starts over. Returns the bytes received so far. */
  async write(key: string, input: { fileName: string; totalBytes: number; offset: number; bytes: Uint8Array }): Promise<number> {
    if (input.totalBytes < 1 || input.totalBytes > TRANSCRIPTION_MAX_BYTES) throw new Error("Recordings over 2 GB cannot be transcribed on this device.");
    if (input.bytes.byteLength > TRANSCRIPTION_PIECE_MAX_BYTES) throw new Error("The recording piece is too large.");
    if (input.offset === 0) {
      await this.discard(key);
      const dir = await mkdtemp(path.join(this.tempRoot, "societyer-stt-"));
      const file = path.join(dir, `recording${safeExtension(input.fileName)}`);
      const handle = await open(file, "wx", 0o600);
      this.uploads.set(key, { dir, file, fileName: path.basename(input.fileName).slice(0, 200) || "recording", bytes: 0, totalBytes: input.totalBytes, received: 0, handle });
    }
    const upload = this.uploads.get(key);
    if (!upload || !upload.handle || upload.received !== input.offset || upload.totalBytes !== input.totalBytes) {
      throw new Error("The recording arrived out of order. Try again.");
    }
    if (upload.received + input.bytes.byteLength > upload.totalBytes) throw new Error("The recording is larger than announced.");
    await upload.handle.write(input.bytes);
    upload.received += input.bytes.byteLength;
    upload.bytes = upload.received;
    if (upload.received === upload.totalBytes) {
      await upload.handle.close();
      upload.handle = null;
    }
    this.touch(key, upload);
    return upload.received;
  }

  /** Hands over a complete upload; the caller deletes `dir` when done. */
  take(key: string): CompletedUpload | null {
    const upload = this.uploads.get(key);
    if (!upload || upload.received !== upload.totalBytes) return null;
    this.uploads.delete(key);
    if (upload.idle) clearTimeout(upload.idle);
    return { dir: upload.dir, file: upload.file, fileName: upload.fileName, bytes: upload.bytes };
  }

  async discard(key: string) {
    const upload = this.uploads.get(key);
    if (!upload) return;
    this.uploads.delete(key);
    if (upload.idle) clearTimeout(upload.idle);
    await upload.handle?.close().catch(() => undefined);
    await rm(upload.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  get size() {
    return this.uploads.size;
  }

  private touch(key: string, upload: Upload) {
    if (upload.idle) clearTimeout(upload.idle);
    upload.idle = setTimeout(() => void this.discard(key), UPLOAD_IDLE_MS);
    upload.idle.unref?.();
  }
}

// --- ffmpeg -------------------------------------------------------------------

let ffmpegPath: string | null | undefined;

/** ffmpeg from FFMPEG_PATH, the PATH, or the usual install places (apps opened from Finder get a short PATH). */
export async function findFfmpeg(): Promise<string | null> {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const candidates = [process.env.FFMPEG_PATH, "ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "C:\\ffmpeg\\bin\\ffmpeg.exe"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      await run(candidate, ["-version"], { timeout: 20_000 });
      ffmpegPath = candidate;
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  ffmpegPath = null;
  return null;
}

/** "Duration: 01:02:03.45" in ffmpeg's banner, in seconds (0 when absent). */
export function parseFfmpegDuration(banner: string): number {
  const match = banner.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

/** ffmpeg prints the input's details on stderr and exits non-zero without an output file. */
function probeDuration(ffmpeg: string, file: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-nostdin", "-i", file], { signal, stdio: ["ignore", "ignore", "pipe"] });
    let banner = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (banner.length < 200_000) banner += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", () => resolve(parseFfmpegDuration(banner)));
  });
}

/** The ffmpeg arguments for one 16 kHz mono WAV part (or the whole recording). */
export function wavArgs(input: string, output: string, chunk: AudioChunk | null): string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    ...(chunk ? ["-ss", chunk.startSec.toFixed(3)] : []),
    "-i", input,
    ...(chunk ? ["-t", chunk.lengthSec.toFixed(3)] : []),
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", output,
  ];
}

// --- Requests -------------------------------------------------------------------

const MIME_BY_EXTENSION: Record<string, string> = {
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "audio/webm",
  ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
};

export type SpeechCall = {
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  speech: DesktopLocalAiConfig["speechToText"];
  apiKey: string | null;
  signal: AbortSignal;
};

class SpeechStatusError extends Error {
  constructor(readonly status: number) {
    super(`status ${status}`);
  }
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > TRANSCRIPTION_REPLY_MAX_BYTES) throw new LocalAiProxyError("refused", "The speech-to-text server's reply was too large.");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > TRANSCRIPTION_REPLY_MAX_BYTES) throw new LocalAiProxyError("refused", "The speech-to-text server's reply was too large.");
  return new TextDecoder().decode(buffer);
}

/** One multipart POST; the file is streamed from disk, never read into memory. */
export async function postRecording(call: SpeechCall, file: string, fileName: string): Promise<string> {
  if (call.speech.kind === "none") throw new LocalAiProxyError("refused", "On-device speech-to-text is off.");
  const url = speechProxyTargetUrl(call.speech);
  const form = new FormData();
  for (const [name, value] of speechFormFields(call.speech.kind, { model: call.speech.model })) form.append(name, value);
  const type = MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
  form.append("file", await openAsBlob(file, { type }), fileName);
  const headers: Record<string, string> = { accept: "application/json" };
  if (call.apiKey) headers.authorization = `Bearer ${call.apiKey}`;
  const signal = AbortSignal.any([call.signal, AbortSignal.timeout(TRANSCRIPTION_REQUEST_TIMEOUT_MS)]);
  const response = await call.fetchImpl(url, { method: "POST", headers, body: form, signal, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new SpeechStatusError(response.status);
  }
  return readLimited(response);
}

function failure(error: unknown, signal: AbortSignal): Extract<DesktopTranscriptionResult, { ok: false }> {
  if (signal.aborted) return { ok: false, code: "aborted", message: "Transcription was cancelled." };
  if (error instanceof SpeechStatusError) return { ok: false, code: "status", status: error.status, message: `The speech-to-text server returned an error (status ${error.status}).` };
  if (error instanceof LocalAiProxyError) return { ok: false, code: error.code, message: error.message };
  if (error instanceof Error && error.name === "TimeoutError") return { ok: false, code: "timeout", message: "The speech-to-text server took too long to answer." };
  return { ok: false, code: "network", message: "Could not reach the speech-to-text server. Check that it is running." };
}

export type TranscribeUploadInput = SpeechCall & {
  upload: CompletedUpload;
  emit: (event: DesktopTranscriptionEvent) => void;
  /** Resolved ffmpeg path, `null` for none; omitted to look it up. */
  ffmpeg?: string | null;
};

/** Converts (when ffmpeg is there), sends each part in order, and returns the raw replies. */
export async function transcribeUpload(input: TranscribeUploadInput): Promise<DesktopTranscriptionResult> {
  try {
    speechProxyTargetUrl(input.speech);
    const ffmpeg = input.ffmpeg === undefined ? await findFfmpeg() : input.ffmpeg;
    const sendOriginal = async (): Promise<DesktopTranscriptionResult> => {
      input.emit({ type: "part", index: 0, total: 1 });
      const body = await postRecording(input, input.upload.file, input.upload.fileName);
      return { ok: true, parts: [{ offsetSec: 0, body }], overlapSec: 0, converted: false };
    };
    const converted = ffmpeg ? await convertedParts(ffmpeg, input) : null;
    if (!ffmpeg || !converted) return await sendOriginal();
    const parts: Array<{ offsetSec: number; body: string }> = [];
    for (const [index, part] of converted.entries()) {
      if (input.signal.aborted) break;
      try {
        await run(ffmpeg, wavArgs(input.upload.file, part.file, part.chunk), { signal: input.signal, timeout: FFMPEG_TIMEOUT_MS });
      } catch (error) {
        if (input.signal.aborted) throw error;
        // ffmpeg cannot decode it: let the server try the original.
        if (index === 0) return await sendOriginal();
        throw new LocalAiProxyError("refused", `ffmpeg could not convert part ${index + 1} of the recording.`);
      }
      input.emit({ type: "part", index, total: converted.length });
      parts.push({ offsetSec: part.chunk?.startSec ?? 0, body: await postRecording(input, part.file, path.basename(part.file)) });
      await rm(part.file, { force: true });
    }
    if (input.signal.aborted) return failure(null, input.signal);
    return { ok: true, parts, overlapSec: converted.length > 1 ? SPEECH_CHUNK_OVERLAP_SECONDS : 0, converted: true };
  } catch (error) {
    return failure(error, input.signal);
  }
}

/**
 * The WAV parts to make, or null to send the original (ffmpeg could not read
 * it, or reported no duration).
 */
async function convertedParts(ffmpeg: string, input: TranscribeUploadInput): Promise<Array<{ file: string; chunk: AudioChunk | null }> | null> {
  input.emit({ type: "converting" });
  let duration = 0;
  try {
    duration = await probeDuration(ffmpeg, input.upload.file, input.signal);
  } catch {
    if (input.signal.aborted) throw new LocalAiProxyError("aborted", "Transcription was cancelled.");
    return null;
  }
  if (!duration) return null;
  const chunks = speechKindInfo(input.speech.kind === "none" ? "openai-compatible" : input.speech.kind).speakers ? [] : planAudioChunks(duration);
  if (chunks.length <= 1) return [{ file: path.join(input.upload.dir, "part-0.wav"), chunk: null }];
  return chunks.map((chunk, index) => ({ file: path.join(input.upload.dir, `part-${index}.wav`), chunk }));
}
