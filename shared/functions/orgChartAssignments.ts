/**
 * PORTABLE FUNCTIONS: the org-chart-assignments domain
 * (list / listAsOf / upsert / remove).
 *
 * Reads/writes the `orgChartAssignments` table plus its append-only bitemporal
 * history in `orgChartAssignmentRevisions`, over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `closeOpenRevision` is a pure (`ctx.db`-only) helper shared by the
 * two mutations.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("orgChartAssignments")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

/**
 * Org chart as it stood on `asOf` (YYYY-MM-DD), reconstructed from the
 * append-only revision history: for each subject, the revision that was open at
 * end-of-day on that date. History begins at the first edit after the revisions
 * table existed, so dates before that return nothing for the affected subjects.
 */
export async function listAsOfPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
  const asOfEnd = `${asOf}T23:59:59.999Z`;
  const revisions = await ctx.db
    .query("orgChartAssignmentRevisions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const bySubject = new Map<string, any>();
  for (const rev of revisions) {
    if (rev.enteredAtISO > asOfEnd) continue;
    if (rev.supersededAtISO && rev.supersededAtISO <= asOfEnd) continue;
    bySubject.set(`${rev.subjectType}:${rev.subjectId}`, rev);
  }
  return Array.from(bySubject.values()).map((rev) => ({
    _id: rev._id,
    societyId: rev.societyId,
    subjectType: rev.subjectType,
    subjectId: rev.subjectId,
    subjectName: rev.subjectName,
    managerType: rev.managerType,
    managerId: rev.managerId,
    managerName: rev.managerName,
    notes: rev.notes,
    updatedAtISO: rev.enteredAtISO,
  }));
}

/** Close any open revision for a subject (stamp supersededAtISO). */
async function closeOpenRevision(
  ctx: PortableMutationCtx,
  societyId: any,
  subjectType: string,
  subjectId: string,
  nowISO: string,
) {
  const open = await ctx.db
    .query("orgChartAssignmentRevisions")
    .withIndex("by_subject", (q: any) =>
      q.eq("societyId", societyId).eq("subjectType", subjectType).eq("subjectId", subjectId),
    )
    .collect();
  for (const rev of open) {
    if (!rev.supersededAtISO) await ctx.db.patch(rev._id, { supersededAtISO: nowISO });
  }
}

export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    subjectType: string;
    subjectId: string;
    subjectName: string;
    managerType?: string;
    managerId?: string;
    managerName?: string;
    notes?: string;
  },
) {
  const existing = await ctx.db
    .query("orgChartAssignments")
    .withIndex("by_subject", (q) =>
      q.eq("societyId", args.societyId).eq("subjectType", args.subjectType).eq("subjectId", args.subjectId),
    )
    .first();
  const nowISO = new Date().toISOString();
  const patch = {
    subjectName: args.subjectName,
    managerType: args.managerType || undefined,
    managerId: args.managerId || undefined,
    managerName: args.managerName || undefined,
    notes: args.notes || undefined,
    updatedAtISO: nowISO,
  };
  // Append a new bitemporal revision: close the open one, open a new one.
  await closeOpenRevision(ctx, args.societyId, args.subjectType, args.subjectId, nowISO);
  await ctx.db.insert("orgChartAssignmentRevisions", {
    societyId: args.societyId,
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    subjectName: args.subjectName,
    managerType: args.managerType || undefined,
    managerId: args.managerId || undefined,
    managerName: args.managerName || undefined,
    notes: args.notes || undefined,
    enteredAtISO: nowISO,
  });
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("orgChartAssignments", {
    societyId: args.societyId,
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    ...patch,
  });
}

export async function removePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    subjectType: string;
    subjectId: string;
  },
) {
  const existing = await ctx.db
    .query("orgChartAssignments")
    .withIndex("by_subject", (q) =>
      q.eq("societyId", args.societyId).eq("subjectType", args.subjectType).eq("subjectId", args.subjectId),
    )
    .first();
  // Closing the open revision with no successor records "no manager from now".
  await closeOpenRevision(ctx, args.societyId, args.subjectType, args.subjectId, new Date().toISOString());
  if (existing) await ctx.db.delete(existing._id);
}
