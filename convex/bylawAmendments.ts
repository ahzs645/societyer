import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("bylawAmendments")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("bylawAmendments") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

const nowEvent = (actor: string, action: string, note?: string) => ({
  atISO: new Date().toISOString(),
  actor,
  action,
  note,
});

export const createDraft = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    baseText: v.string(),
    proposedText: v.string(),
    createdByName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return ctx.db.insert("bylawAmendments", {
      ...args,
      status: "Draft",
      createdAtISO: now,
      updatedAtISO: now,
      history: [nowEvent(args.createdByName ?? "You", "created", "Draft started")],
    });
  },
});

export const updateDraft = mutation({
  args: {
    id: v.id("bylawAmendments"),
    patch: v.object({
      title: v.optional(v.string()),
      proposedText: v.optional(v.string()),
      baseText: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, { id, patch, actor }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.status !== "Draft") {
      throw new Error("Only drafts can be edited — withdraw or supersede to change a non-draft amendment.");
    }
    const history = [...row.history, nowEvent(actor ?? "You", "edited")];
    await ctx.db.patch(id, {
      ...patch,
      updatedAtISO: new Date().toISOString(),
      history,
    });
  },
});

export const startConsultation = mutation({
  args: { id: v.id("bylawAmendments"), actor: v.optional(v.string()) },
  handler: async (ctx, { id, actor }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "Draft") return;
    const now = new Date().toISOString();
    await ctx.db.patch(id, {
      status: "Consultation",
      consultationStartedAtISO: now,
      updatedAtISO: now,
      history: [...row.history, nowEvent(actor ?? "You", "consultation_started", "Open for member consultation")],
    });
  },
});

export const markResolutionPassed = mutation({
  args: {
    id: v.id("bylawAmendments"),
    meetingId: v.optional(v.id("meetings")),
    votesFor: v.optional(v.number()),
    votesAgainst: v.optional(v.number()),
    abstentions: v.optional(v.number()),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, { id, meetingId, votesFor, votesAgainst, abstentions, actor }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    const now = new Date().toISOString();
    const note = votesFor != null
      ? `For ${votesFor} · Against ${votesAgainst ?? 0} · Abstain ${abstentions ?? 0}`
      : undefined;
    await ctx.db.patch(id, {
      status: "ResolutionPassed",
      resolutionMeetingId: meetingId,
      resolutionPassedAtISO: now,
      consultationEndedAtISO: row.consultationEndedAtISO ?? now,
      votesFor,
      votesAgainst,
      abstentions,
      updatedAtISO: now,
      history: [...row.history, nowEvent(actor ?? "You", "resolution_passed", note)],
    });
  },
});

export const markFiled = mutation({
  args: {
    id: v.id("bylawAmendments"),
    filingId: v.optional(v.id("filings")),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, { id, filingId, actor }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    const now = new Date().toISOString();
    await ctx.db.patch(id, {
      status: "Filed",
      filingId,
      filedAtISO: now,
      updatedAtISO: now,
      history: [...row.history, nowEvent(actor ?? "You", "filed", "Filed via Societies Online")],
    });
  },
});

export const withdraw = mutation({
  args: { id: v.id("bylawAmendments"), actor: v.optional(v.string()), reason: v.optional(v.string()) },
  handler: async (ctx, { id, actor, reason }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    const now = new Date().toISOString();
    await ctx.db.patch(id, {
      status: "Withdrawn",
      updatedAtISO: now,
      history: [...row.history, nowEvent(actor ?? "You", "withdrawn", reason)],
    });
  },
});

export const remove = mutation({
  args: { id: v.id("bylawAmendments") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
