import { v } from "convex/values";
import { internalMutation, mutation, query } from "./lib/untypedServer";

export const listThreads = query({
  args: {
    societyId: v.id("societies"),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, limit }) =>
    ctx.db
      .query("aiChatThreads")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 20),
});

export const messagesForThread = query({
  args: {
    threadId: v.id("aiChatThreads"),
  },
  returns: v.any(),
  handler: async (ctx, { threadId }) =>
    ctx.db
      .query("aiMessages")
      .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
      .order("asc")
      .collect(),
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
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("aiChatThreads", {
      societyId: args.societyId,
      title: args.title?.trim() || "New AI chat",
      status: "active",
      modelId: args.modelId,
      browsingContext: args.browsingContext,
      workspaceInstructions: args.workspaceInstructions,
      createdByUserId: args.actingUserId,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const archiveThread = mutation({
  args: {
    threadId: v.id("aiChatThreads"),
  },
  returns: v.any(),
  handler: async (ctx, { threadId }) => {
    await ctx.db.patch(threadId, { status: "archived", updatedAtISO: new Date().toISOString() });
    return threadId;
  },
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
