import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getActiveBylawRuleSet } from "./lib/bylawRules";

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
  handler: async (ctx, args) => {
    const rules = await getActiveBylawRuleSet(ctx, args.societyId);
    if (!rules.allowProxyVoting) {
      throw new Error(
        "Proxy voting is disabled by the active bylaw rule set.",
      );
    }
    if (rules.proxyHolderMustBeMember && !args.proxyHolderMemberId) {
      throw new Error(
        "The proxy holder must be linked to a member under the active bylaw rule set.",
      );
    }

    const existing = await ctx.db
      .query("proxies")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
    const activeForGrantor = existing.filter((proxy) => {
      if (proxy.revokedAtISO) return false;
      if (args.grantorMemberId && proxy.grantorMemberId) {
        return proxy.grantorMemberId === args.grantorMemberId;
      }
      return proxy.grantorName.trim().toLowerCase() === args.grantorName.trim().toLowerCase();
    });
    if (activeForGrantor.length >= rules.proxyLimitPerGrantorPerMeeting) {
      throw new Error(
        `A grantor may only appoint ${rules.proxyLimitPerGrantorPerMeeting} proxy holder(s) for a meeting under the active bylaw rule set.`,
      );
    }

    return ctx.db.insert("proxies", args);
  },
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
