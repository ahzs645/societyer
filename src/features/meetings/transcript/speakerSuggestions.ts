import { speakerResolver } from "../../../../shared/transcriptModel";
import type { TranscriptSegment, TranscriptSpeaker } from "../../../../shared/transcriptModel";
import { isUnnamedSpeaker } from "./transcriptLinks";

/** The parts of an attendee a suggestion needs (see `Attendee` in SpeakerPanel). */
export type SuggestionAttendee = { name: string; personId?: string };

export type SpeakerSuggestion =
  | { kind: "combine"; id: string; label: string; into: string; reason: string }
  | { kind: "assign"; id: string; label: string; name: string; personId?: string; reason: string };

/** Case, surrounding space and `_` versus space do not make a different speaker. */
export const normalizeSpeakerKey = (label: string) =>
  label
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim();

const firstWord = (name: string) => normalizeSpeakerKey(name).split(" ")[0] ?? "";

/** After an import, review speakers when there is more than one or any is still a raw diarization label. */
export function needsSpeakerReview(segments: readonly TranscriptSegment[]) {
  const labels = [...new Set(segments.map((segment) => segment.speaker.trim()))];
  return labels.length >= 2 || labels.some((label) => isUnnamedSpeaker(label, label));
}

export type SpeakerStat = { time: number; count: number; first: number; sample?: number };

/**
 * Talk time, line count, first line and a sample line (six words or more) per
 * displayed speaker (`resolved`) and per raw label (`raw`). `mergedUnder` lists
 * the raw labels combined into each displayed speaker, in order of appearance.
 */
export function speakerStats(
  segments: readonly TranscriptSegment[],
  speakers: readonly TranscriptSpeaker[] = [],
) {
  const resolver = speakerResolver(speakers);
  const resolved = new Map<string, SpeakerStat>();
  const raw = new Map<string, SpeakerStat>();
  const mergedUnder = new Map<string, string[]>();
  const add = (rows: Map<string, SpeakerStat>, label: string, segment: TranscriptSegment, index: number) => {
    const row = rows.get(label) ?? { time: 0, count: 0, first: index };
    row.time += Math.max(0, segment.endSec - segment.startSec);
    row.count += 1;
    if (row.sample === undefined && segment.text.split(/\s+/).length >= 6) row.sample = index;
    rows.set(label, row);
  };
  segments.forEach((segment, index) => {
    const target = resolver.resolve(segment.speaker);
    if (target !== segment.speaker && !raw.has(segment.speaker)) {
      mergedUnder.set(target, [...(mergedUnder.get(target) ?? []), segment.speaker]);
    }
    add(resolved, target, segment, index);
    add(raw, segment.speaker, segment, index);
  });
  return { resolved, raw, mergedUnder };
}

/**
 * One-click suggestions for the Review speakers step. Pure: works only from the
 * displayed labels, the speaker map and the attendee list.
 *
 * - Labels that are equal after normalising (`speaker_03` and `SPEAKER_03`)
 *   are suggested to combine into the named one, or else the one heard longest.
 * - A label that is an attendee's name (or their unique first name) is
 *   suggested to be assigned to them. When that attendee already has a label,
 *   or several labels match them, the extra labels are suggested to combine.
 */
export function speakerSuggestions({
  labels,
  speakers,
  attendees,
  talkTime = new Map<string, number>(),
}: {
  /** Displayed labels: resolved, in order of first appearance. */
  labels: readonly string[];
  speakers: readonly TranscriptSpeaker[];
  attendees: readonly SuggestionAttendee[];
  talkTime?: ReadonlyMap<string, number>;
}): SpeakerSuggestion[] {
  const entries = new Map(speakers.map((speaker) => [speaker.label, speaker]));
  const named = (label: string) => Boolean(entries.get(label)?.name || entries.get(label)?.personId);
  const rank = (a: string, b: string) =>
    Number(named(b)) - Number(named(a)) ||
    (talkTime.get(b) ?? 0) - (talkTime.get(a) ?? 0) ||
    labels.indexOf(a) - labels.indexOf(b);
  const suggestions: SpeakerSuggestion[] = [];
  const combined = new Set<string>();
  const combine = (group: readonly string[], reason: string, into?: string) => {
    const [target, ...rest] = into ? [into, ...group] : [...group].sort(rank);
    for (const label of rest) {
      if (label === target || combined.has(label)) continue;
      combined.add(label);
      suggestions.push({ kind: "combine", id: `combine:${label}`, label, into: target, reason });
    }
    return target;
  };

  const byKey = new Map<string, string[]>();
  for (const label of labels) {
    const key = normalizeSpeakerKey(label);
    byKey.set(key, [...(byKey.get(key) ?? []), label]);
  }
  for (const group of byKey.values()) {
    if (group.length > 1) combine(group, "Same label apart from case or spacing");
  }

  const fullNames = new Map(attendees.map((attendee, index) => [normalizeSpeakerKey(attendee.name), index]));
  const firstNames = new Map<string, number[]>();
  attendees.forEach((attendee, index) => {
    const key = firstWord(attendee.name);
    if (key) firstNames.set(key, [...(firstNames.get(key) ?? []), index]);
  });
  const attendeeFor = (label: string) => {
    const key = normalizeSpeakerKey(label);
    const exact = fullNames.get(key);
    if (exact !== undefined) return exact;
    const byFirst = !key.includes(" ") ? firstNames.get(key) : undefined;
    return byFirst?.length === 1 ? byFirst[0] : undefined;
  };
  const assignedTo = (label: string, attendee: SuggestionAttendee) => {
    const entry = entries.get(label);
    if (!entry) return false;
    if (entry.personId && attendee.personId) return entry.personId === attendee.personId;
    return (
      Boolean(entry.name) && normalizeSpeakerKey(entry.name ?? "") === normalizeSpeakerKey(attendee.name)
    );
  };

  const matches = new Map<number, string[]>();
  for (const label of labels) {
    if (combined.has(label) || named(label)) continue;
    const index = attendeeFor(label);
    if (index !== undefined) matches.set(index, [...(matches.get(index) ?? []), label]);
  }
  for (const [index, group] of matches) {
    const attendee = attendees[index];
    const owner = labels.find((label) => !combined.has(label) && assignedTo(label, attendee));
    if (owner) {
      combine(group, `${attendee.name} is already assigned to ${owner}`, owner);
      continue;
    }
    const target = combine(group, `Both match attendee ${attendee.name}`);
    suggestions.push({
      kind: "assign",
      id: `assign:${target}`,
      label: target,
      name: attendee.name,
      ...(attendee.personId ? { personId: attendee.personId } : {}),
      reason:
        normalizeSpeakerKey(target) === normalizeSpeakerKey(attendee.name)
          ? "Label is an attendee's name"
          : "Label is an attendee's first name",
    });
  }
  return suggestions;
}

/** Group combine suggestions by target so "Apply all" combines each group in one step. */
export function combineGroups(suggestions: readonly SpeakerSuggestion[]) {
  const groups = new Map<string, string[]>();
  for (const suggestion of suggestions) {
    if (suggestion.kind === "combine") {
      groups.set(suggestion.into, [...(groups.get(suggestion.into) ?? []), suggestion.label]);
    }
  }
  return [...groups].map(([into, from]) => ({ into, from }));
}
