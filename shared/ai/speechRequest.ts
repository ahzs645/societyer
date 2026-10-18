/**
 * Speech-to-text requests: the server kinds, their paths and multipart
 * fields, and how long recordings are cut into parts. Dependency-free, so the
 * desktop main process can import it at runtime (as ../shared/ai/speechRequest.js)
 * as well as the page and the checks. Reply parsing is in ./transcription.ts.
 */

export type SpeechToTextKind = "openai-compatible" | "whisper-cpp" | "whisperx";
export type SpeechPath = "/audio/transcriptions" | "/inference";
export const SPEECH_PATHS: readonly SpeechPath[] = ["/audio/transcriptions", "/inference"];

export type SpeechToTextKindInfo = {
  kind: SpeechToTextKind;
  label: string;
  /** Prefilled address. */
  baseUrl: string;
  path: SpeechPath;
  /** The server labels speakers. Such recordings are sent whole: per-part labels would not match. */
  speakers: boolean;
};

export const SPEECH_TO_TEXT_KINDS: readonly SpeechToTextKindInfo[] = [
  {
    kind: "openai-compatible",
    label: "OpenAI-compatible /v1/audio/transcriptions (faster-whisper / speaches / LM Studio if supported)",
    baseUrl: "http://127.0.0.1:8000/v1",
    path: "/audio/transcriptions",
    speakers: false,
  },
  {
    kind: "whisper-cpp",
    label: "whisper.cpp server (/inference)",
    baseUrl: "http://127.0.0.1:8081",
    path: "/inference",
    speakers: false,
  },
  {
    kind: "whisperx",
    label: "WhisperX-style JSON (speakers)",
    baseUrl: "http://127.0.0.1:8000/v1",
    path: "/audio/transcriptions",
    speakers: true,
  },
];

export function isSpeechToTextKind(value: unknown): value is SpeechToTextKind {
  return SPEECH_TO_TEXT_KINDS.some((entry) => entry.kind === value);
}

export function speechKindInfo(kind: SpeechToTextKind): SpeechToTextKindInfo {
  return SPEECH_TO_TEXT_KINDS.find((entry) => entry.kind === kind) ?? SPEECH_TO_TEXT_KINDS[0];
}

/** e.g. http://127.0.0.1:8000/v1/audio/transcriptions or http://127.0.0.1:8081/inference */
export function speechRequestUrl(kind: SpeechToTextKind, baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}${speechKindInfo(kind).path}`;
}

/**
 * The multipart fields besides `file`. OpenAI-style servers get word and
 * segment timestamps; whisper.cpp gets its own field names. Unknown fields are
 * ignored by these servers, so `diarize` is safe to send to WhisperX servers.
 */
export function speechFormFields(kind: SpeechToTextKind, options: { model?: string; language?: string } = {}): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  const model = options.model?.trim();
  const language = options.language?.trim();
  if (kind === "whisper-cpp") {
    fields.push(["response_format", "verbose_json"], ["temperature", "0.0"], ["temperature_inc", "0.2"]);
  } else {
    if (model) fields.push(["model", model]);
    fields.push(["response_format", "verbose_json"], ["timestamp_granularities[]", "word"], ["timestamp_granularities[]", "segment"]);
    if (kind === "whisperx") fields.push(["diarize", "true"]);
  }
  if (language) fields.push(["language", language]);
  return fields;
}

// --- Long recordings in parts -------------------------------------------------

export const SPEECH_CHUNK_SECONDS = 600;
export const SPEECH_CHUNK_OVERLAP_SECONDS = 5;
/** A last part shorter than this is folded into the one before it. */
const MIN_TAIL_SECONDS = 30;

export type AudioChunk = { startSec: number; lengthSec: number };

/** ~10-minute parts that overlap by a few seconds, so no word is cut at a boundary. */
export function planAudioChunks(durationSec: number, chunkSec = SPEECH_CHUNK_SECONDS, overlapSec = SPEECH_CHUNK_OVERLAP_SECONDS): AudioChunk[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const chunks: AudioChunk[] = [];
  for (let startSec = 0; startSec < durationSec; startSec += chunkSec) {
    const rest = durationSec - startSec;
    if (rest <= chunkSec + overlapSec + MIN_TAIL_SECONDS) {
      chunks.push({ startSec, lengthSec: rest });
      break;
    }
    chunks.push({ startSec, lengthSec: chunkSec + overlapSec });
  }
  return chunks;
}
