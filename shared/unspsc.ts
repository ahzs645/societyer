/**
 * UNSPSC commodity codes as the procurement reader matches them, in one place
 * so the list's BC Bid filter, the commodity pages and the award analytics
 * (in the browser, the catalog service and Convex) agree on which notices a
 * code covers.
 *
 * The hierarchy is in the digits: segment 43000000 ⊃ family 43230000 ⊃ class
 * 43231500 ⊃ commodity 43231501. A code covers every code that starts with
 * its digits less the zero-filled pairs, so a family includes its classes and
 * commodities, and a notice classified only at the segment (43000000) is
 * under the segment but under none of its families.
 */

export const isUnspscCode = (value: unknown): value is string => typeof value === "string" && /^\d{8}$/.test(value);

/** What a UNSPSC code covers: its digits without the zero-filled pairs (10000000 → segment 10). */
export const unspscPrefix = (code: string) => code.replace(/(?:00)+$/, "");

/** The levels' names, by `unspscLevel`. */
export const UNSPSC_LEVELS = ["Segment", "Family", "Class", "Commodity"] as const;

/** 0 segment, 1 family, 2 class, 3 commodity. */
export function unspscLevel(code: string): number {
  return code.endsWith("000000") ? 0 : code.endsWith("0000") ? 1 : code.endsWith("00") ? 2 : 3;
}

export function unspscParent(code: string): string | null {
  const level = unspscLevel(code);
  return level === 0 ? null : code.slice(0, 2 * level).padEnd(8, "0");
}

/** Root first, without the code itself. */
export function unspscAncestors(code: string): string[] {
  const chain: string[] = [];
  for (let parent = unspscParent(code); parent; parent = unspscParent(parent)) chain.unshift(parent);
  return chain;
}

/** The facts a notice's `analyticsJson` keeps about its classification. */
export type UnspscFacts = { historicalTypeReferenceId?: unknown; taxonomyReleaseId?: unknown; classificationCodes?: unknown };

/**
 * The UNSPSC codes a notice is classified under, or none. Only notices
 * classified against a UNSPSC release count: pre-2023 BC Bid notices (and
 * CanadaBuys) used GSIN codes, which are never read as UNSPSC.
 */
export function unspscCodesOf(facts: UnspscFacts): string[] {
  if (facts.historicalTypeReferenceId || !String(facts.taxonomyReleaseId ?? "").startsWith("taxonomy-release:UNSPSC:")) return [];
  return Array.isArray(facts.classificationCodes) ? facts.classificationCodes.filter(isUnspscCode) : [];
}

/** Whether any of `codes` falls under `code` (itself, or anything below it). */
export function underUnspsc(codes: readonly string[], code: string): boolean {
  const prefix = unspscPrefix(code);
  return !!prefix && codes.some((item) => item.startsWith(prefix));
}

/**
 * How many notices fall under each code, a notice counted once under each
 * code it is classified at and each of their ancestors (not under the codes
 * below its own: a family-level notice isn't under the family's classes).
 */
export function unspscCounts(notices: Iterable<readonly string[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const codes of notices) {
    const under = new Set<string>();
    for (const code of codes) {
      under.add(code);
      for (const ancestor of unspscAncestors(code)) under.add(ancestor);
    }
    for (const code of under) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}
