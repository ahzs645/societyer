/**
 * CROSS-TENANT PEOPLE DIRECTORY (pure logic).
 *
 * Implements the YCN DB_GLOB_PEOPLE_DIRECTORY idea: store a person once and
 * reuse them across entities. Provides normalized-name typeahead, duplicate
 * detection by name+dob, and "did you mean this existing person?" linking.
 *
 * Framework-free. Deterministic. Named exports only.
 */

export interface DirectoryPerson {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  isIndividual?: boolean;
}

/**
 * Normalize a person name for matching/dedupe:
 * - lowercased and trimmed
 * - diacritics stripped (light: via NFD + combining-mark removal)
 * - commas, periods and other punctuation removed
 * - internal whitespace collapsed to single spaces
 * Deterministic for a given input.
 */
export function normalizeSearchName(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    // strip combining diacritical marks
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // replace punctuation with a space so "doe,jane" -> "doe jane"
    .replace(/[.,/#!$%^&*;:{}=_`~()'"?<>[\]\\|@+-]/g, " ")
    // collapse all whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the "last, first" normalized ordering for a person, when first/last
 * are known. Returns the normalized fullName form otherwise.
 */
function lastFirstForms(p: DirectoryPerson): string[] {
  const forms: string[] = [normalizeSearchName(p.fullName)];
  if (p.lastName || p.firstName) {
    const lf = `${p.lastName ?? ""} ${p.firstName ?? ""}`;
    const fl = `${p.firstName ?? ""} ${p.lastName ?? ""}`;
    forms.push(normalizeSearchName(lf), normalizeSearchName(fl));
  }
  return forms.filter((f) => f.length > 0);
}

/**
 * Typeahead: return people whose normalized fullName (or normalized
 * "last first" / "first last" ordering) starts with the normalized prefix.
 * Sorted by normalized fullName. Default limit 10.
 */
export function matchByPrefix(
  people: DirectoryPerson[],
  prefix: string,
  limit: number = 10,
): DirectoryPerson[] {
  const np = normalizeSearchName(prefix);
  const matches =
    np.length === 0
      ? people.slice()
      : people.filter((p) =>
          lastFirstForms(p).some((form) => form.startsWith(np)),
        );

  matches.sort((a, b) => {
    const na = normalizeSearchName(a.fullName);
    const nb = normalizeSearchName(b.fullName);
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  });

  return limit < 0 ? matches : matches.slice(0, limit);
}

/**
 * Stable key for duplicate detection: normalized name + '|' + dob (or '').
 */
export function dedupeKey(p: { fullName: string; dob?: string }): string {
  return normalizeSearchName(p.fullName) + "|" + (p.dob ?? "");
}

/**
 * Group people that share a dedupeKey into clusters of size > 1.
 * Insertion order of first occurrence is preserved across groups.
 */
export function findDuplicates(people: DirectoryPerson[]): DirectoryPerson[][] {
  const groups = new Map<string, DirectoryPerson[]>();
  const order: string[] = [];
  for (const p of people) {
    const key = dedupeKey(p);
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(p);
  }
  const result: DirectoryPerson[][] = [];
  for (const key of order) {
    const bucket = groups.get(key)!;
    if (bucket.length > 1) result.push(bucket);
  }
  return result;
}

/**
 * "Did you mean this existing person?" — return the best exact normalized-name
 * match for candidateName, or null if none. The first matching person in
 * directory order is returned.
 */
export function suggestLink(
  candidateName: string,
  people: DirectoryPerson[],
): DirectoryPerson | null {
  const target = normalizeSearchName(candidateName);
  if (target.length === 0) return null;
  for (const p of people) {
    if (normalizeSearchName(p.fullName) === target) return p;
  }
  return null;
}
