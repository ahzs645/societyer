// How a motion is named wherever it appears: the Motions tab, the transcript's
// scrubber pills, citations and Link-to menu, and the ▶ chips. One numbering and
// one short title, so "Motion 3" means the same motion everywhere.
//
// Pure (no React), so the checks can import it.

import { isAdjournmentMotion, isPostponedOutcome, normalizeMotionOutcome } from "./motionGovernance";

export type DisplayMotion = {
  name?: string | null;
  text?: string | null;
  outcome?: string | null;
  sectionTitle?: string;
  resolutionType?: string;
  tags?: string[];
  proceduralKind?: string;
};

/**
 * Business motions are numbered 1, 2, 3… in minutes order. The adjournment
 * record is shown apart (under "Adjournment" on the Motions tab), so it gets no
 * number. Returns one entry per motion, `null` for the adjournment.
 */
export function motionNumbers(motions: readonly DisplayMotion[]): Array<number | null> {
  let next = 0;
  return motions.map((motion) => (isAdjournment(motion) ? null : ++next));
}

/** "Motion 3", or "Adjournment" for the procedural close (number `null`). */
export function motionNumberLabel(number: number | null): string {
  return number == null ? "Adjournment" : `Motion ${number}`;
}

// Formal wording that says nothing about the motion itself. Removed from the
// front, repeatedly, so "MOTION: BE IT RESOLVED THAT the…" reads "The…".
const BOILERPLATE_PREFIXES = [
  /^be\s+it\s+(?:further\s+|therefore\s+)?resolved\s*(?:that(?:\s|$)|:|,)?/i,
  /^(?:it\s+(?:is|was)\s+)?resolved\s*(?:that\s|:|,)/i,
  /^(?:motion|moved)\s*(?:that\s|:|—|–|-)/i,
  /^that\s/i,
];

/**
 * A short title for menus, pills and labels: the motion's name when it has
 * one, otherwise its wording without boilerplate ("BE IT RESOLVED THAT",
 * "THAT", "MOTION:"), first letter capitalised, trailing full stop dropped.
 * Not truncated: callers clip to their own width.
 */
export function motionShortTitle(motion: Pick<DisplayMotion, "name" | "text">): string {
  const name = collapse(motion.name);
  if (name) return name;
  const text = collapse(motion.text);
  let title = text;
  for (let pass = 0; pass < 4; pass++) {
    const before = title;
    for (const prefix of BOILERPLATE_PREFIXES) title = title.replace(prefix, "").trimStart();
    if (title === before) break;
  }
  title = title.replace(/\.$/, "").trim();
  if (!title) return text || "Untitled motion";
  return title.charAt(0).toLocaleUpperCase() + title.slice(1);
}

/** "Motion 3 · Approve the 2027 operating budget", for aria-labels and tooltips. */
export function motionDisplayName(number: number | null, motion: Pick<DisplayMotion, "name" | "text">): string {
  return `${motionNumberLabel(number)} · ${motionShortTitle(motion)}`;
}

/**
 * The Motions tab's tally, counting what the tab lists: business motions by
 * outcome (zero buckets left out), then the adjournment record if there is one.
 * "3 motions · 2 carried · 1 pending · plus adjournment".
 */
export function motionTallySummary(motions: readonly DisplayMotion[]): string {
  const business = motions.filter((motion) => !isAdjournment(motion));
  const adjournments = motions.length - business.length;
  const count = (test: (outcome: string) => boolean) =>
    business.filter((motion) => test(normalizeMotionOutcome(motion.outcome))).length;
  const parts = business.length
    ? [
        `${business.length} motion${business.length === 1 ? "" : "s"}`,
        ...([
          ["carried", count((outcome) => outcome === "Carried")],
          ["defeated", count((outcome) => outcome === "Defeated")],
          ["tabled or deferred", count((outcome) => isPostponedOutcome(outcome))],
          ["pending", count((outcome) => outcome === "Pending")],
        ] as const)
          .filter(([, value]) => value > 0)
          .map(([label, value]) => `${value} ${label}`),
      ]
    : ["No business motions"];
  if (adjournments) parts.push("plus adjournment");
  return parts.join(" · ");
}

function isAdjournment(motion: DisplayMotion) {
  return isAdjournmentMotion({ ...motion, text: motion.text ?? undefined });
}

function collapse(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
