import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("orgChartAssignments")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

/**
 * Org chart as it stood on `asOf` (YYYY-MM-DD), reconstructed from the
 * append-only revision history: for each subject, the revision that was open at
 * end-of-day on that date. History begins at the first edit after the revisions
 * table existed, so dates before that return nothing for the affected subjects.
 */
export const listAsOf = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, asOf }) => {
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
  },
});

/** Close any open revision for a subject (stamp supersededAtISO). */
async function closeOpenRevision(
  ctx: any,
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

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    subjectType: v.string(),
    subjectId: v.string(),
    subjectName: v.string(),
    managerType: v.optional(v.string()),
    managerId: v.optional(v.string()),
    managerName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
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
  },
});

export const remove = mutation({
  args: {
    societyId: v.id("societies"),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("orgChartAssignments")
      .withIndex("by_subject", (q) =>
        q.eq("societyId", args.societyId).eq("subjectType", args.subjectType).eq("subjectId", args.subjectId),
      )
      .first();
    // Closing the open revision with no successor records "no manager from now".
    await closeOpenRevision(ctx, args.societyId, args.subjectType, args.subjectId, new Date().toISOString());
    if (existing) await ctx.db.delete(existing._id);
  },
});
