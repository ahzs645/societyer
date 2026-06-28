import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("bylawAmendments")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("bylawAmendments") },
  returns: v.any(),
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
  returns: v.any(),
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
  returns: v.any(),
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
  returns: v.any(),
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
  returns: v.any(),
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
  returns: v.any(),
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
  returns: v.any(),
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

/** Mark an amendment Superseded — the status the UI already renders but that no
 *  mutation produced. Used when a fresh draft replaces a non-draft amendment
 *  (e.g. a revised version supersedes one in consultation), optionally linking
 *  the superseding amendment. Withdrawn amendments are terminal. */
export const supersede = mutation({
  args: {
    id: v.id("bylawAmendments"),
    supersededByAmendmentId: v.optional(v.id("bylawAmendments")),
    actor: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { id, supersededByAmendmentId, actor, reason }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.status === "Withdrawn") {
      throw new Error("Withdrawn amendments cannot be superseded.");
    }
    if (supersededByAmendmentId) {
      const replacement = await ctx.db.get(supersededByAmendmentId);
      if (!replacement || replacement.societyId !== row.societyId) {
        throw new Error("Superseding amendment must belong to the same society.");
      }
    }
    const now = new Date().toISOString();
    await ctx.db.patch(id, {
      status: "Superseded",
      supersededAtISO: now,
      supersededByAmendmentId,
      updatedAtISO: now,
      history: [...row.history, nowEvent(actor ?? "You", "superseded", reason)],
    });
  },
});

// Persist an amendment's proposed text as structured section records (replacing
// any prior set for that amendment). The client parses the text with
// shared/bylawSections so the section model is identical to the diff view.
export const materializeSections = mutation({
  args: {
    amendmentId: v.id("bylawAmendments"),
    sections: v.array(
      v.object({
        heading: v.string(),
        key: v.string(),
        level: v.number(),
        body: v.string(),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, { amendmentId, sections }) => {
    const amendment = await ctx.db.get(amendmentId);
    if (!amendment) throw new Error("Amendment not found.");
    const existing = await ctx.db
      .query("bylawSections")
      .withIndex("by_amendment", (q) => q.eq("amendmentId", amendmentId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const now = new Date().toISOString();
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      await ctx.db.insert("bylawSections", {
        societyId: amendment.societyId,
        amendmentId,
        order: i,
        heading: s.heading,
        key: s.key,
        level: s.level,
        body: s.body,
        createdAtISO: now,
        updatedAtISO: now,
      });
    }
    return { stored: sections.length };
  },
});

export const sectionsForAmendment = query({
  args: { amendmentId: v.id("bylawAmendments") },
  returns: v.any(),
  handler: async (ctx, { amendmentId }) => {
    const rows = await ctx.db
      .query("bylawSections")
      .withIndex("by_amendment", (q) => q.eq("amendmentId", amendmentId))
      .collect();
    return rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },
});

export const remove = mutation({
  args: { id: v.id("bylawAmendments") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    // Clean up materialized section records when the amendment is deleted.
    const sections = await ctx.db
      .query("bylawSections")
      .withIndex("by_amendment", (q) => q.eq("amendmentId", id))
      .collect();
    for (const row of sections) await ctx.db.delete(row._id);
    await ctx.db.delete(id);
  },
});
