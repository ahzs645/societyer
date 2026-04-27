import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("invitations")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    email: v.string(),
    role: v.string(),
    invitedByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!args.email.trim()) throw new Error("Email is required");
    const token = `inv_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    return ctx.db.insert("invitations", {
      ...args,
      email: args.email.trim().toLowerCase(),
      token,
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const revoke = mutation({
  args: { id: v.id("invitations") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { revokedAtISO: new Date().toISOString() });
  },
});

export const getByToken = query({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, { token }) =>
    ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique(),
});
