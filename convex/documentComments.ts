import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listForDocument = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) =>
    ctx.db
      .query("documentComments")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect()
      .then((rows) => rows.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)))),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    pageNumber: v.optional(v.number()),
    anchorText: v.optional(v.string()),
    authorName: v.string(),
    authorUserId: v.optional(v.id("users")),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.body.trim()) throw new Error("Comment body is required.");
    const document = await ctx.db.get(args.documentId);
    if (!document || document.societyId !== args.societyId) {
      throw new Error("Document not found for this society.");
    }
    const id = await ctx.db.insert("documentComments", {
      societyId: args.societyId,
      documentId: args.documentId,
      pageNumber: args.pageNumber,
      anchorText: args.anchorText || undefined,
      authorName: args.authorName,
      authorUserId: args.authorUserId,
      body: args.body,
      status: "open",
      createdAtISO: new Date().toISOString(),
    });
    await ctx.db.patch(args.documentId, {
      reviewStatus: document.reviewStatus === "approved" ? "in_review" : document.reviewStatus ?? "in_review",
    });
    return id;
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("documentComments"),
    status: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, status, actingUserId }) => {
    const comment = await ctx.db.get(id);
    if (!comment) return;
    await ctx.db.patch(id, {
      status,
      resolvedAtISO: status === "resolved" ? new Date().toISOString() : undefined,
      resolvedByUserId: status === "resolved" ? actingUserId : undefined,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("documentComments") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
