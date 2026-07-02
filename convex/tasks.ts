import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  tasksList,
  tasksByCommittee,
  tasksByGoal,
  tasksByMeeting,
  taskCreate,
  taskUpdate,
  taskRemove,
} from "../shared/functions/tasks";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => tasksList(toPortableQueryCtx(ctx), args),
});

export const byCommittee = query({
  args: { committeeId: v.id("committees") },
  returns: v.any(),
  handler: (ctx, args) => tasksByCommittee(toPortableQueryCtx(ctx), args),
});

export const byGoal = query({
  args: { goalId: v.id("goals") },
  returns: v.any(),
  handler: (ctx, args) => tasksByGoal(toPortableQueryCtx(ctx), args),
});

export const byMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: (ctx, args) => tasksByMeeting(toPortableQueryCtx(ctx), args),
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
    commitmentId: v.optional(v.id("commitments")),
    eventId: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => taskCreate(toPortableMutationCtx(ctx), args),
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
      commitmentId: v.optional(v.id("commitments")),
      eventId: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      completedAt: v.optional(v.string()),
      completedByUserId: v.optional(v.id("users")),
      completionNote: v.optional(v.string()),
      // Convex strips `undefined` patch fields from the wire, so unlinking a
      // task from its meeting needs an explicit flag.
      clearMeetingId: v.optional(v.boolean()),
    }),
  },
  returns: v.any(),
  handler: (ctx, args) => taskUpdate(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  returns: v.any(),
  handler: (ctx, args) => taskRemove(toPortableMutationCtx(ctx), args),
});
