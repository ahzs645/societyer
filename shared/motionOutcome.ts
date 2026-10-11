/**
 * Motion outcome vocabulary shared by every write path (minutes save, import,
 * repair) and by the UI.
 *
 * Source minutes record outcomes in many words: "Carried", "Passed",
 * "Approved", "Adopted", "Carried unanimously", "with no objections",
 * "Not carried", "Failed", "Lost". The first-class `motions` row stores an
 * explicit (status, outcome) split, so the free wording has to be classified.
 * Before this module only the canonical labels were recognised and everything
 * else (including the import default "Passed") silently became an undecided
 * `Moved` motion.
 *
 * Rules:
 *  - negative wording is checked before positive wording ("not carried");
 *  - anything that is not recognised stays undecided (`Moved`) and is flagged
 *    `needsReview`, never guessed;
 *  - the raw wording is always returned so callers can keep it verbatim
 *    (`motions.sourceOutcomeText`).
 *
 * Pure module: no imports, safe for the browser, Convex and scripts.
 */

export type MotionOutcomeStatus = "Moved" | "Voted" | "Tabled" | "Deferred" | "Withdrawn";
export type MotionOutcomeValue = "Carried" | "Defeated";

export type MotionOutcomeClassification = {
  status: MotionOutcomeStatus;
  outcome?: MotionOutcomeValue;
  /** Present only when the wording itself says how the decision was made. */
  decidedBy?: "consent";
  /** True when the wording says the decision was unanimous. */
  unanimous?: boolean;
  /** The trimmed raw wording, or undefined when blank. */
  raw?: string;
  /** True when the raw wording is one of the canonical labels. */
  canonical: boolean;
  /** True when the wording was classified (canonical or synonym). */
  recognized: boolean;
  /** True when the outcome is unknown and needs a reviewer. */
  needsReview: boolean;
};

const CANONICAL = new Set(["", "pending", "carried", "defeated", "tabled", "deferred", "withdrawn"]);
const UNKNOWN = new Set([
  "unknown", "needsreview", "needs review", "not recorded", "unrecorded", "tbd", "tbc", "n a", "na", "none",
  "outcome not recorded", "no outcome recorded",
]);

function normalizeWording(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[()[\]{}.,;:!"'`*_]/g, " ")
    .replace(/[–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the )?(?:motion|resolution|it) (?:was |is |has been )?/, "")
    .replace(/^(?:was|is|has been) /, "")
    .trim();
}

const NEGATIVE = [
  /^not (?:carried|passed|approved|adopted|accepted|agreed)\b/,
  /^did not (?:carry|pass)\b/,
  /^(?:failed|fails|fail|lost|defeated|rejected|denied|not supported)\b/,
  /\b(?:was|is) (?:defeated|lost|rejected)\b/,
];
const TABLED = [/^tabled\b/, /^laid on the table\b/, /^lies on the table\b/];
const DEFERRED = [/^deferred\b/, /^postponed\b/, /^referred\b/, /^held over\b/];
const WITHDRAWN = [/^withdrawn\b/, /^withdrew\b/];
const CONSENT = [
  /\bno objections?\b/, /\bwithout objections?\b/, /\bby consensus\b/, /^consensus\b/,
  /\bgeneral consent\b/, /\bunanimous consent\b/, /\bagreed by consensus\b/, /\bby acclamation\b/,
];
const POSITIVE = [
  /^carried\b/, /^passed\b/, /^approved\b/, /^adopted\b/, /^accepted\b/, /^agreed\b/, /^so moved\b/,
  /^unanimously (?:carried|passed|approved|adopted|accepted|agreed)\b/,
  /^carried unanimously\b/, /^unanimous\b/, /^ratified\b/, /^endorsed\b/,
];

/** Classify free outcome wording into the first-class (status, outcome) split. */
export function classifyMotionOutcome(raw: unknown): MotionOutcomeClassification {
  const trimmed = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
  const value = normalizeWording(trimmed);
  const base = { raw: trimmed || undefined, canonical: CANONICAL.has(trimmed.toLowerCase()) };
  if (!value || value === "pending") return { ...base, status: "Moved", recognized: true, needsReview: false };
  if (UNKNOWN.has(value)) return { ...base, status: "Moved", recognized: false, needsReview: true };
  if (NEGATIVE.some((re) => re.test(value))) return { ...base, status: "Voted", outcome: "Defeated", recognized: true, needsReview: false };
  if (TABLED.some((re) => re.test(value))) return { ...base, status: "Tabled", recognized: true, needsReview: false };
  if (DEFERRED.some((re) => re.test(value))) return { ...base, status: "Deferred", recognized: true, needsReview: false };
  if (WITHDRAWN.some((re) => re.test(value))) return { ...base, status: "Withdrawn", recognized: true, needsReview: false };
  const unanimous = /\bunanimous(?:ly)?\b/.test(value);
  if (CONSENT.some((re) => re.test(value))) {
    return { ...base, status: "Voted", outcome: "Carried", decidedBy: "consent", unanimous: unanimous || undefined, recognized: true, needsReview: false };
  }
  if (POSITIVE.some((re) => re.test(value))) {
    return { ...base, status: "Voted", outcome: "Carried", unanimous: unanimous || undefined, recognized: true, needsReview: false };
  }
  return { ...base, status: "Moved", recognized: false, needsReview: true };
}

/** Canonical embedded outcome label ("Carried", "Defeated", "Tabled", ...) for free wording. */
export function canonicalMotionOutcomeLabel(raw: unknown): string {
  const result = classifyMotionOutcome(raw);
  if (result.status === "Voted") return result.outcome ?? "Carried";
  if (result.status === "Moved") return "Pending";
  return result.status;
}

/** Recover the raw outcome wording stored on a motion row by an earlier import:
 *  `sourceOutcomeText`, else a `legacy outcome: <raw>` history note. */
export function storedRawMotionOutcome(row: { sourceOutcomeText?: unknown; history?: Array<{ note?: unknown }> | null } | null | undefined): string | undefined {
  if (!row) return undefined;
  if (typeof row.sourceOutcomeText === "string" && row.sourceOutcomeText.trim()) return row.sourceOutcomeText.trim();
  for (const entry of [...(row.history ?? [])].reverse()) {
    const match = typeof entry?.note === "string" ? entry.note.match(/legacy outcome:\s*(.+?)\s*$/i) : null;
    if (match) return match[1];
  }
  return undefined;
}
