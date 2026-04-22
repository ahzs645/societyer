import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const commitmentFields = {
  title: v.string(),
  category: v.string(),
  sourceDocumentId: v.optional(v.id("documents")),
  sourceLabel: v.optional(v.string()),
  counterparty: v.optional(v.string()),
  requirement: v.string(),
  cadence: v.string(),
  nextDueDate: v.optional(v.string()),
  noticeLeadDays: v.optional(v.number()),
  owner: v.optional(v.string()),
  status: v.string(),
  notes: v.optional(v.string()),
};

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("commitments")
      .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("commitments") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const eventsForSociety = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("commitmentEvents")
      .withIndex("by_society_happened", (q) => q.eq("societyId", societyId))
      .order("desc")
      .collect(),
});

export const eventsForCommitment = query({
  args: { commitmentId: v.id("commitments") },
  handler: async (ctx, { commitmentId }) =>
    ctx.db
      .query("commitmentEvents")
      .withIndex("by_commitment", (q) => q.eq("commitmentId", commitmentId))
      .collect(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    ...commitmentFields,
  },
  handler: async (ctx, args) => {
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
  },
});

export const update = mutation({
  args: {
    id: v.id("commitments"),
    patch: v.object({
      title: v.optional(v.string()),
      category: v.optional(v.string()),
      sourceDocumentId: v.optional(v.id("documents")),
      sourceLabel: v.optional(v.string()),
      counterparty: v.optional(v.string()),
      requirement: v.optional(v.string()),
      cadence: v.optional(v.string()),
      nextDueDate: v.optional(v.string()),
      noticeLeadDays: v.optional(v.number()),
      owner: v.optional(v.string()),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const commitment = await ctx.db.get(id);
    if (!commitment) throw new Error("Commitment not found.");
    await assertSocietyRefs(ctx, commitment.societyId, {
      sourceDocumentId: patch.sourceDocumentId,
    });
    await ctx.db.patch(id, {
      ...patch,
      updatedAtISO: new Date().toISOString(),
    });
  },
});

export const recordEvent = mutation({
  args: {
    commitmentId: v.id("commitments"),
    title: v.string(),
    happenedAtISO: v.string(),
    meetingId: v.optional(v.id("meetings")),
    evidenceDocumentIds: v.array(v.id("documents")),
    summary: v.optional(v.string()),
    nextDueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const commitment = await ctx.db.get(args.commitmentId);
    if (!commitment) throw new Error("Commitment not found.");
    await assertSocietyRefs(ctx, commitment.societyId, {
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
  },
});

export const removeEvent = mutation({
  args: { id: v.id("commitmentEvents") },
  handler: async (ctx, { id }) => {
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
  },
});

export const remove = mutation({
  args: { id: v.id("commitments") },
  handler: async (ctx, { id }) => {
    const events = await ctx.db
      .query("commitmentEvents")
      .withIndex("by_commitment", (q) => q.eq("commitmentId", id))
      .collect();
    await Promise.all(events.map((event) => ctx.db.delete(event._id)));
    await ctx.db.delete(id);
  },
});

async function assertSocietyRefs(
  ctx: any,
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
