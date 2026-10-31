import { appRouteAbsoluteHref, type AppRouteHrefOptions } from "../../../lib/appRouteHref";
import type { TranscriptRef } from "../../../../shared/transcriptModel";
import { motionNumberLabel, motionNumbers, motionShortTitle, type DisplayMotion } from "../../../lib/motionDisplay";
import { activeIndex, formatTranscriptTime } from "./activeIndex";

export function transcriptLink(start: number, end: number, location: { pathname: string; search: string }, options: AppRouteHrefOptions = {}) {
  return appRouteAbsoluteHref(`${location.pathname}${transcriptSearch(location.search, { startSec: start, endSec: end })}`, options);
}

export function transcriptQuote(text: string, speaker: string, start: number) {
  return `"${text.trim()}" — ${speaker}, ${formatTranscriptTime(start)}`;
}

export function linkedTranscriptRange(search: string) {
  const value = new URLSearchParams(search).get("t");
  const match = value?.match(/^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
}

export function isUnnamedSpeaker(label: string, name: string) {
  return name === label && /^(SPEAKER_\d+|Speaker \d+)$/i.test(label);
}

/** `?tab=transcript&t=start-end` on the current meeting URL, for in-app links. */
export function transcriptSearch(search: string, ref: TranscriptRef) {
  const params = new URLSearchParams(search);
  params.set("tab", "transcript");
  params.set("t", `${ref.startSec}-${ref.endSec}`);
  return `?${params.toString()}`;
}

/**
 * A display motion (`motionRowToEmbedded` shape) as the transcript needs it.
 * The classification fields let the adjournment be told apart, so numbers
 * match the Motions tab.
 */
export type LinkableMotion = DisplayMotion & {
  motionId?: string;
  text: string;
  transcriptRef?: TranscriptRef;
};
/** A minutes action item with its place in the minutes (section null = top level). */
export type LinkableActionItem = {
  text: string;
  sectionIndex: number | null;
  actionIndex: number;
  transcriptRef?: TranscriptRef;
};
export type MinutesLinkTarget = {
  key: string;
  kind: "motion" | "actionItem";
  /** Short pill text: "Motion 2" (the Motions tab's number), "Adjournment" or "Action". */
  label: string;
  /** Short title (`motionShortTitle`) or action wording, for menus, tooltips and screen readers. */
  summary: string;
  ref?: TranscriptRef;
  motionId?: string;
  action?: LinkableActionItem;
};

/** Motions in the Motions tab's order (numbered motions, then the adjournment), then action items. */
export function minutesLinkTargets(
  motions: readonly LinkableMotion[],
  actionItems: readonly LinkableActionItem[],
): MinutesLinkTarget[] {
  const numbers = motionNumbers(motions);
  const motionTargets = motions.map((motion, index) => ({
    key: `motion:${motion.motionId ?? index}`,
    kind: "motion" as const,
    label: motionNumberLabel(numbers[index]),
    summary: motionShortTitle(motion),
    ref: motion.transcriptRef,
    motionId: motion.motionId,
  }));
  return [
    ...motionTargets.filter((_, index) => numbers[index] != null),
    ...motionTargets.filter((_, index) => numbers[index] == null),
    ...actionItems.map((action) => ({
      key: `action:${action.sectionIndex ?? "top"}:${action.actionIndex}`,
      kind: "actionItem" as const,
      label: "Action",
      summary: action.text.replace(/\s+/g, " ").trim(),
      ref: action.transcriptRef,
      action,
    })),
  ];
}

/** Every action item, top level first, then per agenda section (the minutes card order). */
export function minutesActionItems(
  minutes?: {
    actionItems?: readonly { text: string; transcriptRef?: TranscriptRef }[];
    sections?: readonly { actionItems?: readonly { text: string; transcriptRef?: TranscriptRef }[] }[];
  } | null,
): LinkableActionItem[] {
  const own = (item: { text: string; transcriptRef?: TranscriptRef }) => Boolean(item.text?.trim());
  return [
    ...(minutes?.actionItems ?? [])
      .map((item, actionIndex) => ({ ...item, sectionIndex: null, actionIndex }))
      .filter(own),
    ...(minutes?.sections ?? []).flatMap((section, sectionIndex) =>
      (section.actionItems ?? [])
        .map((item, actionIndex) => ({ ...item, sectionIndex, actionIndex }))
        .filter(own),
    ),
  ].map(({ text, sectionIndex, actionIndex, transcriptRef }) => ({
    text,
    sectionIndex,
    actionIndex,
    transcriptRef,
  }));
}

export function truncateLabel(text: string, max = 48) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function linkTargetMenuLabel(target: MinutesLinkTarget) {
  return `${target.label} — ${truncateLabel(target.summary)}`;
}

export type TranscriptMarker = MinutesLinkTarget & { ref: TranscriptRef; left: number; row: number };
export type TranscriptMarkerLayout = { markers: TranscriptMarker[]; dots: boolean; rows: number };

// Pill metrics at fs-xxs semibold: estimates are generous so pills never touch.
const PILL_CHAR_PX = 6.5;
const PILL_PADDING_PX = 18;
const PILL_GAP_PX = 4;
export const MARKER_DOTS_BELOW_PX = 420;

/**
 * Place linked items along the scrubber. Pills that would overlap stack into
 * a second row; when that is not enough, or the bar is narrow, every marker
 * becomes a dot (each still a labelled button).
 */
export function transcriptMarkers({
  targets,
  duration,
  width,
  maxRows = 2,
}: {
  targets: readonly MinutesLinkTarget[];
  duration: number;
  width: number;
  maxRows?: number;
}): TranscriptMarkerLayout {
  if (!duration || !width) return { markers: [], dots: false, rows: 0 };
  const linked = targets
    .filter((target): target is MinutesLinkTarget & { ref: TranscriptRef } => Boolean(target.ref))
    .sort((a, b) => a.ref.startSec - b.ref.startSec);
  const position = (target: MinutesLinkTarget & { ref: TranscriptRef }) =>
    (Math.min(duration, Math.max(0, target.ref.startSec)) / duration) * width;
  const asDots = (): TranscriptMarkerLayout => ({
    markers: linked.map((target) => ({ ...target, left: position(target), row: 0 })),
    dots: true,
    rows: linked.length ? 1 : 0,
  });
  if (width < MARKER_DOTS_BELOW_PX) return asDots();
  const rowEnds: number[] = [];
  const markers: TranscriptMarker[] = [];
  for (const target of linked) {
    const pill = target.label.length * PILL_CHAR_PX + PILL_PADDING_PX;
    const left = Math.max(0, Math.min(width - pill, position(target) - pill / 2));
    let row = rowEnds.findIndex((end) => end + PILL_GAP_PX <= left);
    if (row < 0 && rowEnds.length < maxRows) row = rowEnds.push(-Infinity) - 1;
    if (row < 0) return asDots();
    rowEnds[row] = left + pill;
    markers.push({ ...target, left, row });
  }
  return { markers, dots: false, rows: rowEnds.length };
}

/** Segment index → the linked items whose range ends in that segment. */
export function citationsBySegment(
  segments: readonly { startSec: number; endSec: number }[],
  targets: readonly MinutesLinkTarget[],
) {
  const map = new Map<number, MinutesLinkTarget[]>();
  for (const target of targets) {
    if (!target.ref) continue;
    // Just inside the end, so a range ending on a boundary cites the earlier line.
    const index = activeIndex(segments, Math.max(target.ref.startSec, target.ref.endSec - 0.01));
    if (index < 0) continue;
    map.set(index, [...(map.get(index) ?? []), target]);
  }
  return map;
}
