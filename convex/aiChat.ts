import { v } from "convex/values";
import { internalMutation, mutation, query } from "./lib/untypedServer";
import {
  listThreadsPortable,
  messagesForThreadPortable,
  getThreadPortable,
  createThreadPortable,
  archiveThreadPortable,
  renameThreadPortable,
  deleteThreadPortable,
} from "../shared/functions/aiChat";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const listThreads = query({
  args: {
    societyId: v.id("societies"),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: (ctx, args) => listThreadsPortable(toPortableQueryCtx(ctx), args),
});

export const messagesForThread = query({
  args: {
    threadId: v.id("aiChatThreads"),
  },
  returns: v.any(),
  handler: (ctx, args) => messagesForThreadPortable(toPortableQueryCtx(ctx), args),
});

export const getThread = query({
  args: {
    threadId: v.id("aiChatThreads"),
  },
  returns: v.any(),
  handler: (ctx, args) => getThreadPortable(toPortableQueryCtx(ctx), args),
});

export const createThread = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.optional(v.string()),
    modelId: v.optional(v.string()),
    browsingContext: v.optional(v.any()),
    workspaceInstructions: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.id("aiChatThreads"),
  handler: (ctx, args) => createThreadPortable(toPortableMutationCtx(ctx), args),
});

export const archiveThread = mutation({
  args: {
    threadId: v.id("aiChatThreads"),
  },
  returns: v.any(),
  handler: (ctx, args) => archiveThreadPortable(toPortableMutationCtx(ctx), args),
});

export const renameThread = mutation({
  args: {
    threadId: v.id("aiChatThreads"),
    title: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => renameThreadPortable(toPortableMutationCtx(ctx), args),
});

export const deleteThread = mutation({
  args: {
    threadId: v.id("aiChatThreads"),
  },
  returns: v.any(),
  handler: (ctx, args) => deleteThreadPortable(toPortableMutationCtx(ctx), args),
});

export const _appendMessage = internalMutation({
  args: {
    societyId: v.id("societies"),
    threadId: v.id("aiChatThreads"),
    role: v.string(),
    content: v.string(),
    status: v.optional(v.string()),
    modelId: v.optional(v.string()),
    parts: v.optional(v.any()),
    toolCalls: v.optional(v.any()),
    usage: v.optional(v.any()),
    createdByUserId: v.optional(v.id("users")),
  },
  returns: v.id("aiMessages"),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const messageId = await ctx.db.insert("aiMessages", {
      societyId: args.societyId,
      threadId: args.threadId,
      role: args.role,
      content: args.content,
      status: args.status ?? "complete",
      modelId: args.modelId,
      parts: args.parts,
      toolCalls: args.toolCalls,
      usage: args.usage,
      createdByUserId: args.createdByUserId,
      createdAtISO: now,
    });
    const threadPatch: Record<string, any> = {
      updatedAtISO: now,
      lastMessageAtISO: now,
    };
    if (args.role === "user") threadPatch.title = titleFromMessage(args.content);
    await ctx.db.patch(args.threadId, threadPatch);
    return messageId;
  },
});

function titleFromMessage(content: string) {
  const title = content.trim().replace(/\s+/g, " ").slice(0, 72);
  return title || "AI chat";
}
