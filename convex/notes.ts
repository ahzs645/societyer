import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listForRecord = query({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
  },
  handler: async (ctx, { societyId, entityType, entityId }) => {
    return ctx.db
      .query("notes")
      .withIndex("by_entity", (q) =>
        q.eq("societyId", societyId).eq("entityType", entityType).eq("entityId", entityId),
      )
      .order("desc")
      .take(200);
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
    author: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.body.trim()) throw new Error("Note body is required");
    return ctx.db.insert("notes", {
      ...args,
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const update = mutation({
  args: { id: v.id("notes"), body: v.string() },
  handler: async (ctx, { id, body }) => {
    if (!body.trim()) throw new Error("Note body is required");
    await ctx.db.patch(id, {
      body,
      updatedAtISO: new Date().toISOString(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
