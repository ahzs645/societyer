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
  // Live stub — real Whisper call would go here. Kept as a typed placeholder
  // so demo deploys don't need the openai/whisper SDK.
  throw new Error(
    "Live transcription requires OPENAI_API_KEY / WHISPER_ENDPOINT and an action-context HTTP call.",
  );
}
