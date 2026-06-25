import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  buildTimeline,
  changesBetween as changesBetweenPure,
  fieldChanges,
  registerAsOf as registerAsOfPure,
  type LiveRoleHolder,
  type StoredRevision,
} from "../shared/roleHolderHistory";

/**
 * Read-side of the role-holder edit history. The write path
 * (legalOperations.upsertRoleHolder / removeRoleHolder) appends a closed
 * revision per edit; these queries reconstruct timelines and as-of/diff views
 * via the pure shared/roleHolderHistory helpers.
 */

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
export const revisionHistory = query({
  args: { roleHolderId: v.id("roleHolders") },
  returns: v.any(),
  handler: async (ctx, { roleHolderId }) => {
    const [revisionRows, liveRow] = await Promise.all([
      ctx.db.query("roleHolderRevisions").withIndex("by_role_holder", (q) => q.eq("roleHolderId", roleHolderId)).collect(),
      ctx.db.get(roleHolderId),
    ]);
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
  },
});

/** The whole register reconstructed as it stood at a past instant. */
export const registerAsOf = query({
  args: { societyId: v.id("societies"), asOfISO: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, asOfISO }) => {
    const [revisionRows, liveRows] = await Promise.all([
      ctx.db.query("roleHolderRevisions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);
    return registerAsOfPure(
      toStoredRevisions(revisionRows),
      liveRows.map((row: any) => ({ ...row, _id: String(row._id) })) as LiveRoleHolder[],
      asOfISO,
    );
  },
});

/** What changed in the register between two instants (new/update/delete). */
export const changesBetween = query({
  args: { societyId: v.id("societies"), fromISO: v.string(), toISO: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, fromISO, toISO }) => {
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
  },
});
