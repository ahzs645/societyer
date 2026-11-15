/**
 * Which notices a UNSPSC code covers, for the commodity pages: each list
 * row's codes, read once from its `analyticsJson` (shared/unspsc.ts says which
 * count), and the codes one level down that the notices under a code fall
 * into. The same rules as the list's commodity filter and the analytics'.
 */
import { UNSPSC_LEVELS, underUnspsc, unspscCodesOf, unspscLevel, unspscPrefix, type UnspscFacts } from "../../../../../shared/unspsc";
import type { ListRow } from "../source";

/** What sits one level below each level, for "Families with notices". */
export const NARROWER = ["Families", "Classes", "Commodities"] as const;

const read = new WeakMap<ListRow, string[]>();
/** The UNSPSC codes a row is classified under (none for GSIN, pre-2023 or unclassified notices). */
export function rowCommodities(row: ListRow): string[] {
  let codes = read.get(row);
  if (codes) return codes;
  codes = [];
  if (row.analyticsJson?.includes("classificationCodes")) {
    try {
      const facts: unknown = JSON.parse(row.analyticsJson);
      if (facts && typeof facts === "object") codes = unspscCodesOf(facts as UnspscFacts);
    } catch {
      // A malformed row still lists, just not under any commodity.
    }
  }
  read.set(row, codes);
  return codes;
}

export const inCommodity = (row: ListRow, code: string) => underUnspsc(rowCommodities(row), code);
export const isClassified = (row: ListRow) => rowCommodities(row).length > 0;

/** "Class", "Family": a code's level by its digits. */
export const levelName = (code: string) => UNSPSC_LEVELS[unspscLevel(code)];
/** "43230000 Software", or the level ("Untitled family") where nothing names it. */
export const codeLabel = (code: string, title: string) => `${code} ${title || `Untitled ${levelName(code).toLowerCase()}`}`;

/**
 * The codes directly below `code` that the given notices fall under, with
 * how many notices each holds (a notice counted once per code, however many
 * of its codes sit there), most first. A notice classified at `code` itself
 * is under none of them. A commodity has nothing below it.
 */
export function narrowerCodes(rows: readonly ListRow[], code: string): { code: string; count: number }[] {
  const level = unspscLevel(code);
  if (level === 3) return [];
  const prefix = unspscPrefix(code);
  const digits = 2 * (level + 2);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const below = new Set<string>();
    for (const item of rowCommodities(row)) {
      if (item.startsWith(prefix) && unspscLevel(item) > level) below.add(item.slice(0, digits).padEnd(8, "0"));
    }
    for (const child of below) counts.set(child, (counts.get(child) ?? 0) + 1);
  }
  return [...counts]
    .map(([child, count]) => ({ code: child, count }))
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1));
}
