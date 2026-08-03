/**
 * PORTABLE FUNCTIONS: the pending-emails domain
 * (list / get / create / update / markSent / cancel / remove).
 *
 * Reads/writes the `pendingEmails` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. markSent/cancel are pure status patches (no network/scheduler).
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireSocietyMembership } from "./access";

export async function listPortable(
  ctx: PortableQueryCtx,
  { societyId, status }: { societyId: string; status?: string },
) {
  await requireSocietyMembership(ctx, societyId);
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
  const row = await ctx.db.get(id, "pendingEmails");
  if (!row) return null;
  await requireSocietyMembership(ctx, String(row.societyId));
  return getOwned(ctx, "pendingEmails", id, String(row.societyId));
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
  await requireSocietyMembership(ctx, args.societyId);
  if (args.workflowId) await getOwned(ctx, "workflows", args.workflowId, args.societyId);
  if (args.workflowRunId) {
    await getOwned(ctx, "workflowRuns", args.workflowRunId, args.societyId);
  }
  for (const attachment of args.attachments ?? []) {
    await getOwned(ctx, "documents", attachment.documentId, args.societyId);
  }
  const createdByUserId = await principalUserId(ctx, args.societyId);
  if (args.actingUserId && args.actingUserId !== createdByUserId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
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
    createdByUserId,
    notes: args.notes,
  });
  return id;
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch, actingUserId }: {
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
  const existing = await ctx.db.get(id, "pendingEmails");
  if (!existing) throw new Error("pendingEmails not found.");
  await requireSocietyMembership(ctx, String(existing.societyId));
  await getOwned(ctx, "pendingEmails", id, String(existing.societyId));
  const principalId = await principalUserId(ctx, String(existing.societyId));
  if (actingUserId && actingUserId !== principalId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  for (const attachment of patch.attachments ?? []) {
    await getOwned(ctx, "documents", attachment.documentId, String(existing.societyId));
  }
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
  const existing = await ctx.db.get(id, "pendingEmails");
  if (!existing) throw new Error("pendingEmails not found.");
  await requireSocietyMembership(ctx, String(existing.societyId));
  await getOwned(ctx, "pendingEmails", id, String(existing.societyId));
  const sentByUserId = await principalUserId(ctx, String(existing.societyId));
  if (actingUserId && actingUserId !== sentByUserId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  await ctx.db.patch(id, {
    status: "sent",
    sentAtISO: new Date().toISOString(),
    sentByUserId,
    sentChannel: sentChannel ?? existing.sentChannel ?? "personal_email",
    notes: notes ?? existing.notes,
  });
}

export async function cancelPortable(
  ctx: PortableMutationCtx,
  { id, reason, actingUserId }: { id: string; reason?: string; actingUserId?: string },
) {
  const existing = await ctx.db.get(id, "pendingEmails");
  if (!existing) throw new Error("pendingEmails not found.");
  await requireSocietyMembership(ctx, String(existing.societyId));
  await getOwned(ctx, "pendingEmails", id, String(existing.societyId));
  const principalId = await principalUserId(ctx, String(existing.societyId));
  if (actingUserId && actingUserId !== principalId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  await ctx.db.patch(id, {
    status: "cancelled",
    notes: reason ?? existing.notes,
  });
}

export async function removePortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const existing = await ctx.db.get(id, "pendingEmails");
  if (!existing) return;
  await requireSocietyMembership(ctx, String(existing.societyId));
  await getOwned(ctx, "pendingEmails", id, String(existing.societyId));
  const principalId = await principalUserId(ctx, String(existing.societyId));
  if (actingUserId && actingUserId !== principalId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  await ctx.db.delete(id);
}
