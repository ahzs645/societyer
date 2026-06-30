/**
 * PORTABLE FUNCTIONS: the pending-emails domain
 * (list / get / create / update / markSent / cancel / remove).
 *
 * Reads/writes the `pendingEmails` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. markSent/cancel are pure status patches (no network/scheduler).
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listPortable(
  ctx: PortableQueryCtx,
  { societyId, status }: { societyId: string; status?: string },
) {
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
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    workflowId?: string;
    workflowRunId?: string;
    nodeKey?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    attachments?: { documentId: string; fileName: string }[];
    status?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
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
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      to?: string;
      fromName?: string;
      fromEmail?: string;
      replyTo?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      body?: string;
      attachments?: { documentId: string; fileName: string }[];
      status?: string;
      notes?: string;
    };
    actingUserId?: string;
  },
) {
  const existing = await ctx.db.get(id);
  if (!existing) throw new Error("Pending email not found");
  await ctx.db.patch(id, patch);
}

export async function markSentPortable(
  ctx: PortableMutationCtx,
  { id, sentChannel, notes, actingUserId }: {
    id: string;
    sentChannel?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  const existing = await ctx.db.get(id);
  if (!existing) throw new Error("Pending email not found");
  await ctx.db.patch(id, {
    status: "sent",
    sentAtISO: new Date().toISOString(),
    sentByUserId: actingUserId,
    sentChannel: sentChannel ?? existing.sentChannel ?? "personal_email",
    notes: notes ?? existing.notes,
  });
}

export async function cancelPortable(
  ctx: PortableMutationCtx,
  { id, reason }: { id: string; reason?: string; actingUserId?: string },
) {
  const existing = await ctx.db.get(id);
  if (!existing) throw new Error("Pending email not found");
  await ctx.db.patch(id, {
    status: "cancelled",
    notes: reason ?? existing.notes,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string; actingUserId?: string }) {
  await ctx.db.delete(id);
}
