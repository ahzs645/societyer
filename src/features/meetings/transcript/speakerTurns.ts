import { speakerResolver } from "../../../../shared/transcriptModel";
import type { TranscriptSegment, TranscriptSpeaker } from "../../../../shared/transcriptModel";

/**
 * Segments as displayed: each label replaced by the speaker it resolves to.
 * Indexes, timings and words are unchanged, so edits still address raw rows.
 */
export function displaySegments<T extends TranscriptSegment>(
  segments: readonly T[],
  speakers: readonly TranscriptSpeaker[],
): readonly T[] {
  if (!speakers.some((speaker) => speaker.mergedInto)) return segments;
  const resolver = speakerResolver(speakers);
  return segments.map((segment) => {
    const speaker = resolver.resolve(segment.speaker);
    return speaker === segment.speaker ? segment : { ...segment, speaker };
  });
}

/**
 * Raw labels in order of first appearance. Colours index into this list rather
 * than the displayed speakers, so combining or unmerging never recolours anyone.
 */
export const speakerPalette = (segments: readonly Pick<TranscriptSegment, "speaker">[]) => [
  ...new Set(segments.map((segment) => segment.speaker)),
];

/** Consecutive segments by the same displayed speaker form one turn. */
export function speakerTurns(segments: readonly Pick<TranscriptSegment, "speaker">[]) {
  const turns: { label: string; indexes: number[] }[] = [];
  segments.forEach((segment, index) => {
    const previous = turns.at(-1);
    if (previous?.label === segment.speaker) previous.indexes.push(index);
    else turns.push({ label: segment.speaker, indexes: [index] });
  });
  return turns;
}

type Timed = Pick<TranscriptSegment, "speaker" | "startSec" | "endSec">;
type Range = { startSec: number; endSec: number };

/** The marked in-camera range a segment overlaps, or -1 (the read-path rule in shared/minutesPrivacy.ts). */
export function inCameraMarkIndex(segment: Pick<TranscriptSegment, "startSec" | "endSec">, marks: readonly Range[]): number {
  const end = Math.max(segment.startSec, segment.endSec);
  return marks.findIndex((mark) =>
    end > segment.startSec ? end > mark.startSec && segment.startSec < mark.endSec : segment.startSec >= mark.startSec && segment.startSec < mark.endSec);
}

/** Speaker turns, split where the transcript enters or leaves a marked in-camera range. */
export function speakerTurnsByMark(segments: readonly Timed[], marks: readonly Range[]) {
  const turns: { label: string; indexes: number[]; mark: number }[] = [];
  segments.forEach((segment, index) => {
    const mark = marks.length ? inCameraMarkIndex(segment, marks) : -1;
    const previous = turns.at(-1);
    if (previous?.label === segment.speaker && previous.mark === mark) previous.indexes.push(index);
    else turns.push({ label: segment.speaker, indexes: [index], mark });
  });
  return turns;
}
