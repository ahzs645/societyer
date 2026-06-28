// Standard procedural / recurring meeting motions and their parliamentary
// characteristics. Single source of truth shared by the frontend governance
// helpers (src/lib/motionGovernance.ts) and the Convex dual-write layer
// (convex/motions.ts) so classification, auto-labeling, and the "decided by
// consent vs. counted vote" distinction stay consistent everywhere.
//
// Modeling note — why this exists:
// Parliamentary procedure never describes a motion with a single "type". A
// motion sits on several *orthogonal* axes: its CLASS (main / subsidiary /
// privileged / incidental), whether it is DEBATABLE and AMENDABLE, the vote
// THRESHOLD it needs, and HOW it is actually decided (a counted ballot vs.
// unanimous/general consent vs. an automatic close). The original data model
// collapsed these into one `resolutionType: "Procedural"` string that meant "no
// vote", which is incorrect: a motion to adjourn IS votable (it carries by a
// majority) — it is simply, in practice, adopted by general consent with no
// tally recorded. This module separates the "how decided" axis (`DecidedBy`)
// from the threshold so a passed adjournment reads as *Carried by consent*
// rather than as a vote-less non-event.
//
// Citations (Robert's Rules of Order Newly Revised, RONR, plus public board
// governance summaries):
//  - Classes of motions (main / subsidiary / incidental / privileged):
//      http://www.rulesonline.com/rror-02.htm
//  - Privileged motions — Adjourn and Recess are privileged, undebatable, and
//    carry by a majority vote:
//      http://www.rulesonline.com/rror-03.htm
//  - General (unanimous) consent — routine, uncontested business is adopted
//    without a formal vote ("if there is no objection…"):
//      http://www.rulesonline.com/rror-04.htm
//  - Approving the minutes is normally handled by the chair via unanimous
//    consent; a vote is taken only if a correction is disputed:
//      https://www.govenda.com/blog/best-practices-for-creating-and-approving-meeting-minutes/

/** How a motion was actually decided — orthogonal to its vote threshold.
 *  - vote      : a counted ballot; the tally is judged against the threshold.
 *  - consent   : adopted by unanimous/general consent ("no objection"); no tally.
 *  - automatic : the meeting closed without a motion — agenda exhausted, the
 *                scheduled end-time was reached, or an emergency. Adjournment only. */
export type DecidedBy = "vote" | "consent" | "automatic";

export const DECIDED_BY_VALUES: DecidedBy[] = ["vote", "consent", "automatic"];

export const DECIDED_BY_LABELS: Record<DecidedBy, string> = {
  vote: "Recorded vote",
  consent: "General consent",
  automatic: "Automatic",
};

export type ParliamentaryClass = "main" | "subsidiary" | "incidental" | "privileged";

export interface ProceduralMotionKind {
  /** Stable slug; also the tag auto-applied to a motion of this kind so the
   *  master list can hide it by a *stored label* instead of regex-matching the
   *  wording on every render. */
  key: string;
  label: string;
  parliamentaryClass: ParliamentaryClass;
  debatable: boolean;
  amendable: boolean;
  /** Vote needed WHEN the motion is actually put to a ballot. "none" means it is
   *  never a threshold question (e.g. receiving a report). */
  threshold: "majority" | "twoThirds" | "none";
  /** How a motion of this kind is decided by default — most pass by general
   *  consent, so no tally is recorded. */
  defaultDecidedBy: DecidedBy;
  /** Hidden from the master list's default view (routine bookkeeping). */
  routine: boolean;
  /** Detect this kind from free-form / imported / legacy motion wording. */
  match: RegExp;
  /** Short source note surfaced in the UI tooltip and docs. */
  citation: string;
}

export const PROCEDURAL_MOTION_KINDS: ProceduralMotionKind[] = [
  {
    key: "adjournment",
    label: "Adjourn the meeting",
    parliamentaryClass: "privileged",
    debatable: false,
    amendable: false,
    threshold: "majority",
    defaultDecidedBy: "consent",
    routine: true,
    match: /\badjourn(?:ment|ed|s|ing)?\b/i,
    citation:
      "RONR: Adjourn is a privileged motion — undebatable, carries by a majority vote, and must occur for the meeting to legally close (rulesonline.com/rror-03.htm).",
  },
  {
    key: "previous-minutes",
    label: "Approve the minutes of the previous meeting",
    parliamentaryClass: "incidental",
    debatable: true,
    amendable: true,
    threshold: "majority",
    defaultDecidedBy: "consent",
    routine: true,
    match: /\b(approve|adopt|accept|confirm)\b[^.]*\bminutes\b/i,
    citation:
      "Minutes are approved by the chair via unanimous consent; a vote is taken only if a correction is disputed (govenda.com / RONR rror-04.htm).",
  },
  {
    key: "approve-agenda",
    label: "Approve the agenda / order of business",
    parliamentaryClass: "incidental",
    debatable: true,
    amendable: true,
    threshold: "majority",
    defaultDecidedBy: "consent",
    routine: true,
    match: /\b(approve|adopt|accept|amend)\b[^.]*\bagenda\b/i,
    citation:
      "The agenda/order of business is adopted by a majority, customarily by unanimous consent (rulesonline.com/rror-04.htm).",
  },
  {
    key: "recess",
    label: "Recess",
    parliamentaryClass: "privileged",
    debatable: false,
    amendable: true,
    threshold: "majority",
    defaultDecidedBy: "vote",
    routine: false,
    match: /\b(recess|take a (?:short )?break)\b/i,
    citation:
      "RONR: Recess is a privileged motion — carries by a majority vote; amendable as to length (rulesonline.com/rror-03.htm).",
  },
  {
    key: "receive-reports",
    label: "Receive / file a report",
    parliamentaryClass: "incidental",
    debatable: false,
    amendable: false,
    threshold: "none",
    defaultDecidedBy: "consent",
    routine: true,
    match: /\b(receive|file|accept)\b[^.]*\b(reports?|correspondence)\b/i,
    citation:
      "A report is received/filed by unanimous consent — no vote is taken unless the assembly adopts the report's recommendations (rulesonline.com/rror-04.htm).",
  },
];

export const PROCEDURAL_MOTION_KEYS: string[] = PROCEDURAL_MOTION_KINDS.map((k) => k.key);

/** Tags that mark a motion as routine bookkeeping the master list hides by
 *  default. Derived from the catalogue's routine kinds, plus a manual "routine"
 *  escape hatch the user can apply by hand. */
export const ROUTINE_MOTION_TAGS: string[] = [
  ...PROCEDURAL_MOTION_KINDS.filter((k) => k.routine).map((k) => k.key),
  "routine",
];

export interface ClassifiableMotion {
  text?: string;
  sectionTitle?: string;
  resolutionType?: string;
  tags?: string[];
  /** Explicit stored kind slug — wins over wording-based detection. */
  proceduralKind?: string;
}

function lowerTags(tags?: string[]): string[] {
  return (tags ?? []).map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean);
}

/** Look up a procedural kind by its slug. */
export function proceduralKindByKey(key?: string): ProceduralMotionKind | null {
  if (!key) return null;
  return PROCEDURAL_MOTION_KINDS.find((k) => k.key === key) ?? null;
}

/** Identify a motion's procedural kind. An explicit stored signal wins (a
 *  `proceduralKind` slug or a catalogue tag); otherwise fall back to matching
 *  the wording. Returns null for ordinary substantive motions. */
export function classifyProceduralMotion(motion: ClassifiableMotion): ProceduralMotionKind | null {
  const explicit = proceduralKindByKey(motion.proceduralKind);
  if (explicit) return explicit;
  const tags = lowerTags(motion.tags);
  const tagged = PROCEDURAL_MOTION_KINDS.find((k) => tags.includes(k.key));
  if (tagged) return tagged;
  const hay = `${motion.text ?? ""} ${motion.sectionTitle ?? ""}`;
  return PROCEDURAL_MOTION_KINDS.find((k) => k.match.test(hay)) ?? null;
}

/** The default "decided by" method for a motion: procedural kinds carry their
 *  catalogue default (usually consent); everything else is a counted vote. */
export function defaultDecidedByFor(motion: ClassifiableMotion): DecidedBy {
  return classifyProceduralMotion(motion)?.defaultDecidedBy ?? "vote";
}

/** Merge any auto-applied procedural tag (the kind's slug) into a motion's
 *  existing tags so the master-list filter keys off a stored label rather than
 *  the wording. Normalized: trimmed, lowercased, deduped. */
export function applyProceduralTags(
  existing: string[] | undefined,
  motion: ClassifiableMotion,
): string[] {
  const base = lowerTags(existing);
  const kind = classifyProceduralMotion({ ...motion, tags: undefined });
  const merged = kind ? [...base, kind.key] : base;
  return Array.from(new Set(merged));
}

/** Whether a motion is routine bookkeeping hidden by the master list's default
 *  view — an explicit routine tag, or a routine procedural kind detected from
 *  its wording. */
export function isRoutineMotion(motion: ClassifiableMotion): boolean {
  const tags = lowerTags(motion.tags);
  if (tags.some((t) => ROUTINE_MOTION_TAGS.includes(t))) return true;
  const kind = classifyProceduralMotion(motion);
  return kind ? kind.routine : false;
}

/** Whether a motion that has been decided by consent/automatic should be treated
 *  as carried without a tally. A motion adopted by general consent carries by
 *  definition (anyone who objected would have forced a vote). */
export function isDecidedWithoutVote(decidedBy?: string): boolean {
  return decidedBy === "consent" || decidedBy === "automatic";
}
