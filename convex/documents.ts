import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const VISIBLE_DOCUMENT_CATEGORIES = [
  "Constitution",
  "Bylaws",
  "Minutes",
  "FinancialStatement",
  "Policy",
  "Filing",
  "Other",
  "Insurance",
  "Grant",
  "Receipt",
  "CourtOrder",
];

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const groups = await Promise.all(
      VISIBLE_DOCUMENT_CATEGORIES.map((category) =>
        ctx.db
          .query("documents")
          .withIndex("by_society_category", (q) => q.eq("societyId", societyId).eq("category", category))
          .collect(),
      ),
    );
    return groups.flat().sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
  },
});

export const getMany = query({
  args: { ids: v.array(v.id("documents")) },
  handler: async (ctx, { ids }) => {
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return rows.filter(Boolean);
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    title: v.string(),
    category: v.string(),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    retentionYears: v.optional(v.number()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("documents", {
      ...args,
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
    }),
});

export const flagForDeletion = mutation({
  args: { id: v.id("documents"), flagged: v.boolean() },
  handler: async (ctx, { id, flagged }) => {
    await ctx.db.patch(id, { flaggedForDeletion: flagged });
  },
});

export const archive = mutation({
  args: { id: v.id("documents"), reason: v.string() },
  handler: async (ctx, { id, reason }) => {
    await ctx.db.patch(id, {
      archivedAtISO: new Date().toISOString(),
      archivedReason: reason,
      flaggedForDeletion: false,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
