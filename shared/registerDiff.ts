/**
 * Declarative diff/apply planner over versioned register rows (pure logic).
 *
 * Inspired by the YCN "To_Database" UPD/DEL/NEW-per-row pattern: given the
 * current set of rows and a desired set, classify each logical key as a new,
 * update, delete, or unchanged change, then turn that diff into concrete
 * insert/supersede operations that compose {@link planRevision}.
 *
 * Comparison ignores the bitemporal versioning stamps and Convex internal
 * fields (enteredAtISO/supersededAtISO/enteredByUserId/supersededByUserId/
 * _id/_creationTime) so that only the logical payload drives 'update'.
 */

import {
  DEFAULT_KEY_FIELD,
  planRevision,
  type VersionedRow,
} from "./versionedRegister";

export type ChangeOp = "new" | "update" | "delete" | "unchanged";

export interface DiffRow<T> {
  op: ChangeOp;
  key: string;
  current?: T;
  desired?: T;
}

export interface DiffOptions {
  /** Logical key field used to match current<->desired rows. Default 'recordId'. */
  keyField?: string;
  /**
   * Fields to compare when deciding 'update' vs 'unchanged'. If omitted, all own
   * enumerable keys present on either row are compared, except the versioning /
   * internal stamps in {@link IGNORED_COMPARE_FIELDS}.
   */
  compareFields?: string[];
}

/** Versioning / internal fields never considered when comparing payloads. */
export const IGNORED_COMPARE_FIELDS: ReadonlySet<string> = new Set([
  "enteredAtISO",
  "supersededAtISO",
  "enteredByUserId",
  "supersededByUserId",
  "_id",
  "_creationTime",
]);

function comparedKeys<T extends Record<string, unknown>>(
  current: T,
  desired: T,
  compareFields?: string[],
): string[] {
  if (compareFields) {
    return compareFields;
  }
  const keys = new Set<string>([
    ...Object.keys(current),
    ...Object.keys(desired),
  ]);
  return Array.from(keys).filter((k) => !IGNORED_COMPARE_FIELDS.has(k));
}

function fieldsDiffer<T extends Record<string, unknown>>(
  current: T,
  desired: T,
  compareFields?: string[],
): boolean {
  for (const field of comparedKeys(current, desired, compareFields)) {
    if (current[field] !== desired[field]) {
      return true;
    }
  }
  return false;
}

/**
 * Diff the `current` rows against the `desired` rows by logical key.
 *
 * - 'new'       — key present in `desired` but not `current`
 * - 'delete'    — key present in `current` but not `desired`
 * - 'update'    — key in both and a compared field differs
 * - 'unchanged' — key in both and all compared fields match
 *
 * Versioning stamps are ignored in the comparison. Result order is: matched
 * keys in `current` order (update/unchanged/delete), then new keys in `desired`
 * order.
 */
export function diffRegister<T extends Record<string, unknown>>(
  current: T[],
  desired: T[],
  opts: DiffOptions = {},
): DiffRow<T>[] {
  const keyField = opts.keyField ?? DEFAULT_KEY_FIELD;
  const keyOf = (row: T): string => String(row[keyField]);

  const desiredByKey = new Map<string, T>();
  for (const row of desired) {
    desiredByKey.set(keyOf(row), row);
  }
  const currentByKey = new Map<string, T>();
  for (const row of current) {
    currentByKey.set(keyOf(row), row);
  }

  const result: DiffRow<T>[] = [];

  for (const row of current) {
    const key = keyOf(row);
    const desiredRow = desiredByKey.get(key);
    if (desiredRow === undefined) {
      result.push({ op: "delete", key, current: row });
      continue;
    }
    const op: ChangeOp = fieldsDiffer(row, desiredRow, opts.compareFields)
      ? "update"
      : "unchanged";
    result.push({ op, key, current: row, desired: desiredRow });
  }

  for (const row of desired) {
    const key = keyOf(row);
    if (!currentByKey.has(key)) {
      result.push({ op: "new", key, desired: row });
    }
  }

  return result;
}

export interface ApplyPlan<T extends VersionedRow> {
  inserts: T[];
  supersedes: Array<{
    row: T;
    supersededAtISO: string;
    supersededByUserId?: string;
  }>;
}

/**
 * Turn a diff into concrete insert/supersede operations.
 *
 * - 'new'       — insert the desired row with fresh stamps.
 * - 'update'    — supersede the current row at `nowISO` and insert the patched
 *                 desired row (via {@link planRevision}); exactly one of each.
 * - 'delete'    — supersede the current row only.
 * - 'unchanged' — no operation.
 */
export function planApply<T extends VersionedRow>(
  diff: DiffRow<T>[],
  nowISO: string,
  actorUserId?: string,
): ApplyPlan<T> {
  const inserts: T[] = [];
  const supersedes: ApplyPlan<T>["supersedes"] = [];

  const supersede = (row: T): void => {
    const stamp: ApplyPlan<T>["supersedes"][number] = {
      row,
      supersededAtISO: nowISO,
    };
    if (actorUserId !== undefined) {
      stamp.supersededByUserId = actorUserId;
    }
    supersedes.push(stamp);
  };

  for (const entry of diff) {
    switch (entry.op) {
      case "new": {
        if (entry.desired === undefined) {
          throw new Error(`'new' diff for key ${entry.key} missing desired row.`);
        }
        const insert: T = {
          ...entry.desired,
          enteredAtISO: nowISO,
          enteredByUserId: actorUserId,
          supersededAtISO: null,
          supersededByUserId: null,
        };
        inserts.push(insert);
        break;
      }
      case "update": {
        if (entry.current === undefined || entry.desired === undefined) {
          throw new Error(`'update' diff for key ${entry.key} missing rows.`);
        }
        const patch = patchFromDesired(entry.desired);
        const plan = planRevision(entry.current, patch, nowISO, actorUserId);
        supersede(entry.current);
        inserts.push(plan.insert);
        break;
      }
      case "delete": {
        if (entry.current === undefined) {
          throw new Error(`'delete' diff for key ${entry.key} missing current row.`);
        }
        supersede(entry.current);
        break;
      }
      case "unchanged":
        break;
    }
  }

  return { inserts, supersedes };
}

/**
 * Strip versioning/internal stamps from a desired row so the patch only carries
 * logical payload (planRevision applies fresh stamps itself).
 */
function patchFromDesired<T extends VersionedRow>(desired: T): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(desired)) {
    if (!IGNORED_COMPARE_FIELDS.has(field)) {
      patch[field] = value;
    }
  }
  return patch as Partial<T>;
}
