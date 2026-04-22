import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("tasks")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const byCommittee = query({
  args: { committeeId: v.id("committees") },
  handler: async (ctx, { committeeId }) =>
    ctx.db
      .query("tasks")
      .withIndex("by_committee", (q) => q.eq("committeeId", committeeId))
      .collect(),
});

export const byGoal = query({
  args: { goalId: v.id("goals") },
  handler: async (ctx, { goalId }) =>
    ctx.db
      .query("tasks")
      .withIndex("by_goal", (q) => q.eq("goalId", goalId))
      .collect(),
});

export const byMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) =>
    ctx.db
      .query("tasks")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(),
    priority: v.string(),
    assignee: v.optional(v.string()),
    responsibleUserIds: v.optional(v.array(v.id("users"))),
    dueDate: v.optional(v.string()),
    committeeId: v.optional(v.id("committees")),
    meetingId: v.optional(v.id("meetings")),
    goalId: v.optional(v.id("goals")),
    filingId: v.optional(v.id("filings")),
    workflowId: v.optional(v.id("workflows")),
    documentId: v.optional(v.id("documents")),
    eventId: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("tasks", {
      ...args,
      createdAtISO: new Date().toISOString(),
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "You",
      entityType: "task",
      entityId: id,
      action: "created",
      summary: `Created task "${args.title}"`,
      createdAtISO: new Date().toISOString(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      status: v.optional(v.string()),
      priority: v.optional(v.string()),
      assignee: v.optional(v.string()),
      responsibleUserIds: v.optional(v.array(v.id("users"))),
      dueDate: v.optional(v.string()),
      committeeId: v.optional(v.id("committees")),
      meetingId: v.optional(v.id("meetings")),
      goalId: v.optional(v.id("goals")),
      filingId: v.optional(v.id("filings")),
      workflowId: v.optional(v.id("workflows")),
      documentId: v.optional(v.id("documents")),
      eventId: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      completedAt: v.optional(v.string()),
      completedByUserId: v.optional(v.id("users")),
      completionNote: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const task = await ctx.db.get(id);
    if (!task) return;
    const next = { ...patch };
    if (patch.status === "Done" && !task.completedAt) {
      next.completedAt = new Date().toISOString();
    }
    if (patch.status && patch.status !== "Done" && task.completedAt) {
      next.completedAt = undefined as any;
    }
    await ctx.db.patch(id, next);
    if (patch.status) {
      await ctx.db.insert("activity", {
        societyId: task.societyId,
        actor: "You",
        entityType: "task",
        entityId: id,
        action: patch.status === "Done" ? "completed" : "updated",
        summary: `${patch.status === "Done" ? "Completed" : "Moved"} task "${task.title}" → ${patch.status}`,
        createdAtISO: new Date().toISOString(),
      });
    }
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
