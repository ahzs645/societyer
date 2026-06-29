/**
 * PORTABLE FUNCTIONS: the commitments domain
 * (list / get / eventsForSociety / eventsForCommitment / create / update /
 * recordEvent / removeEvent / remove).
 *
 * Reads/writes the `commitments`, `commitmentEvents`, and `activity` tables over
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle. `assertSocietyRefs` is a pure
 * (`ctx.db`-only) helper shared by the mutations.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("commitments")
    .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function eventsForSocietyPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("commitmentEvents")
    .withIndex("by_society_happened", (q) => q.eq("societyId", societyId))
    .order("desc")
    .collect();
}

export async function eventsForCommitmentPortable(ctx: PortableQueryCtx, { commitmentId }: { commitmentId: string }) {
  return ctx.db
    .query("commitmentEvents")
    .withIndex("by_commitment", (q) => q.eq("commitmentId", commitmentId))
    .collect();
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    category: string;
    sourceDocumentId?: string;
    sourceLabel?: string;
    sourceExcerpt?: string;
    counterparty?: string;
    requirement: string;
    cadence: string;
    nextDueDate?: string;
    dueDateBasis?: string;
    noticeLeadDays?: number;
    owner?: string;
    status: string;
    reviewStatus?: string;
    confidence?: number;
    uncertaintyNote?: string;
    notes?: string;
  },
) {
  await assertSocietyRefs(ctx, args.societyId, {
    sourceDocumentId: args.sourceDocumentId,
  });
  const nowISO = new Date().toISOString();
  const id = await ctx.db.insert("commitments", {
    ...args,
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: "You",
    entityType: "commitment",
    entityId: id,
    action: "created",
    summary: `Created commitment "${args.title}"`,
    createdAtISO: nowISO,
  });
  return id;
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      title?: string;
      category?: string;
      sourceDocumentId?: string;
      sourceLabel?: string;
      sourceExcerpt?: string;
      counterparty?: string;
      requirement?: string;
      cadence?: string;
      nextDueDate?: string;
      dueDateBasis?: string;
      noticeLeadDays?: number;
      owner?: string;
      status?: string;
      reviewStatus?: string;
      confidence?: number;
      uncertaintyNote?: string;
      notes?: string;
    };
  },
) {
  const commitment = await ctx.db.get(id);
  if (!commitment) throw new Error("Commitment not found.");
  await assertSocietyRefs(ctx, String(commitment.societyId), {
    sourceDocumentId: patch.sourceDocumentId,
  });
  await ctx.db.patch(id, {
    ...patch,
    updatedAtISO: new Date().toISOString(),
  });
}

export async function recordEventPortable(
  ctx: PortableMutationCtx,
  args: {
    commitmentId: string;
    title: string;
    happenedAtISO: string;
    meetingId?: string;
    evidenceDocumentIds: string[];
    evidenceStatus?: string;
    evidenceNotes?: string;
    summary?: string;
    nextDueDate?: string;
  },
) {
  const commitment = await ctx.db.get(args.commitmentId);
  if (!commitment) throw new Error("Commitment not found.");
  await assertSocietyRefs(ctx, String(commitment.societyId), {
    meetingId: args.meetingId,
    evidenceDocumentIds: args.evidenceDocumentIds,
  });

  const nowISO = new Date().toISOString();
  const id = await ctx.db.insert("commitmentEvents", {
    societyId: commitment.societyId,
    commitmentId: args.commitmentId,
    title: args.title,
    happenedAtISO: args.happenedAtISO,
    meetingId: args.meetingId,
    evidenceDocumentIds: args.evidenceDocumentIds,
    evidenceStatus: args.evidenceStatus,
    evidenceNotes: args.evidenceNotes,
    summary: args.summary,
    createdAtISO: nowISO,
  });

  const eventIsLatest =
    !commitment.lastCompletedAtISO ||
    args.happenedAtISO.localeCompare(commitment.lastCompletedAtISO) >= 0;
  const patch: Record<string, unknown> = {
    updatedAtISO: nowISO,
  };
  if (eventIsLatest) {
    patch.lastCompletedAtISO = args.happenedAtISO;
    patch.lastCompletionSummary = args.summary || args.title;
  }
  if (args.nextDueDate) {
    patch.nextDueDate = args.nextDueDate;
  }
  await ctx.db.patch(args.commitmentId, patch);

  await ctx.db.insert("activity", {
    societyId: commitment.societyId,
    actor: "You",
    entityType: "commitment",
    entityId: args.commitmentId,
    action: "completed",
    summary: `Recorded "${args.title}" for ${commitment.title}`,
    createdAtISO: nowISO,
  });
  return id;
}

export async function removeEventPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const event = await ctx.db.get(id);
  if (!event) return;
  await ctx.db.delete(id);
  const remaining = await ctx.db
    .query("commitmentEvents")
    .withIndex("by_commitment", (q) => q.eq("commitmentId", event.commitmentId))
    .collect();
  const latest = remaining.sort((a, b) => b.happenedAtISO.localeCompare(a.happenedAtISO))[0];
  await ctx.db.patch(event.commitmentId, {
    lastCompletedAtISO: latest?.happenedAtISO,
    lastCompletionSummary: latest ? latest.summary || latest.title : undefined,
    updatedAtISO: new Date().toISOString(),
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const events = await ctx.db
    .query("commitmentEvents")
    .withIndex("by_commitment", (q) => q.eq("commitmentId", id))
    .collect();
  await Promise.all(events.map((event) => ctx.db.delete(event._id)));
  await ctx.db.delete(id);
}

async function assertSocietyRefs(
  ctx: PortableMutationCtx,
  societyId: string,
  refs: {
    sourceDocumentId?: string;
    meetingId?: string;
    evidenceDocumentIds?: string[];
  },
) {
  if (refs.sourceDocumentId) {
    const document = await ctx.db.get(refs.sourceDocumentId);
    if (!document || String(document.societyId) !== String(societyId)) {
      throw new Error("Source document is not in this society.");
    }
  }
  if (refs.meetingId) {
    const meeting = await ctx.db.get(refs.meetingId);
    if (!meeting || String(meeting.societyId) !== String(societyId)) {
      throw new Error("Meeting is not in this society.");
    }
  }
  for (const documentId of refs.evidenceDocumentIds ?? []) {
    const document = await ctx.db.get(documentId);
    if (!document || String(document.societyId) !== String(societyId)) {
      throw new Error("Evidence document is not in this society.");
    }
  }
}
