// Transcription adapter — Whisper in live mode, canned transcript in demo.
import { providers } from "./env";

export type TranscriptSegment = {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
};

export type TranscriptionResult = {
  provider: "whisper" | "demo";
  durationSeconds: number;
  language: string;
  text: string;
  segments: TranscriptSegment[];
};

function env(name: string): string | undefined {
  try {
    return (globalThis as any)?.process?.env?.[name];
  } catch {
    return undefined;
  }
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeSegments(raw: unknown): TranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((segment) => {
      const row = segment as Record<string, unknown>;
      const text = cleanText(row.text);
      if (!text) return null;
      return {
        speaker: cleanText(row.speaker) || "Speaker",
        text,
        startSec: toNumber(row.start ?? row.start_sec),
        endSec: toNumber(row.end ?? row.end_sec),
      };
    })
    .filter((segment): segment is TranscriptSegment => !!segment);
}

function fallbackFileName(args: {
  fileName?: string;
  storageKey?: string;
  mimeType?: string;
}): string {
  if (args.fileName?.trim()) return args.fileName.trim();
  const fromStorageKey = args.storageKey?.split("/").pop()?.trim();
  if (fromStorageKey) return fromStorageKey;
  const ext =
    args.mimeType === "audio/mpeg" ? "mp3" :
    args.mimeType === "audio/mp4" ? "m4a" :
    args.mimeType === "audio/wav" ? "wav" :
    args.mimeType === "audio/webm" ? "webm" :
    args.mimeType === "video/mp4" ? "mp4" :
    "bin";
  return `meeting-audio.${ext}`;
}

const DEMO_SEGMENTS: TranscriptSegment[] = [
  { speaker: "Elena Vasquez", text: "Good evening. It's 7:02, I'd like to call the meeting to order. Theo, can you confirm quorum?", startSec: 0, endSec: 8 },
  { speaker: "Theo Lafontaine", text: "Quorum is met — six directors present, Wei is absent with apologies.", startSec: 9, endSec: 14 },
  { speaker: "Elena Vasquez", text: "Thank you. First item on the agenda is the Q3 financial update. Priya?", startSec: 15, endSec: 20 },
  { speaker: "Priya Shah", text: "Revenue is tracking 8% above forecast on programs. Expenses are in line. The restricted arts fund has 42,000 remaining.", startSec: 21, endSec: 32 },
  { speaker: "Jordan Nakamura", text: "I move to accept the Q3 financial update as presented.", startSec: 33, endSec: 38 },
  { speaker: "Amara Okonkwo", text: "I second.", startSec: 39, endSec: 40 },
  { speaker: "Elena Vasquez", text: "All in favour? Motion carried, six in favour, none opposed.", startSec: 41, endSec: 46 },
  { speaker: "Elena Vasquez", text: "Next — Dmitri has disclosed a conflict on the print vendor matter. Dmitri, can you step out while we discuss?", startSec: 47, endSec: 55 },
  { speaker: "Dmitri Petrov", text: "Yes, I'll leave the room for this item.", startSec: 56, endSec: 59 },
  { speaker: "Jordan Nakamura", text: "I move that we proceed with the print RFP excluding Petrov Print Co.", startSec: 60, endSec: 67 },
  { speaker: "Wei Chen", text: "Seconded.", startSec: 68, endSec: 69 },
  { speaker: "Elena Vasquez", text: "Motion carries, five in favour, one abstention. Decision recorded: Petrov Print Co. excluded from the RFP.", startSec: 70, endSec: 78 },
  { speaker: "Elena Vasquez", text: "Action item: Jordan will issue the RFP to three qualified vendors by February 15th. Amara, fundraising plan by March 1st. Meeting adjourned at 7:46.", startSec: 79, endSec: 92 },
];

export async function transcribeAudio(args: {
  audioBytes?: Uint8Array;
  storageKey?: string;
  language?: string;
  mimeType?: string;
  fileName?: string;
}): Promise<TranscriptionResult> {
  const p = providers.transcription();
  if (p.id === "demo") {
    const text = DEMO_SEGMENTS.map((s) => `${s.speaker}: ${s.text}`).join("\n");
    return {
      provider: "demo",
      durationSeconds: 92,
      language: args.language ?? "en",
      text,
      segments: DEMO_SEGMENTS,
    };
  }

  if (!args.audioBytes?.length) {
    throw new Error("Upload an audio or video file before starting transcription.");
  }

  const endpoint = env("WHISPER_ENDPOINT") ?? "https://api.openai.com/v1/audio/transcriptions";
  const apiKey = env("WHISPER_API_KEY") ?? env("OPENAI_API_KEY");
  if (!apiKey && !env("WHISPER_ENDPOINT")) {
    throw new Error("Live transcription requires OPENAI_API_KEY or a custom WHISPER_ENDPOINT.");
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([args.audioBytes], { type: args.mimeType ?? "application/octet-stream" }),
    fallbackFileName(args),
  );
  form.append("model", env("WHISPER_MODEL") ?? "whisper-1");
  form.append("response_format", "verbose_json");
  if (args.language) form.append("language", args.language);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    body: form,
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).trim();
    throw new Error(detail || `Transcription failed with status ${res.status}.`);
  }

  const data = await res.json();
  const segments = normalizeSegments((data as any)?.segments);
  const text =
    cleanText((data as any)?.text) ||
    segments.map((segment) => `${segment.speaker}: ${segment.text}`).join("\n");

  if (!text) throw new Error("Transcription completed but returned no text.");

  return {
    provider: "whisper",
    durationSeconds: toNumber((data as any)?.duration) || segments.at(-1)?.endSec || 0,
    language: cleanText((data as any)?.language) || args.language || "en",
    text,
    segments: segments.length
      ? segments
      : [{ speaker: "Speaker", text, startSec: 0, endSec: Math.max(1, Math.ceil(text.length / 12)) }],
  };
}
