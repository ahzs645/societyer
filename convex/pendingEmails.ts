import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import {
  listPortable,
  getPortable,
  createPortable,
  updatePortable,
  markSentPortable,
  cancelPortable,
  removePortable,
} from "../shared/functions/pendingEmails";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

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
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("pendingEmails") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const markSent = mutation({
  args: {
    id: v.id("pendingEmails"),
    sentChannel: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => markSentPortable(await toPortableMutationCtx(ctx), args),
});

export const cancel = mutation({
  args: {
    id: v.id("pendingEmails"),
    reason: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => cancelPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: {
    id: v.id("pendingEmails"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
