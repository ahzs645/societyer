import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
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

export const list = authorizedQuery("tasks:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => tasksList(await toPortableQueryCtx(ctx), args),
});

export const byCommittee = authorizedQuery("tasks:byCommittee", query)({
  args: { committeeId: v.id("committees") },
  returns: v.any(),
  handler: async (ctx, args) => tasksByCommittee(await toPortableQueryCtx(ctx), args),
});

export const byGoal = authorizedQuery("tasks:byGoal", query)({
  args: { goalId: v.id("goals") },
  returns: v.any(),
  handler: async (ctx, args) => tasksByGoal(await toPortableQueryCtx(ctx), args),
});

export const byMeeting = authorizedQuery("tasks:byMeeting", query)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => tasksByMeeting(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("tasks:create", mutation)({
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
  handler: async (ctx, args) => taskCreate(await toPortableMutationCtx(ctx), args),
});

export const update = authorizedMutation("tasks:update", mutation)({
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
  handler: async (ctx, args) => taskUpdate(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("tasks:remove", mutation)({
  args: { id: v.id("tasks") },
  returns: v.any(),
  handler: async (ctx, args) => taskRemove(await toPortableMutationCtx(ctx), args),
});

export const observeAction = authorizedMutation('tasks:observeAction', mutation)({
  args: { societyId: v.id('societies'), registerKey: v.string(), externalActionId: v.string(), title: v.string(), observation: v.any() }, returns: v.any(),
  handler: async (ctx, args) => (await import('../shared/functions/tasks')).observeAction(await toPortableMutationCtx(ctx), args),
});
