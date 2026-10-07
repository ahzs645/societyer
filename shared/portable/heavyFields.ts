/**
 * LAZY HEAVY FIELDS for the local row stores.
 *
 * A handful of top-level fields carry most of a real workspace's bytes: the
 * extracted text of imported documents (`documents.content`) and the verbatim
 * source records kept beside transposed minutes (`minutes.sourceMeetingRecord`
 * …). On the restored PGAIR workspace those few fields are ~170 MB of the
 * ~200 MB `workspace.json`, yet almost no list view reads them.
 *
 * Local stores may keep these values OUT of the in-memory row cache (and out of
 * the IndexedDB `records` object store that is read on every boot) and load them
 * on demand. The portable contract is unchanged: `ctx.db.get()` and query
 * results are always materialized with every field, unless the handler projected
 * the field away with `.omitFields(...)` — in which case it is never loaded.
 *
 * Only the fields listed here are ever externalized, and only when the value is
 * large, so ordinary small rows stay fully in memory.
 */

/** Fields that may be stored outside the in-memory row cache, per table. */
export const HEAVY_FIELD_POLICY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  documents: Object.freeze(["content"]),
  minutes: Object.freeze(["sourceMeetingRecord", "sourceTransposition", "draftTranscript"]),
  transcripts: Object.freeze(["text", "segments"]),
});

/** Values at or below this serialized length stay inline. */
export const HEAVY_FIELD_MIN_LENGTH = 1024;

export type HeavyFieldPolicy = {
  fields: Readonly<Record<string, readonly string[]>>;
  minLength: number;
};

export const DEFAULT_HEAVY_FIELD_POLICY: HeavyFieldPolicy = Object.freeze({
  fields: HEAVY_FIELD_POLICY,
  minLength: HEAVY_FIELD_MIN_LENGTH,
});

/** Serialized length used to decide whether a value is heavy. */
export function heavyValueLength(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

export type SplitRow<T> = {
  /** The row without its externalized fields. Same object when nothing split. */
  light: T;
  /** Externalized field values, or null when the row stays fully inline. */
  heavy: Record<string, unknown> | null;
};

/** Split a row into its inline part and its externalized heavy fields. */
export function splitHeavyFields<T extends Record<string, any>>(
  table: string,
  row: T,
  policy: HeavyFieldPolicy = DEFAULT_HEAVY_FIELD_POLICY,
): SplitRow<T> {
  const fields = policy.fields[table];
  if (!fields || !row || typeof row !== "object") return { light: row, heavy: null };
  let heavy: Record<string, unknown> | null = null;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
    const value = row[field];
    if (heavyValueLength(value) <= policy.minLength) continue;
    (heavy ??= {})[field] = value;
  }
  if (!heavy) return { light: row, heavy: null };
  const light: Record<string, any> = {};
  for (const key of Object.keys(row)) if (!(key in heavy)) light[key] = row[key];
  return { light: light as T, heavy };
}

/** Whether any field of `table` can ever be externalized. */
export function tableHasHeavyFields(table: string, policy: HeavyFieldPolicy = DEFAULT_HEAVY_FIELD_POLICY) {
  return Boolean(policy.fields[table]?.length);
}

/**
 * Thrown (and caught by the local query engine) when a predicate, search or
 * index constraint touches a field that has not been loaded yet. The engine
 * loads the row's heavy fields and evaluates it again, so the predicate always
 * sees the complete row. Predicates must therefore be pure, which the portable
 * contract already requires (Convex may evaluate them in any order).
 */
export class HeavyFieldNotLoaded extends Error {
  constructor(readonly field: string) {
    super(`Heavy field ${field} is not loaded`);
  }
}

/**
 * A read-only view of a light row that throws `HeavyFieldNotLoaded` as soon as
 * code reads, enumerates or tests one of the row's externalized fields.
 */
export function guardedLightRow<T extends Record<string, any>>(row: T, external: readonly string[]): T {
  // `external` is one to three field names: a linear scan beats building a Set per row.
  const missing = (property: string | symbol) => typeof property === "string" && external.includes(property);
  return new Proxy(row, {
    get(target, property, receiver) {
      if (missing(property)) throw new HeavyFieldNotLoaded(property as string);
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (missing(property)) throw new HeavyFieldNotLoaded(property as string);
      return Reflect.has(target, property);
    },
    ownKeys() {
      throw new HeavyFieldNotLoaded(external[0] ?? "");
    },
    getOwnPropertyDescriptor(target, property) {
      if (missing(property)) throw new HeavyFieldNotLoaded(property as string);
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}

/** Remove projected-away top-level fields from a row (shared by every adapter). */
export function omitRowFields<T extends Record<string, any>>(row: T, fields: readonly string[] | null | undefined): T {
  if (!fields?.length || !row || typeof row !== "object") return row;
  let copy: Record<string, any> | null = null;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
    copy ??= { ...row };
    delete copy[field];
  }
  return (copy ?? row) as T;
}
