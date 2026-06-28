import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("members") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    membershipClass: v.string(),
    status: v.string(),
    joinedAt: v.string(),
    votingRights: v.boolean(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => ctx.db.insert("members", args),
});

export const update = mutation({
  args: {
    id: v.id("members"),
    patch: v.object({
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      email: v.optional(v.string()),
      aliases: v.optional(v.array(v.string())),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      membershipClass: v.optional(v.string()),
      status: v.optional(v.string()),
      joinedAt: v.optional(v.string()),
      leftAt: v.optional(v.string()),
      votingRights: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("members") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

// Tables/columns that reference members by id. Only top-level scalar FK columns
// are listed: member ids embedded inside array-of-object snapshots (written
// resolution signatures, election-question options, minutes/motion movers) are
// intentionally NOT rewired — those are historical records of who acted at the
// time, not live relationships.
const MEMBER_FK_REFS: Array<[string, string]> = [
  ["directors", "memberId"],
  ["boardRoleAssignments", "memberId"],
  ["boardRoleChanges", "memberId"],
  ["boardRoleChanges", "previousMemberId"],
  ["committeeMembers", "memberId"],
  ["memberCommunicationPrefs", "memberId"],
  ["communicationDeliveries", "memberId"],
  ["grantApplications", "memberId"],
  ["signatures", "memberId"],
  ["signatureProfiles", "memberId"],
  ["noticeDeliveries", "memberId"],
  ["memberSubscriptions", "memberId"],
  ["fundingSources", "linkedMemberId"],
  ["users", "memberId"],
  ["volunteers", "memberId"],
  ["volunteerApplications", "memberId"],
  ["pipaTrainings", "participantMemberId"],
  ["proxies", "grantorMemberId"],
  ["proxies", "proxyHolderMemberId"],
  ["electionEligibleVoters", "memberId"],
  ["electionNominations", "memberId"],
];

export const merge = mutation({
  args: {
    keepId: v.id("members"),
    dropIds: v.array(v.id("members")),
    patch: v.object({
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      email: v.optional(v.string()),
      aliases: v.optional(v.array(v.string())),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      membershipClass: v.optional(v.string()),
      status: v.optional(v.string()),
      joinedAt: v.optional(v.string()),
      votingRights: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { keepId, dropIds, patch }) => {
    const keep = await ctx.db.get(keepId);
    if (!keep) throw new Error("Member to keep not found.");

    // Scope guard: never merge members across societies.
    const drops: any[] = [];
    for (const id of dropIds) {
      if (id === keepId) continue;
      const drop = await ctx.db.get(id);
      if (!drop) continue;
      if (String(drop.societyId) !== String(keep.societyId)) {
        throw new Error("Cannot merge members from different societies.");
      }
      drops.push(drop);
    }

    await ctx.db.patch(keepId, patch);

    // Rewire dependent foreign keys onto the surviving member, then delete.
    let rewired = 0;
    for (const drop of drops) {
      for (const [table, field] of MEMBER_FK_REFS) {
        const rows = await (ctx.db as any)
          .query(table)
          .filter((q: any) => q.eq(q.field(field), drop._id))
          .collect();
        for (const row of rows) {
          // Don't drag rows across societies (some tables, e.g. users, may be
          // shared); only rewire rows in the same society as the kept member.
          if (row.societyId !== undefined && String(row.societyId) !== String(keep.societyId)) {
            continue;
          }
          await ctx.db.patch(row._id, { [field]: keepId });
          rewired += 1;
        }
      }
      await ctx.db.delete(drop._id);
    }

    return { keepId, merged: drops.length, rewired };
  },
});
