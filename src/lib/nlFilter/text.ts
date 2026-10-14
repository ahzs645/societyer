/**
 * Text plumbing for the natural-language filter parser: normalisation, a
 * "clause" whose matched spans get blanked out as extractors use them, and the
 * small fuzzy-matching helpers.
 */

/** Marks characters an extractor has used. Never matches `\s` or `\w`. */
export const USED = "¦";

/** Words that carry no filter meaning on their own. */
export const STOPWORDS = new Set([
  "a", "an", "the", "all", "any", "every", "show", "find", "list", "get", "give", "display", "see", "view",
  "filter", "filtered", "only", "just", "please", "that", "which", "who", "whose", "where", "what", "are", "is",
  "was", "were", "be", "been", "being", "have", "has", "had", "having", "and", "or", "of", "in", "on", "for", "by",
  "to", "from", "with", "at", "as", "my", "our", "their", "its", "it", "them", "those", "these", "this", "records",
  "record", "rows", "row", "items", "item", "entries", "entry", "ones", "one", "both", "also", "then", "than",
  "dated", "made", "i", "we", "want", "need", "can", "you", "let", "lets", "let's", "about", "s", "currently",
]);

export type Clause = {
  /** Case-preserved normalised text. */
  original: string;
  /** Lower-cased working copy; used spans are overwritten with `USED`. */
  mask: string;
};

/** Same-length normalisation for the original and the lower-cased copy. */
export function normalizeQuery(raw: string): string {
  return raw
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−–—]/g, "-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/&/g, " and ")
    // Thousands separators stay; other commas, full stops at word ends, ?, ! and ; are spacing.
    .replace(/,(?!\d{3}\b)/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/[?!;()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeClause(original: string): Clause {
  const lower = original.toLowerCase();
  // Locale lower-casing can change length for a few characters; fall back to
  // the lower-cased text for display when it does.
  return { original: lower.length === original.length ? original : lower, mask: lower };
}

export function consume(clause: Clause, start: number, end: number) {
  if (end <= start) return;
  clause.mask = clause.mask.slice(0, start) + USED.repeat(end - start) + clause.mask.slice(end);
}

export function isUsed(clause: Clause, start: number, end: number) {
  return clause.mask.slice(start, end).includes(USED);
}

/** Every match of `pattern` (must be /g) against the unused text. */
export function matchAll(clause: Clause, pattern: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clause.mask))) {
    out.push(match);
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return out;
}

/** Case-preserved text of a span. */
export function originalText(clause: Clause, start: number, end: number) {
  return clause.original.slice(start, end).trim();
}

/** Words left after extraction, minus stopwords, in order. */
export function leftoverWords(clause: Clause, extraStop: Set<string> = new Set()): string[] {
  const words: string[] = [];
  const pattern = /[^\s¦]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clause.mask))) {
    const word = match[0].replace(/^['"-]+|['"-]+$/g, "");
    if (!word) continue;
    if (STOPWORDS.has(word) || extraStop.has(word)) continue;
    words.push(clause.original.slice(match.index, match.index + match[0].length).replace(/^['"-]+|['"-]+$/g, ""));
  }
  return words;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A phrase as a regex fragment that tolerates any run of spaces or hyphens between words. */
export function phrasePattern(phrase: string) {
  return phrase
    .trim()
    .split(/[\s-]+/)
    .map(escapeRegExp)
    .join("[\\s-]+");
}

/** Optimal string alignment distance (Levenshtein + adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Whether a typed word is close enough to a known single word. */
export function fuzzyWordMatch(typed: string, known: string): boolean {
  if (typed === known) return true;
  if (typed.length < 5 || known.length < 5) return false;
  const limit = known.length >= 8 ? 2 : 1;
  return editDistance(typed, known) <= limit;
}

/** "votingRights" / "amount_cents" → "voting rights" / "amount cents". */
export function splitIdentifier(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

/** British/American spelling and simple plural tolerance for one word. */
export function wordVariants(word: string): string[] {
  const variants = new Set([word]);
  if (word.endsWith("ised")) variants.add(`${word.slice(0, -4)}ized`);
  if (word.endsWith("ized")) variants.add(`${word.slice(0, -4)}ised`);
  if (word.endsWith("celled")) variants.add(`${word.slice(0, -6)}celed`);
  if (word.endsWith("celed")) variants.add(`${word.slice(0, -5)}celled`);
  return [...variants];
}

/** Money as typed: "$1.5k", "2,000", "3 grand", "1.2m". Returns major units. */
export function parseMoneyWords(raw: string): number | undefined {
  const text = raw.toLowerCase().replace(/[$\s,]/g, "").replace(/cad|usd/g, "");
  const match = /^(-?\d*\.?\d+)(k|m|thousand|million|grand|bn)?$/.exec(text);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const suffix = match[2];
  const multiplier = suffix === "k" || suffix === "thousand" || suffix === "grand" ? 1_000 : suffix === "m" || suffix === "million" ? 1_000_000 : suffix === "bn" ? 1_000_000_000 : 1;
  return Math.round(base * multiplier * 100) / 100;
}

/** Regex source for one money amount. */
export const MONEY_SOURCE = String.raw`\$?\s?-?\d+(?:,\d{3})*(?:\.\d+)?(?:\s?(?:k|m|bn|thousand|million|grand)\b)?`;

/** "2025" with no currency mark or suffix: probably a year. */
export function looksLikeYear(raw: string) {
  return /^(?:19|20)\d{2}$/.test(raw.trim());
}

export function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Quote a typed value for a chip, keeping the user's casing. */
export function quote(value: string) {
  return `“${value}”`;
}
