/**
 * Role-holder edit history (pure logic).
 *
 * Gives the directors/officers register a real audit trail — what changed, when,
 * by whom, and the prior value — without changing how anything *reads* the live
 * register. The live `roleHolders` row stays the current version; each edit
 * appends the prior version as a closed (superseded) revision in a side table.
 *
 * Consumes the two dormant register modules:
 *  - versionedRegister (planRevision / asOfRows / latestByKey) for the bitemporal
 *    stamps and as-of reconstruction over edit versions, and
 *  - registerDiff (diffRegister) to classify what changed between two instants.
 *
 * Framework-free. The Convex layer and the static mirror both drive their thin
 * write paths through {@link planRoleHolderRevision} and read through the query
 * helpers here, so the logic lives in exactly one place.
 */

import {
  asOfRows,
  planRevision,
  type VersionedRow,
} from "./versionedRegister";
import { diffRegister, type DiffRow } from "./registerDiff";

/** The role-holder fields tracked for edit history + diffing. */
export const ROLE_HOLDER_VERSION_FIELDS = [
  "roleType",
  "status",
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "officerTitle",
  "directorTerm",
  "startDate",
  "endDate",
  "gender",
  "pronouns",
  "directoryPersonId",
  "notes",
] as const;

export type TrackedFields = Record<string, unknown>;

/** A versioned snapshot of a role holder (one edit generation). */
export interface RoleHolderVersion extends VersionedRow {
  recordId: string; // the roleHolders _id (logical key)
}

/** Pull only the tracked fields off a role-holder-like row (null for missing). */
export function extractTrackedFields(row: Record<string, unknown>): TrackedFields {
  const out: TrackedFields = {};
  for (const field of ROLE_HOLDER_VERSION_FIELDS) {
    out[field] = row[field] ?? null;
  }
  return out;
}

/** When did this row's current version begin? Falls back to creation time. */
function enteredAt(row: Record<string, unknown>): string {
  return String(row.enteredAtISO ?? row.createdAtISO ?? "");
}

/**
 * Plan an edit revision: stamp the existing live row as superseded (the snapshot
 * to append to the history table) and produce the entered stamps for the patched
 * live row. Delegates the bitemporal mechanics to versionedRegister.planRevision.
 */
export function planRoleHolderRevision(
  existing: Record<string, unknown>,
  nowISO: string,
  actorUserId?: string,
): {
  /** The closed snapshot of the prior version to append to roleHolderRevisions. */
  revision: {
    roleHolderId: string;
    dataJson: string;
    enteredAtISO: string;
    enteredByUserId?: string;
    supersededAtISO: string;
    supersededByUserId?: string;
  };
  /** Entered stamps to write onto the patched live row. */
  liveStamps: { enteredAtISO: string; enteredByUserId?: string };
} {
  const currentVersion: RoleHolderVersion = {
    recordId: String((existing as { _id?: unknown })._id ?? ""),
    ...extractTrackedFields(existing),
    enteredAtISO: enteredAt(existing),
    enteredByUserId: existing.enteredByUserId as string | undefined,
    supersededAtISO: null,
  };
  const plan = planRevision(currentVersion, {}, nowISO, actorUserId);
  return {
    revision: {
      roleHolderId: currentVersion.recordId,
      dataJson: JSON.stringify(extractTrackedFields(existing)),
      enteredAtISO: currentVersion.enteredAtISO,
      enteredByUserId: currentVersion.enteredByUserId,
      supersededAtISO: plan.supersede.supersededAtISO,
      supersededByUserId: plan.supersede.supersededByUserId,
    },
    liveStamps: {
      enteredAtISO: nowISO,
      enteredByUserId: actorUserId,
    },
  };
}

/** A stored revision row (roleHolderRevisions table shape). */
export interface StoredRevision {
  roleHolderId: string;
  dataJson: string;
  enteredAtISO: string;
  enteredByUserId?: string;
  supersededAtISO: string;
  supersededByUserId?: string;
}

/** A live role-holder row (only the fields this module needs). */
export interface LiveRoleHolder extends Record<string, unknown> {
  _id: string;
  createdAtISO?: string;
  enteredAtISO?: string;
  enteredByUserId?: string;
}

function revisionToVersion(rev: StoredRevision): RoleHolderVersion {
  let fields: TrackedFields = {};
  try {
    fields = JSON.parse(rev.dataJson) as TrackedFields;
  } catch {
    fields = {};
  }
  return {
    recordId: rev.roleHolderId,
    ...fields,
    enteredAtISO: rev.enteredAtISO,
    enteredByUserId: rev.enteredByUserId,
    supersededAtISO: rev.supersededAtISO,
    supersededByUserId: rev.supersededByUserId,
  };
}

function liveToVersion(row: LiveRoleHolder): RoleHolderVersion {
  return {
    recordId: String(row._id),
    ...extractTrackedFields(row),
    enteredAtISO: enteredAt(row),
    enteredByUserId: row.enteredByUserId,
    supersededAtISO: null,
  };
}

/**
 * The full version timeline for one role holder: every closed revision plus the
 * current live row, oldest first.
 */
export function buildTimeline(
  revisions: StoredRevision[],
  liveRow?: LiveRoleHolder,
): RoleHolderVersion[] {
  const versions = revisions.map(revisionToVersion);
  if (liveRow) {
    versions.push(liveToVersion(liveRow));
  }
  return versions.sort((a, b) => a.enteredAtISO.localeCompare(b.enteredAtISO));
}

/**
 * The whole society register reconstructed as it stood at `iso` — the version of
 * each role holder that was current at that instant. Uses versionedRegister's
 * as-of filter + latest-per-key.
 */
export function registerAsOf(
  revisions: StoredRevision[],
  liveRows: LiveRoleHolder[],
  iso: string,
): RoleHolderVersion[] {
  const versions = [
    ...revisions.map(revisionToVersion),
    ...liveRows.map(liveToVersion),
  ];
  // Each record's versions hold non-overlapping [enteredAt, supersededAt)
  // intervals, so asOfRows yields one active version per record; dedup by the
  // latest entry defensively (latestByKey is unusable here — it re-filters to
  // open rows, which would drop as-of-active historical versions).
  const active = asOfRows(versions, iso);
  const byKey = new Map<string, RoleHolderVersion>();
  for (const version of active) {
    const existing = byKey.get(version.recordId);
    if (!existing || version.enteredAtISO >= existing.enteredAtISO) {
      byKey.set(version.recordId, version);
    }
  }
  return Array.from(byKey.values());
}

/**
 * Classify what changed in the register between two instants: each role holder is
 * new / update / delete / unchanged. Delegates to registerDiff.diffRegister over
 * the as-of reconstructions, comparing only the tracked payload fields.
 */
export function changesBetween(
  revisions: StoredRevision[],
  liveRows: LiveRoleHolder[],
  fromISO: string,
  toISO: string,
): DiffRow<RoleHolderVersion>[] {
  const before = registerAsOf(revisions, liveRows, fromISO);
  const after = registerAsOf(revisions, liveRows, toISO);
  return diffRegister(before, after, {
    keyField: "recordId",
    compareFields: [...ROLE_HOLDER_VERSION_FIELDS],
  });
}

/** A field-level before→after change within one edit. */
export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Diff two consecutive versions' tracked fields into a list of field changes.
 * Used to render "what changed" per edit in the history view.
 */
export function fieldChanges(
  previous: RoleHolderVersion | undefined,
  next: RoleHolderVersion,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of ROLE_HOLDER_VERSION_FIELDS) {
    const from = previous ? previous[field] ?? null : null;
    const to = next[field] ?? null;
    if (from !== to) {
      changes.push({ field, from, to });
    }
  }
  return changes;
}
