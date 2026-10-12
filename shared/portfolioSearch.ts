/**
 * Portfolio search (YCN Entity_Index analogue): find an entity by its current
 * name, short name, registry number or a former name from its name history.
 * Pure; shared by firm:overview and the Portfolio page.
 */

function fold(value: unknown): string {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Distinct recorded names other than the current one, most recent first. */
export function formerNamesFrom(rows: Array<{ name?: string; startISO?: string }>, currentName: string): string[] {
  const current = fold(currentName).trim();
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => String(b.startISO ?? "").localeCompare(String(a.startISO ?? "")))
    .map((row) => String(row.name ?? "").trim())
    .filter((name) => {
      const key = fold(name);
      if (!name || key === current || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Portfolio search: current name, short name, registry number or a former name. */
export function portfolioEntityMatches(entity: { name?: string; shortName?: string | null; incorporationNumber?: string | null; formerNames?: string[] }, query: string): { matches: boolean; formerName?: string } {
  const needle = fold(query).trim();
  if (!needle) return { matches: true };
  if ([entity.name, entity.shortName, entity.incorporationNumber].some((value) => fold(value).includes(needle))) return { matches: true };
  const formerName = (entity.formerNames ?? []).find((name) => fold(name).includes(needle));
  return formerName ? { matches: true, formerName } : { matches: false };
}

