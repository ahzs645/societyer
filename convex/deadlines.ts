import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";

const statusValidator = v.union(
  v.literal("open"),
  v.literal("complete"),
  v.literal("closed"),
);

function deriveStatus(doc: any): "open" | "complete" | "closed" {
  if (doc?.status === "open" || doc?.status === "complete" || doc?.status === "closed") {
    return doc.status;
  }
  return doc?.done ? "complete" : "open";
}

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("deadlines")
      .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
      .order("asc")
      .collect();
    return rows.map((r: any) => {
      const status = deriveStatus(r);
      return { ...r, status, done: status === "complete" };
    });
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    description: v.optional(v.string()),
    dueDate: v.string(),
    category: v.string(),
    status: v.optional(statusValidator),
    recurrence: v.optional(v.string()),
    linkedFilingId: v.optional(v.id("filings")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { status, ...rest } = args;
    const initial = status ?? "open";
    return ctx.db.insert("deadlines", {
      ...rest,
      status: initial,
      done: initial === "complete",
    });
  },
});

export const setStatus = mutation({
  args: { id: v.id("deadlines"), status: statusValidator },
  returns: v.any(),
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status, done: status === "complete" });
  },
});

export const toggleDone = mutation({
  args: { id: v.id("deadlines"), done: v.boolean() },
  returns: v.any(),
  handler: async (ctx, { id, done }) => {
    const status = done ? "complete" : "open";
    await ctx.db.patch(id, { status, done });
  },
});

export const update = mutation({
  args: {
    id: v.id("deadlines"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      dueDate: v.optional(v.string()),
      category: v.optional(v.string()),
      status: v.optional(statusValidator),
      done: v.optional(v.boolean()),
      recurrence: v.optional(v.string()),
      linkedFilingId: v.optional(v.id("filings")),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    const next: Record<string, unknown> = { ...patch };
    if (patch.status !== undefined) {
      next.done = patch.status === "complete";
    } else if (patch.done !== undefined) {
      next.status = patch.done ? "complete" : "open";
    }
    await ctx.db.patch(id, next);
  },
});

export const remove = mutation({
  args: { id: v.id("deadlines") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const backfillStatus = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("deadlines")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    let updated = 0;
    for (const row of rows) {
      if (row.status === "open" || row.status === "complete" || row.status === "closed") continue;
      const status = row.done ? "complete" : "open";
      await ctx.db.patch(row._id, { status, done: status === "complete" });
      updated += 1;
    }
    return { updated, total: rows.length };
  },
});
