import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("proxies")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const forMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) =>
    ctx.db
      .query("proxies")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    grantorName: v.string(),
    grantorMemberId: v.optional(v.id("members")),
    proxyHolderName: v.string(),
    proxyHolderMemberId: v.optional(v.id("members")),
    instructions: v.optional(v.string()),
    signedAtISO: v.string(),
  },
  handler: async (ctx, args) => ctx.db.insert("proxies", args),
});

export const revoke = mutation({
  args: { id: v.id("proxies") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { revokedAtISO: new Date().toISOString() });
  },
});

export const remove = mutation({
  args: { id: v.id("proxies") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
