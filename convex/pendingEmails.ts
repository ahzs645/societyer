import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const ATTACHMENT_SHAPE = v.array(
  v.object({
    documentId: v.id("documents"),
    fileName: v.string(),
  }),
);

export const list = query({
  args: {
    societyId: v.id("societies"),
    status: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, status }) => {
    const rows = status
      ? await ctx.db
          .query("pendingEmails")
          .withIndex("by_society_status", (q) =>
            q.eq("societyId", societyId).eq("status", status),
          )
          .order("desc")
          .collect()
      : await ctx.db
          .query("pendingEmails")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .order("desc")
          .collect();
    return rows;
  },
});

export const get = query({
  args: { id: v.id("pendingEmails") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    nodeKey: v.optional(v.string()),
    fromName: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    to: v.string(),
    cc: v.optional(v.string()),
    bcc: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    attachments: v.optional(ATTACHMENT_SHAPE),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("pendingEmails", {
      societyId: args.societyId,
      workflowId: args.workflowId,
      workflowRunId: args.workflowRunId,
      nodeKey: args.nodeKey,
      fromName: args.fromName,
      fromEmail: args.fromEmail,
      replyTo: args.replyTo,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      body: args.body,
      attachments: args.attachments ?? [],
      status: args.status ?? "ready",
      createdAtISO: new Date().toISOString(),
      createdByUserId: args.actingUserId,
      notes: args.notes,
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("pendingEmails"),
    patch: v.object({
      to: v.optional(v.string()),
      fromName: v.optional(v.string()),
      fromEmail: v.optional(v.string()),
      replyTo: v.optional(v.string()),
      cc: v.optional(v.string()),
      bcc: v.optional(v.string()),
      subject: v.optional(v.string()),
      body: v.optional(v.string()),
      attachments: v.optional(ATTACHMENT_SHAPE),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Pending email not found");
    await ctx.db.patch(id, patch);
  },
});

export const markSent = mutation({
  args: {
    id: v.id("pendingEmails"),
    sentChannel: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, sentChannel, notes, actingUserId }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Pending email not found");
    await ctx.db.patch(id, {
      status: "sent",
      sentAtISO: new Date().toISOString(),
      sentByUserId: actingUserId,
      sentChannel: sentChannel ?? existing.sentChannel ?? "personal_email",
      notes: notes ?? existing.notes,
    });
  },
});

export const cancel = mutation({
  args: {
    id: v.id("pendingEmails"),
    reason: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, reason }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Pending email not found");
    await ctx.db.patch(id, {
      status: "cancelled",
      notes: reason ?? existing.notes,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("pendingEmails"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
