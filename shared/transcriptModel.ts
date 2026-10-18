/** Bounded working transcript format shared by local and hosted runtimes. */
export type TranscriptWord = { text: string; startSec: number; endSec: number };
export type TranscriptSegment = {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  words?: TranscriptWord[];
};
export type TranscriptSpeaker = {
  label: string;
  name?: string;
  personId?: string;
  /**
   * Raw label this one is combined into. Segments keep their own label, so a
   * combine can be undone by removing this field. Resolved at read time.
   */
  mergedInto?: string;
};
export const TIMED_TRANSCRIPT_FILE_LIMIT = 16 * 1024 * 1024;
export const TRANSCRIPT_ROW_LIMIT = 700_000;
/** Longest combine chain (A → B → C …) a speaker map may hold. */
export const SPEAKER_MERGE_MAX_DEPTH = 8;
export const normalizeTranscriptText = (text: string) => text.replace(/\s+/g, " ").trim();

/** Steps from `label` to the speaker it finally resolves to; `Infinity` on a cycle or overlong chain. */
function mergeChain(label: string, byLabel: ReadonlyMap<string, TranscriptSpeaker>) {
  const seen = [label];
  let current = label;
  for (;;) {
    const next = byLabel.get(current)?.mergedInto;
    if (!next || next === current) return { target: current, depth: seen.length - 1 };
    if (seen.includes(next) || seen.length > SPEAKER_MERGE_MAX_DEPTH) {
      return { target: label, depth: Infinity };
    }
    seen.push(next);
    current = next;
  }
}

/**
 * Resolve combined speakers once per speaker map. A cycle or an overlong chain
 * (never written by the mutations) leaves the label standing on its own.
 */
export function speakerResolver(speakers: readonly TranscriptSpeaker[] = []) {
  const byLabel = new Map(speakers.map((speaker) => [speaker.label, speaker]));
  const resolve = (label: string) => mergeChain(label, byLabel).target;
  return {
    resolve,
    depth: (label: string) => mergeChain(label, byLabel).depth,
    name: (label: string) => {
      const target = resolve(label);
      return byLabel.get(target)?.name || target;
    },
  };
}
export const resolveSpeakerLabel = (label: string, speakers: readonly TranscriptSpeaker[] = []) =>
  speakerResolver(speakers).resolve(label);
export const speakerName = (label: string, speakers: readonly TranscriptSpeaker[] = []) =>
  speakerResolver(speakers).name(label);
export const transcriptText = (
  segments: readonly TranscriptSegment[],
  speakers: readonly TranscriptSpeaker[] = [],
) => {
  const resolver = speakerResolver(speakers);
  return segments.map((segment) => `${resolver.name(segment.speaker)}: ${segment.text}`).join("\n");
};
/** Speakers as displayed: distinct resolved labels in order of first appearance. */
export function resolvedSpeakerLabels(
  segments: readonly TranscriptSegment[],
  speakers: readonly TranscriptSpeaker[] = [],
) {
  const resolver = speakerResolver(speakers);
  return [...new Set(segments.map((segment) => resolver.resolve(segment.speaker)))];
}

export function validateTranscriptSegments(segments: readonly TranscriptSegment[]) {
  if (!segments.length || segments.length > 20_000)
    throw new Error("Use between 1 and 20,000 transcript segments.");
  let previous = -1;
  for (const segment of segments) {
    const { startSec, endSec } = segment;
    if (
      ![startSec, endSec].every(Number.isFinite) ||
      startSec < 0 ||
      endSec < startSec ||
      startSec < previous
    )
      throw new Error("Segment times must be finite, non-negative, ordered, and start before they end.");
    previous = startSec;
    if (
      !segment.text.trim() ||
      segment.text.length > 20_000 ||
      !segment.speaker.trim() ||
      segment.speaker.length > 200
    )
      throw new Error(
        "Each segment needs text (up to 20,000 characters) and a speaker label (up to 200 characters).",
      );
    if (segment.words) {
      if (segment.words.length > 10_000) throw new Error("Too many words in one segment.");
      let wordStart = startSec;
      for (const word of segment.words) {
        if (
          !word.text.trim() ||
          word.text.length > 1000 ||
          ![word.startSec, word.endSec].every(Number.isFinite) ||
          word.startSec < wordStart ||
          word.endSec < word.startSec ||
          word.endSec > endSec
        )
          throw new Error("Word timings must be ordered and inside their segment.");
        wordStart = word.startSec;
      }
    }
  }
}

/** A minutes item's position in the recording (`motions.transcriptRef`, action items). */
export type TranscriptRef = { startSec: number; endSec: number };
/** A day is far beyond any meeting; it only rejects nonsense input. */
export const TRANSCRIPT_REF_MAX_SEC = 24 * 60 * 60;

export function validateTranscriptRef(startSec: number, endSec: number): TranscriptRef {
  if (
    ![startSec, endSec].every(Number.isFinite) ||
    startSec < 0 ||
    endSec < startSec ||
    endSec > TRANSCRIPT_REF_MAX_SEC
  )
    throw new Error("Transcript times must be finite, non-negative, and start at or before they end.");
  return { startSec, endSec };
}
