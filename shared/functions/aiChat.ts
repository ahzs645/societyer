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

export async function listThreadsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("aiChatThreads")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 20);
}

export async function messagesForThreadPortable(
  ctx: PortableQueryCtx,
  { threadId }: { threadId: string },
) {
  await requireOwnedRow(ctx, "aiChatThreads", threadId);
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
  return requireOwnedRow(ctx, "aiChatThreads", threadId);
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
  await requireSocietyMembership(ctx, args.societyId);
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
  await requireOwnedRow(ctx, "aiChatThreads", threadId);
  await ctx.db.patch(threadId, { status: "archived", updatedAtISO: new Date().toISOString() });
  return threadId;
}

export async function renameThreadPortable(
  ctx: PortableMutationCtx,
  { threadId, title }: { threadId: string; title: string },
) {
  await requireOwnedRow(ctx, "aiChatThreads", threadId);
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
  await requireOwnedRow(ctx, "aiChatThreads", threadId);
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
