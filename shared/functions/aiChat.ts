/**
 * PORTABLE FUNCTIONS: the AI chat domain
 * (listThreads / messagesForThread / getThread /
 *  createThread / archiveThread / renameThread / deleteThread).
 *
 * Thread + message CRUD over the `aiChatThreads` and `aiMessages` tables via
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle. The send/completion path (actions) and
 * the `_appendMessage` internal mutation stay in convex/aiChat.ts.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireOwnedRow, principalUserId, requireSocietyMembership } from "./access";
import { hasPermission, requirePermissionPortable } from "./permissions";
import { composeAiMessage } from "../aiAttachments";

/** Registered only by the explicit demo client, never by the hosted API. */
export async function simulateDemoChatPortable(ctx: PortableMutationCtx, args: { societyId: string; threadId?: string; content: string; attachments?: unknown; browsingContext?: unknown }) {
  const content = composeAiMessage(args.content, args.attachments);
  const threadId = args.threadId ?? await createThreadPortable(ctx, { societyId: args.societyId, title: args.content, browsingContext: args.browsingContext });
  const thread = await requireAiThreadAccess(ctx, threadId);
  if (thread.societyId !== args.societyId) throw new Error("AI chat is not available in this workspace.");
  const createdByUserId = await principalUserId(ctx, args.societyId);
  const now = new Date().toISOString();
  await ctx.db.insert("aiMessages", { societyId: args.societyId, threadId, role: "user", content, status: "complete", createdByUserId, createdAtISO: now });
  const reply = "Simulated demo reply. No AI provider was contacted. This demonstration saves your text in a private conversation; it does not analyze attached files.";
  const messageId = await ctx.db.insert("aiMessages", { societyId: args.societyId, threadId, role: "assistant", content: reply, status: "complete", parts: { provider: "demo_simulation" }, createdByUserId, createdAtISO: now });
  await ctx.db.patch(threadId, { updatedAtISO: now, lastMessageAtISO: now });
  return { threadId, messageId, content: reply, provider: "demo_simulation" };
}

/** Chats can contain protected source material: workspace membership alone is insufficient. */
export async function requireAiThreadAccess(ctx: PortableQueryCtx, threadId: string) {
  const thread = await requireOwnedRow(ctx, "aiChatThreads", threadId);
  await requirePermissionPortable(ctx, thread.societyId, "tasks:write");
  const userId = await principalUserId(ctx, thread.societyId);
  if (!thread.createdByUserId || thread.createdByUserId !== userId) throw new Error("AI chat is not available to this account.");
  return thread;
}

export async function listThreadsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  const user = await requireSocietyMembership(ctx, societyId);
  if (!hasPermission(String(user.role), "tasks:write")) return [];
  await requirePermissionPortable(ctx, societyId, "tasks:write");
  const userId = await principalUserId(ctx, societyId);
  return ctx.db
    .query("aiChatThreads")
    .withIndex("by_society_creator", (q: any) => q.eq("societyId", societyId).eq("createdByUserId", userId))
    .order("desc")
    .take(Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit!) : 20)));
}

export async function messagesForThreadPortable(
  ctx: PortableQueryCtx,
  { threadId }: { threadId: string },
) {
  await requireAiThreadAccess(ctx, threadId);
  return ctx.db
    .query("aiMessages")
    .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
    .order("asc")
    .collect();
}

export async function getThreadPortable(
  ctx: PortableQueryCtx,
  { threadId }: { threadId: string },
) {
  return requireAiThreadAccess(ctx, threadId);
}

export async function createThreadPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title?: string;
    modelId?: string;
    browsingContext?: any;
    workspaceInstructions?: string;
    actingUserId?: string;
  },
) {
  await requirePermissionPortable(ctx, args.societyId, "tasks:write");
  const createdByUserId = await principalUserId(ctx, args.societyId);
  if (args.actingUserId && args.actingUserId !== createdByUserId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  const now = new Date().toISOString();
  return await ctx.db.insert("aiChatThreads", {
    societyId: args.societyId,
    title: args.title?.trim() || "New AI chat",
    status: "active",
    modelId: args.modelId,
    browsingContext: args.browsingContext,
    workspaceInstructions: args.workspaceInstructions,
    createdByUserId,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function archiveThreadPortable(
  ctx: PortableMutationCtx,
  { threadId }: { threadId: string },
) {
  await requireAiThreadAccess(ctx, threadId);
  await ctx.db.patch(threadId, { status: "archived", updatedAtISO: new Date().toISOString() });
  return threadId;
}

export async function renameThreadPortable(
  ctx: PortableMutationCtx,
  { threadId, title }: { threadId: string; title: string },
) {
  await requireAiThreadAccess(ctx, threadId);
  const trimmed = title.trim();
  if (!trimmed) return threadId;
  await ctx.db.patch(threadId, {
    title: trimmed.slice(0, 200),
    updatedAtISO: new Date().toISOString(),
  });
  return threadId;
}

export async function deleteThreadPortable(
  ctx: PortableMutationCtx,
  { threadId }: { threadId: string },
) {
  await requireAiThreadAccess(ctx, threadId);
  const messages = await ctx.db
    .query("aiMessages")
    .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
    .collect();
  for (const message of messages) {
    await ctx.db.delete(message._id);
  }
  await ctx.db.delete(threadId);
  return threadId;
}
