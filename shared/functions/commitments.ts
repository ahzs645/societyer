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
import { getOwned, requireSocietyMembership } from "./access";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("commitments")
    .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "commitments");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("commitments not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  return getOwned(ctx, "commitments", id, candidate.societyId);
}

export async function eventsForSocietyPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("commitmentEvents")
    .withIndex("by_society_happened", (q) => q.eq("societyId", societyId))
    .order("desc")
    .collect();
}

export async function eventsForCommitmentPortable(ctx: PortableQueryCtx, { commitmentId }: { commitmentId: string }) {
  const candidate = await ctx.db.get(commitmentId, "commitments");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("commitments not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "commitments", commitmentId, candidate.societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  assertCommitmentValues(args, true);
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
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
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
  const candidate = await ctx.db.get(id, "commitments");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("commitments not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const commitment = await getOwned(ctx, "commitments", id, candidate.societyId);
  assertCommitmentValues({ ...commitment, ...patch }, false);
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
  const candidate = await ctx.db.get(args.commitmentId, "commitments");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("commitments not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const commitment = await getOwned(ctx, "commitments", args.commitmentId, candidate.societyId);
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
    subjectId: args.commitmentId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: args.commitmentId,
    action: "completed",
    summary: `Recorded "${args.title}" for ${commitment.title}`,
    createdAtISO: nowISO,
  });
  return id;
}

export async function removeEventPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "commitmentEvents");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("commitmentEvents not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const event = await getOwned(ctx, "commitmentEvents", id, candidate.societyId);
  await getOwned(ctx, "commitments", String(event.commitmentId), candidate.societyId);
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
  const candidate = await ctx.db.get(id, "commitments");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("commitments not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "commitments", id, candidate.societyId);
  const events = await ctx.db
    .query("commitmentEvents")
    .withIndex("by_commitment", (q) => q.eq("commitmentId", id))
    .collect();
  for (const event of events) {
    await getOwned(ctx, "commitmentEvents", event._id, candidate.societyId);
  }
  await Promise.all(events.map((event) => ctx.db.delete(event._id)));
  // Open preparation tasks exist only for this commitment; completed tasks are
  // kept as history (G-18: deleting left orphaned "Prepare ..." tasks).
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_society", (q) => q.eq("societyId", candidate.societyId))
    .collect();
  for (const task of tasks) {
    const linked = String(task.commitmentId ?? "") === String(id) || String(task.eventId ?? "") === `commitment:${id}`;
    if (linked && task.status !== "Done") await ctx.db.delete(task._id);
  }
  await ctx.db.delete(id);
}

/** Commitment field rules (G-18): a title, confidence as a 0-1 fraction and a
 *  whole, non-negative notice lead time. */
export function commitmentProblems(values: { title?: string; confidence?: number | null; noticeLeadDays?: number | null }, requireTitle: boolean): string[] {
  const problems: string[] = [];
  if ((requireTitle || values.title !== undefined) && !String(values.title ?? "").trim()) problems.push("Enter a title for the commitment.");
  if (values.confidence != null && (typeof values.confidence !== "number" || !Number.isFinite(values.confidence) || values.confidence < 0 || values.confidence > 1)) {
    problems.push("Confidence must be between 0% and 100%.");
  }
  if (values.noticeLeadDays != null && (!Number.isInteger(values.noticeLeadDays) || values.noticeLeadDays < 0 || values.noticeLeadDays > 3650)) {
    problems.push("Lead time must be a whole number of days, 0 or more.");
  }
  return problems;
}

function assertCommitmentValues(values: any, requireTitle: boolean) {
  const problems = commitmentProblems(values, requireTitle);
  if (problems.length) throw new Error(`Commitment not saved: ${problems.join(" ")}`);
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
    await getOwned(ctx, "documents", refs.sourceDocumentId, societyId);
  }
  if (refs.meetingId) {
    await getOwned(ctx, "meetings", refs.meetingId, societyId);
  }
  for (const documentId of refs.evidenceDocumentIds ?? []) {
    await getOwned(ctx, "documents", documentId, societyId);
  }
}
