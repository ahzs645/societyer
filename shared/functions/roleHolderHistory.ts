/**
 * PORTABLE FUNCTIONS: the role-holder edit-history read domain
 * (revisionHistory / registerAsOf / changesBetween).
 *
 * Read-side of the role-holder edit history. The write path
 * (legalOperations.upsertRoleHolder / removeRoleHolder) appends a closed
 * revision per edit; these queries reconstruct timelines and as-of/diff views
 * via the pure shared/roleHolderHistory helpers. Each handler runs unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableQueryCtx } from "../portable/ctx";
import { requireOwnedRow, requireSocietyMembership } from "./access";
import {
  buildTimeline,
  changesBetween as changesBetweenPure,
  fieldChanges,
  registerAsOf as registerAsOfPure,
  type LiveRoleHolder,
  type StoredRevision,
} from "../roleHolderHistory";

function toStoredRevisions(rows: any[]): StoredRevision[] {
  return rows.map((row) => ({
    roleHolderId: String(row.roleHolderId),
    dataJson: String(row.dataJson ?? "{}"),
    enteredAtISO: String(row.enteredAtISO ?? row.createdAtISO ?? ""),
    enteredByUserId: row.enteredByUserId,
    supersededAtISO: String(row.supersededAtISO ?? ""),
    supersededByUserId: row.supersededByUserId,
  }));
}

/** The full edit timeline for one role holder, with per-edit field changes. */
export async function revisionHistoryPortable(
  ctx: PortableQueryCtx,
  { roleHolderId }: { roleHolderId: string },
) {
  // Revisions deliberately outlive their role holder: deleting one must not
  // destroy its audit trail. Authorizing against the live row alone made a
  // deleted role holder's history unreadable even to its own society's Owner.
  // Fall back to the surviving revisions' own society — the tenancy check still
  // runs, it just uses the rows that still exist.
  const [liveRow, revisionRows] = await Promise.all([
    ctx.db.get(roleHolderId, "roleHolders"),
    ctx.db.query("roleHolderRevisions").withIndex("by_role_holder", (q) => q.eq("roleHolderId", roleHolderId)).collect(),
  ]);
  const societyIds = new Set(
    [liveRow?.societyId, ...revisionRows.map((row) => row.societyId)]
      .filter(Boolean)
      .map(String),
  );
  // Unknown ID, or rows that disagree about their owner: same uniform
  // not-found `requireOwnedRow` would have produced, so this cannot be used to
  // probe whether a foreign role holder exists.
  if (societyIds.size !== 1) throw new Error("roleHolders not found.");
  const [societyId] = [...societyIds];
  try {
    await requireSocietyMembership(ctx, societyId);
  } catch {
    throw new Error("roleHolders not found.");
  }
  const timeline = buildTimeline(
    toStoredRevisions(revisionRows),
    liveRow ? ({ ...liveRow, _id: String(liveRow._id) } as LiveRoleHolder) : undefined,
  );
  return timeline.map((version, index) => ({
    enteredAtISO: version.enteredAtISO,
    enteredByUserId: version.enteredByUserId ?? null,
    supersededAtISO: version.supersededAtISO ?? null,
    supersededByUserId: version.supersededByUserId ?? null,
    isCurrent: version.supersededAtISO == null,
    fullName: version.fullName ?? null,
    changes: fieldChanges(index === 0 ? undefined : timeline[index - 1], version),
  }));
}

/** The whole register reconstructed as it stood at a past instant. */
export async function registerAsOfPortable(
  ctx: PortableQueryCtx,
  { societyId, asOfISO }: { societyId: string; asOfISO: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const [revisionRows, liveRows] = await Promise.all([
    ctx.db.query("roleHolderRevisions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return registerAsOfPure(
    toStoredRevisions(revisionRows),
    liveRows.map((row: any) => ({ ...row, _id: String(row._id) })) as LiveRoleHolder[],
    asOfISO,
  );
}

/** What changed in the register between two instants (new/update/delete). */
export async function changesBetweenPortable(
  ctx: PortableQueryCtx,
  { societyId, fromISO, toISO }: { societyId: string; fromISO: string; toISO: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const [revisionRows, liveRows] = await Promise.all([
    ctx.db.query("roleHolderRevisions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const diff = changesBetweenPure(
    toStoredRevisions(revisionRows),
    liveRows.map((row: any) => ({ ...row, _id: String(row._id) })) as LiveRoleHolder[],
    fromISO,
    toISO,
  );
  return diff.map((row) => ({
    op: row.op,
    key: row.key,
    name: String((row.desired ?? row.current)?.fullName ?? ""),
  }));
}
