import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const PIPA_SETUP_MOTIONS = [
  {
    seededKey: "pipa-designate-privacy-officer",
    title: "Designate privacy officer",
    motionText:
      "BE IT RESOLVED THAT the Society designate [role or name] as privacy officer for purposes of privacy questions, access requests, correction requests, complaints, and privacy-program upkeep, and that the privacy officer maintain a monitored privacy contact address.",
    category: "privacy",
    priority: "high",
    notes: "Use once the role/name and monitored email address are known.",
  },
  {
    seededKey: "pipa-adopt-privacy-policy",
    title: "Adopt PIPA privacy policy and complaint process",
    motionText:
      "BE IT RESOLVED THAT the Society adopt the PIPA privacy policy, privacy practices, access and correction process, complaint process, safeguards, and retention approach presented to the meeting, effective [date], and authorize the privacy officer to maintain the working copy and evidence record.",
    category: "privacy",
    priority: "high",
    notes: "Use after the draft policy has been reviewed and is ready for approval.",
  },
  {
    seededKey: "pipa-member-data-gap-memo",
    title: "Approve member-data access gap memo",
    motionText:
      "BE IT RESOLVED THAT the Society approve the member-data access gap memo presented to the meeting, recording which member or eligibility records are controlled by the Society, which records are held by the university or other institution, and how privacy and records requests will be handled.",
    category: "privacy",
    priority: "normal",
    notes: "Useful where the university or parent body does not share the full member list.",
  },
  {
    seededKey: "pipa-training-review-cycle",
    title: "Set annual privacy and CASL training review",
    motionText:
      "BE IT RESOLVED THAT the Society establish an annual privacy and CASL training review for directors, officers, staff, and volunteers with access to personal information or electronic communications systems, and that completion evidence be kept with the Society's privacy records.",
    category: "privacy",
    priority: "normal",
    notes: "Use if the society wants the training cadence approved as part of setup.",
  },
];

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("motionBacklog")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows.sort(compareBacklogItems);
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    motionText: v.string(),
    category: v.optional(v.string()),
    priority: v.optional(v.string()),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("motionBacklog", {
      societyId: args.societyId,
      title: args.title,
      motionText: args.motionText,
      category: args.category ?? "governance",
      status: "Backlog",
      priority: args.priority ?? "normal",
      source: args.source ?? "manual",
      notes: args.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const update = mutation({
  args: {
    backlogId: v.id("motionBacklog"),
    title: v.optional(v.string()),
    motionText: v.optional(v.string()),
    category: v.optional(v.string()),
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { backlogId, ...patch }) => {
    const clean: Record<string, unknown> = { updatedAtISO: new Date().toISOString() };
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) clean[key] = value;
    await ctx.db.patch(backlogId, clean);
    return backlogId;
  },
});

export const remove = mutation({
  args: { backlogId: v.id("motionBacklog") },
  returns: v.any(),
  handler: async (ctx, { backlogId }) => {
    await ctx.db.delete(backlogId);
  },
});

export const createFromMinutesMotion = mutation({
  args: {
    minutesId: v.id("minutes"),
    motionIndex: v.number(),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    priority: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const minutes = await ctx.db.get(args.minutesId);
    if (!minutes) throw new Error("Minutes not found.");
    const motion = Array.isArray(minutes.motions) ? minutes.motions[args.motionIndex] : undefined;
    if (!motion?.text) throw new Error("Motion not found.");

    const existing = await ctx.db
      .query("motionBacklog")
      .withIndex("by_society", (q) => q.eq("societyId", minutes.societyId))
      .collect();
    const duplicate = existing.find((item) =>
      String(item.sourceMinutesId ?? "") === String(args.minutesId) &&
      item.sourceMotionIndex === args.motionIndex
    );
    if (duplicate) return { backlogId: duplicate._id, reused: true };

    const meeting = await ctx.db.get(minutes.meetingId);
    const now = new Date().toISOString();
    const backlogId = await ctx.db.insert("motionBacklog", {
      societyId: minutes.societyId,
      title: args.title?.trim() || summarizeMotionTitle(motion.text),
      motionText: motion.text,
      category: args.category ?? "governance",
      status: "Deferred",
      priority: args.priority ?? "normal",
      source: "minutes-motion",
      notes: [
        meeting ? `Carried forward from ${meeting.title}.` : "Carried forward from meeting minutes.",
        motion.outcome ? `Recorded outcome: ${motion.outcome}.` : "",
        args.notes,
      ].filter(Boolean).join(" "),
      minutesId: args.minutesId,
      sourceMinutesId: args.minutesId,
      sourceMotionIndex: args.motionIndex,
      createdAtISO: now,
      updatedAtISO: now,
    });
    return { backlogId, reused: false };
  },
});

export const createFromMinutesSection = mutation({
  args: {
    minutesId: v.id("minutes"),
    sectionIndex: v.number(),
    title: v.optional(v.string()),
    motionText: v.optional(v.string()),
    category: v.optional(v.string()),
    priority: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const minutes = await ctx.db.get(args.minutesId);
    if (!minutes) throw new Error("Minutes not found.");
    const section = Array.isArray(minutes.sections) ? minutes.sections[args.sectionIndex] : undefined;
    if (!section?.title) throw new Error("Minutes section not found.");

    const existing = await ctx.db
      .query("motionBacklog")
      .withIndex("by_society", (q) => q.eq("societyId", minutes.societyId))
      .collect();
    const duplicate = existing.find((item) =>
      String(item.sourceMinutesId ?? "") === String(args.minutesId) &&
      item.sourceSectionIndex === args.sectionIndex
    );
    if (duplicate) return { backlogId: duplicate._id, reused: true };

    const meeting = await ctx.db.get(minutes.meetingId);
    const now = new Date().toISOString();
    const sectionNotes = [
      section.discussion,
      ...(section.decisions ?? []).map((decision: string) => `Decision: ${decision}`),
      ...(section.actionItems ?? []).map((item: any) => `Action: ${item.assignee ? `${item.assignee}: ` : ""}${item.text}`),
    ].filter(Boolean).join(" ");
    const title = args.title?.trim() || section.title;
    const backlogId = await ctx.db.insert("motionBacklog", {
      societyId: minutes.societyId,
      title,
      motionText: args.motionText?.trim() || `Discuss and decide next steps for ${title}.`,
      category: args.category ?? "governance",
      status: "Deferred",
      priority: args.priority ?? "normal",
      source: "minutes-section",
      notes: [
        meeting ? `Carried forward from ${meeting.title}.` : "Carried forward from meeting minutes.",
        sectionNotes,
        args.notes,
      ].filter(Boolean).join(" "),
      minutesId: args.minutesId,
      sourceMinutesId: args.minutesId,
      sourceSectionIndex: args.sectionIndex,
      createdAtISO: now,
      updatedAtISO: now,
    });
    return { backlogId, reused: false };
  },
});

export const seedPipaSetup = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const existing = await ctx.db
      .query("motionBacklog")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const existingKeys = new Set(existing.map((row) => row.seededKey).filter(Boolean));
    const now = new Date().toISOString();
    let inserted = 0;
    for (const motion of PIPA_SETUP_MOTIONS) {
      if (existingKeys.has(motion.seededKey)) continue;
      await ctx.db.insert("motionBacklog", {
        societyId,
        title: motion.title,
        motionText: motion.motionText,
        category: motion.category,
        status: "Backlog",
        priority: motion.priority,
        source: "pipa-setup",
        seededKey: motion.seededKey,
        notes: motion.notes,
        createdAtISO: now,
        updatedAtISO: now,
      });
      inserted++;
    }
    return { inserted, existing: PIPA_SETUP_MOTIONS.length - inserted };
  },
});

export const addToAgenda = mutation({
  args: {
    backlogId: v.id("motionBacklog"),
    agendaId: v.id("agendas"),
  },
  returns: v.any(),
  handler: async (ctx, { backlogId, agendaId }) => {
    const [backlogItem, agenda] = await Promise.all([
      ctx.db.get(backlogId),
      ctx.db.get(agendaId),
    ]);
    if (!backlogItem) throw new Error("Backlog motion not found.");
    if (!agenda) throw new Error("Agenda not found.");
    if (backlogItem.societyId !== agenda.societyId) {
      throw new Error("Backlog motion and agenda must belong to the same society.");
    }

    const existingItems = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
      .collect();
    const duplicate = existingItems.find((item) => String(item.motionBacklogId ?? "") === String(backlogId));
    if (duplicate) {
      await ctx.db.patch(backlogId, {
        status: "Agenda",
        targetMeetingId: agenda.meetingId,
        agendaId,
        agendaItemId: duplicate._id,
        updatedAtISO: new Date().toISOString(),
      });
      return { agendaItemId: duplicate._id, reused: true };
    }

    const now = new Date().toISOString();
    const agendaItemId = await ctx.db.insert("agendaItems", {
      societyId: agenda.societyId,
      agendaId,
      order: existingItems.length,
      type: "motion",
      title: backlogItem.title,
      details: backlogItem.notes,
      motionBacklogId: backlogId,
      motionText: backlogItem.motionText,
      createdAtISO: now,
    });
    await ctx.db.patch(backlogId, {
      status: "Agenda",
      targetMeetingId: agenda.meetingId,
      agendaId,
      agendaItemId,
      updatedAtISO: now,
    });
    return { agendaItemId, reused: false };
  },
});

export const seedToMinutes = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, { meetingId }) => {
    const minutesRows = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const minutes = minutesRows[0];
    if (!minutes) {
      throw new Error("Create or generate minutes for this meeting before seeding backlog motions into minutes.");
    }

    const agendas = await ctx.db
      .query("agendas")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    const agendaItemsByAgenda = await Promise.all(
      agendas.map((agenda) =>
        ctx.db.query("agendaItems").withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id)).collect(),
      ),
    );
    const agendaItems = agendaItemsByAgenda
      .flat()
      .filter((item) => item.type === "motion" && item.motionBacklogId && item.motionText);

    const existingMotions = Array.isArray(minutes.motions) ? minutes.motions : [];
    const existingTexts = new Set(existingMotions.map((motion: any) => comparableMotionText(motion.text)));
    const motionsToAdd = agendaItems
      .filter((item) => !existingTexts.has(comparableMotionText(item.motionText)))
      .map((item) => ({
        text: item.motionText!,
        outcome: "Pending",
      }));

    if (motionsToAdd.length > 0) {
      await ctx.db.patch(minutes._id, {
        motions: [...existingMotions, ...motionsToAdd],
      });
    }

    const now = new Date().toISOString();
    for (const item of agendaItems) {
      await ctx.db.patch(item.motionBacklogId!, {
        status: "MinutesDraft",
        minutesId: minutes._id,
        updatedAtISO: now,
      });
    }

    return { inserted: motionsToAdd.length, considered: agendaItems.length, minutesId: minutes._id };
  },
});

function compareBacklogItems(a: any, b: any) {
  return (
    statusRank(a.status) - statusRank(b.status) ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    String(a.updatedAtISO ?? "").localeCompare(String(b.updatedAtISO ?? "")) * -1 ||
    String(a.title ?? "").localeCompare(String(b.title ?? ""))
  );
}

function statusRank(status: string | undefined) {
  const index = ["Backlog", "Agenda", "MinutesDraft", "Deferred", "Adopted", "Archived"].indexOf(status ?? "Backlog");
  return index === -1 ? 99 : index;
}

function priorityRank(priority: string | undefined) {
  return priority === "high" ? 0 : priority === "normal" || !priority ? 1 : 2;
}

function comparableMotionText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(be it resolved that|resolved that|motion to|motion)\b[:\s-]*/gi, "")
    .trim();
}

function summarizeMotionTitle(value: unknown) {
  const text = comparableMotionText(value)
    .replace(/^(approve|adopt|authorize|accept|confirm)\s+/i, "")
    .trim();
  if (!text) return "Deferred motion";
  return text.length > 72 ? `${text.slice(0, 69).trim()}...` : text.charAt(0).toUpperCase() + text.slice(1);
}
