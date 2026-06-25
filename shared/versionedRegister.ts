/**
 * Generic bitemporal versioned-register helper (pure logic).
 *
 * Every register row carries entered/superseded ISO-8601 stamps plus a stable
 * logical key (caller-provided field, default `recordId`) and arbitrary payload.
 * A row is "current" when its `supersededAtISO` is null/undefined.
 *
 * ISO-8601 strings are lexicographically sortable, so plain string comparison
 * is sufficient for as-of reconstruction. This intentionally does NOT use the
 * YCN float timestamp format.
 *
 * The Convex query/mutation layer imports these helpers; revisions are applied
 * as "stamp old + insert new" (see {@link planRevision}).
 */

export const DEFAULT_KEY_FIELD = "recordId";

export interface VersionedRow {
  enteredAtISO: string;
  enteredByUserId?: string;
  supersededAtISO?: string | null;
  supersededByUserId?: string | null;
  [k: string]: unknown;
}

/** Rows that have not been superseded (the "current" view of the register). */
export function currentRows<T extends VersionedRow>(rows: T[]): T[] {
  return rows.filter((row) => row.supersededAtISO == null);
}

/**
 * Reconstruct the register as it stood at the given ISO instant: rows that had
 * already been entered (`enteredAtISO <= iso`) and had not yet been superseded
 * (`supersededAtISO == null` OR `supersededAtISO > iso`).
 */
export function asOfRows<T extends VersionedRow>(rows: T[], iso: string): T[] {
  return rows.filter(
    (row) =>
      row.enteredAtISO <= iso &&
      (row.supersededAtISO == null || row.supersededAtISO > iso),
  );
}

/**
 * Express a revision of `current` as an atomic "stamp old + insert new" pair.
 *
 * `supersede` is the stamp to apply to the existing row (closing it out at
 * `nowISO`). `insert` is the replacement row: the current row spread with the
 * patch applied, a fresh `enteredAtISO`/`enteredByUserId`, and cleared
 * supersede stamps so it becomes the new current row. The logical key field is
 * preserved (the patch may override it, but normally should not).
 */
export function planRevision<T extends VersionedRow>(
  current: T,
  patch: Partial<T>,
  nowISO: string,
  actorUserId?: string,
): { supersede: { supersededAtISO: string; supersededByUserId?: string }; insert: T } {
  const supersede: { supersededAtISO: string; supersededByUserId?: string } = {
    supersededAtISO: nowISO,
  };
  if (actorUserId !== undefined) {
    supersede.supersededByUserId = actorUserId;
  }

  const insert: T = {
    ...current,
    ...patch,
    enteredAtISO: nowISO,
    enteredByUserId: actorUserId,
    supersededAtISO: null,
    supersededByUserId: null,
  };

  return { supersede, insert };
}

/**
 * The current row per logical key. When multiple current rows share a key, the
 * one with the latest `enteredAtISO` wins (ties broken by later occurrence).
 */
export function latestByKey<T extends VersionedRow>(
  rows: T[],
  keyField: string = DEFAULT_KEY_FIELD,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of currentRows(rows)) {
    const key = String(row[keyField]);
    const existing = result.get(key);
    if (existing === undefined || row.enteredAtISO >= existing.enteredAtISO) {
      result.set(key, row);
    }
  }
  return result;
}
