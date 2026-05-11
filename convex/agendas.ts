import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listForMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, { meetingId }) => {
    const agendas = await ctx.db
      .query("agendas")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    return agendas;
  },
});

export const getForMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, { meetingId }) => {
    const agendas = await ctx.db
      .query("agendas")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    agendas.sort((a, b) => a.createdAtISO.localeCompare(b.createdAtISO));
    const agenda = agendas[0] ?? null;
    if (!agenda) return null;
    const items = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id))
      .collect();
    items.sort((a, b) => a.order - b.order);
    return { agenda, items };
  },
});

export const get = query({
  args: { agendaId: v.id("agendas") },
  returns: v.any(),
  handler: async (ctx, { agendaId }) => {
    const agenda = await ctx.db.get(agendaId);
    if (!agenda) return null;
    const items = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
      .collect();
    items.sort((a, b) => a.order - b.order);
    return { agenda, items };
  },
});

export const listForSociety = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    return await ctx.db
      .query("agendas")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    title: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return await ctx.db.insert("agendas", {
      ...args,
      status: "Draft",
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const updateAgenda = mutation({
  args: {
    agendaId: v.id("agendas"),
    title: v.optional(v.string()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { agendaId, ...patch }) => {
    const updatedAtISO = new Date().toISOString();
    const clean: Record<string, unknown> = { updatedAtISO };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
    await ctx.db.patch(agendaId, clean);
    return agendaId;
  },
});

export const remove = mutation({
  args: { agendaId: v.id("agendas") },
  returns: v.any(),
  handler: async (ctx, { agendaId }) => {
    const items = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
      .collect();
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.delete(agendaId);
    return agendaId;
  },
});

export const addItem = mutation({
  args: {
    agendaId: v.id("agendas"),
    type: v.string(),
    title: v.string(),
    details: v.optional(v.string()),
    presenter: v.optional(v.string()),
    depth: v.optional(v.union(v.literal(0), v.literal(1))),
    timeAllottedMinutes: v.optional(v.number()),
    motionTemplateId: v.optional(v.id("motionTemplates")),
    motionBacklogId: v.optional(v.id("motionBacklog")),
    motionText: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const agenda = await ctx.db.get(args.agendaId);
    if (!agenda) throw new Error("Agenda not found");
    const existing = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", args.agendaId))
      .collect();
    const order = existing.length;
    const now = new Date().toISOString();

    let motionText = args.motionText;
    if (args.motionTemplateId && !motionText) {
      const template = await ctx.db.get(args.motionTemplateId);
      if (template) {
        motionText = template.body;
        await ctx.db.patch(template._id, {
          usageCount: (template.usageCount ?? 0) + 1,
          updatedAtISO: now,
        });
      }
    }

    return await ctx.db.insert("agendaItems", {
      societyId: agenda.societyId,
      agendaId: args.agendaId,
      order,
      type: args.type,
      title: args.title,
      details: args.details,
      presenter: args.presenter,
      depth: args.depth,
      timeAllottedMinutes: args.timeAllottedMinutes,
      motionTemplateId: args.motionTemplateId,
      motionBacklogId: args.motionBacklogId,
      motionText,
      createdAtISO: now,
    });
  },
});

export const updateItem = mutation({
  args: {
    itemId: v.id("agendaItems"),
    title: v.optional(v.string()),
    details: v.optional(v.string()),
    presenter: v.optional(v.string()),
    depth: v.optional(v.union(v.literal(0), v.literal(1))),
    timeAllottedMinutes: v.optional(v.number()),
    motionText: v.optional(v.string()),
    outcome: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { itemId, ...patch }) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
    await ctx.db.patch(itemId, clean);
    return itemId;
  },
});

export const syncForMeeting = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    title: v.optional(v.string()),
    status: v.optional(v.string()),
    items: v.array(v.object({
      title: v.string(),
      depth: v.optional(v.union(v.literal(0), v.literal(1))),
      type: v.optional(v.string()),
      details: v.optional(v.string()),
      presenter: v.optional(v.string()),
      timeAllottedMinutes: v.optional(v.number()),
      motionTemplateId: v.optional(v.id("motionTemplates")),
      motionBacklogId: v.optional(v.id("motionBacklog")),
      motionText: v.optional(v.string()),
    })),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");
    if (meeting.societyId !== args.societyId) throw new Error("Meeting belongs to a different society");

    const now = new Date().toISOString();
    const existingAgendas = await ctx.db
      .query("agendas")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
    existingAgendas.sort((a, b) => a.createdAtISO.localeCompare(b.createdAtISO));

    const agendaId = existingAgendas[0]?._id ?? await ctx.db.insert("agendas", {
      societyId: args.societyId,
      meetingId: args.meetingId,
      title: args.title || `${meeting.title} agenda`,
      status: "Draft",
      createdAtISO: now,
      updatedAtISO: now,
    });

    await ctx.db.patch(agendaId, {
      title: args.title || existingAgendas[0]?.title || `${meeting.title} agenda`,
      status: args.status || existingAgendas[0]?.status || "Draft",
      updatedAtISO: now,
    });

    const existingItems = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
      .collect();
    existingItems.sort((a, b) => a.order - b.order);

    const unusedExisting = new Set(existingItems.map((item) => String(item._id)));
    const byTitle = new Map<string, any[]>();
    for (const item of existingItems) {
      const key = normalizeTitle(item.title);
      if (!key) continue;
      const rows = byTitle.get(key) ?? [];
      rows.push(item);
      byTitle.set(key, rows);
    }

    const usedIds = new Set<string>();
    for (let order = 0; order < args.items.length; order++) {
      const item = args.items[order];
      const title = item.title.trim();
      if (!title) continue;
      const key = normalizeTitle(title);
      const match = (byTitle.get(key) ?? []).find((candidate) => !usedIds.has(String(candidate._id)));
      let motionText = item.motionText;
      if (item.motionTemplateId && !motionText) {
        const template = await ctx.db.get(item.motionTemplateId);
        motionText = template?.body;
      }

      const payload: Record<string, unknown> = {
        societyId: args.societyId,
        agendaId,
        order,
        type: item.type || inferAgendaItemType(title),
        title,
        depth: item.depth === 1 ? 1 : 0,
        createdAtISO: now,
      };
      if (item.details !== undefined) payload.details = item.details;
      if (item.presenter !== undefined) payload.presenter = item.presenter;
      if (item.timeAllottedMinutes !== undefined) payload.timeAllottedMinutes = item.timeAllottedMinutes;
      if (item.motionTemplateId !== undefined) payload.motionTemplateId = item.motionTemplateId;
      if (item.motionBacklogId !== undefined) payload.motionBacklogId = item.motionBacklogId;
      if (motionText !== undefined) payload.motionText = motionText;

      if (match) {
        usedIds.add(String(match._id));
        unusedExisting.delete(String(match._id));
        const { createdAtISO: _createdAtISO, ...patch } = payload;
        await ctx.db.patch(match._id, patch);
      } else {
        const id = await ctx.db.insert("agendaItems", payload as any);
        usedIds.add(String(id));
      }
    }

    for (const itemId of unusedExisting) {
      await ctx.db.delete(itemId as any);
    }

    const savedItems = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
      .collect();
    savedItems.sort((a, b) => a.order - b.order);
    await syncMeetingAndMinutesFromAgenda(ctx, meeting, savedItems, now);

    return agendaId;
  },
});

export const backfillFromMeetingAgendaJson = mutation({
  args: {
    societyId: v.optional(v.id("societies")),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const meetings = args.societyId
      ? await ctx.db
          .query("meetings")
          .withIndex("by_society", (q) => q.eq("societyId", args.societyId!))
          .collect()
      : await ctx.db.query("meetings").collect();
    const now = new Date().toISOString();
    let createdAgendas = 0;
    let createdItems = 0;
    let skippedExisting = 0;
    let skippedEmpty = 0;

    for (const meeting of meetings) {
      const existing = await ctx.db
        .query("agendas")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .collect();
      if (existing.length > 0) {
        skippedExisting += 1;
        continue;
      }
      const items = normalizeAgendaJsonItems(meeting.agendaJson);
      if (items.length === 0) {
        skippedEmpty += 1;
        continue;
      }
      if (args.dryRun) {
        createdAgendas += 1;
        createdItems += items.length;
        continue;
      }
      const agendaId = await ctx.db.insert("agendas", {
        societyId: meeting.societyId,
        meetingId: meeting._id,
        title: `${meeting.title} agenda`,
        status: "Draft",
        createdAtISO: now,
        updatedAtISO: now,
      });
      createdAgendas += 1;
      for (let order = 0; order < items.length; order += 1) {
        const item = items[order];
        await ctx.db.insert("agendaItems", {
          societyId: meeting.societyId,
          agendaId,
          order,
          type: item.type || inferAgendaItemType(item.title),
          title: item.title,
          depth: item.depth,
          details: item.details,
          presenter: item.presenter,
          motionText: item.motionText,
          createdAtISO: now,
        });
        createdItems += 1;
      }
    }

    return { createdAgendas, createdItems, skippedExisting, skippedEmpty, dryRun: !!args.dryRun };
  },
});

export const startMinutesFromAgenda = mutation({
  args: { agendaId: v.id("agendas") },
  returns: v.any(),
  handler: async (ctx, { agendaId }) => {
    const agenda = await ctx.db.get(agendaId);
    if (!agenda) throw new Error("Agenda not found");
    const meeting = await ctx.db.get(agenda.meetingId);
    if (!meeting) throw new Error("Meeting not found");
    const items = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
      .collect();
    items.sort((a, b) => a.order - b.order);
    if (items.length === 0) throw new Error("Add agenda items before starting minutes.");

    const existing = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
      .collect();
    if (existing[0]) {
      await syncMeetingAndMinutesFromAgenda(ctx, meeting, items, new Date().toISOString());
      return { minutesId: existing[0]._id, reused: true };
    }

    const attendees = Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds.map(String) : [];
    const minutesPayload: Record<string, unknown> = {
      societyId: meeting.societyId,
      meetingId: meeting._id,
      heldAt: meeting.scheduledAt,
      attendees,
      absent: [],
      quorumMet: meeting.quorumRequired == null ? false : attendees.length >= meeting.quorumRequired,
      discussion: "",
      sections: items.map(sectionFromAgendaItem),
      motions: motionsFromAgendaItems(items),
      decisions: [],
      actionItems: [],
    };
    if (meeting.quorumRequired !== undefined) minutesPayload.quorumRequired = meeting.quorumRequired;
    if (meeting.bylawRuleSetId !== undefined) minutesPayload.bylawRuleSetId = meeting.bylawRuleSetId;
    if (meeting.quorumRuleVersion !== undefined) minutesPayload.quorumRuleVersion = meeting.quorumRuleVersion;
    if (meeting.quorumRuleEffectiveFromISO !== undefined) minutesPayload.quorumRuleEffectiveFromISO = meeting.quorumRuleEffectiveFromISO;
    if (meeting.quorumSourceLabel !== undefined) minutesPayload.quorumSourceLabel = meeting.quorumSourceLabel;
    if (meeting.quorumComputedAtISO !== undefined) minutesPayload.quorumComputedAtISO = meeting.quorumComputedAtISO;

    const id = await ctx.db.insert("minutes", minutesPayload as any);
    await ctx.db.patch(meeting._id, {
      minutesId: id,
      agendaJson: JSON.stringify(items.map((item) => ({ title: item.title, depth: item.depth === 1 ? 1 : 0 }))),
    });
    return { minutesId: id, reused: false };
  },
});

function normalizeTitle(value: string) {
  return value.trim().toLowerCase();
}

function inferAgendaItemType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("motion") || lower.includes("adopt") || lower.includes("approve")) return "motion";
  if (lower.includes("report") || lower.includes("financial")) return "report";
  if (lower.includes("break")) return "break";
  if (lower.includes("camera") || lower.includes("closed") || lower.includes("executive")) return "executive_session";
  return "discussion";
}

function normalizeAgendaJsonItems(agendaJson?: string) {
  if (!agendaJson) return [];
  try {
    const parsed = JSON.parse(agendaJson);
    if (!Array.isArray(parsed)) return [];
    const items: Array<{ title: string; depth: 0 | 1; type?: string; details?: string; presenter?: string; motionText?: string }> = [];
    let hasRoot = false;
    for (const value of parsed) {
      const title = typeof value === "string" ? value.trim() : String(value?.title ?? "").trim();
      if (!title) continue;
      const depth: 0 | 1 = typeof value === "object" && value?.depth === 1 && hasRoot ? 1 : 0;
      items.push({
        title,
        depth,
        type: typeof value === "object" ? value?.type ?? value?.sectionType : undefined,
        details: typeof value === "object" ? value?.details : undefined,
        presenter: typeof value === "object" ? value?.presenter : undefined,
        motionText: typeof value === "object" ? value?.motionText : undefined,
      });
      if (depth === 0) hasRoot = true;
    }
    return items;
  } catch {
    return [];
  }
}

function sectionFromAgendaItem(item: any) {
  const depth: 0 | 1 = item.depth === 1 ? 1 : 0;
  const section: Record<string, unknown> = {
    title: item.title,
    type: item.type || inferAgendaItemType(item.title),
    discussion: item.details ?? "",
    decisions: [],
    actionItems: [],
    depth,
  };
  if (item.presenter !== undefined) section.presenter = item.presenter;
  if (item.motionText !== undefined) section.motionText = item.motionText;
  if (item.motionTemplateId !== undefined) section.motionTemplateId = item.motionTemplateId;
  if (item.motionBacklogId !== undefined) section.motionBacklogId = item.motionBacklogId;
  return section;
}

function motionsFromAgendaItems(items: any[]) {
  return items
    .map((item, index) => {
      const motion: Record<string, unknown> = {
        text: String(item.motionText ?? "").trim(),
        outcome: "Pending",
        resolutionType: "Ordinary",
        sectionIndex: index,
        sectionTitle: item.title,
      };
      if (item.motionTemplateId !== undefined) motion.motionTemplateId = item.motionTemplateId;
      if (item.motionBacklogId !== undefined) motion.motionBacklogId = item.motionBacklogId;
      return motion;
    })
    .filter((motion) => motion.text);
}

async function syncMeetingAndMinutesFromAgenda(ctx: any, meeting: any, items: any[], now: string) {
  const agendaEntries = items.map((item) => ({ title: item.title, depth: item.depth === 1 ? 1 : 0 }));
  await ctx.db.patch(meeting._id, { agendaJson: JSON.stringify(agendaEntries) });

  const rows = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q: any) => q.eq("meetingId", meeting._id))
    .collect();
  const minutes = rows[0];
  if (!minutes) return;

  const existingSections = Array.isArray(minutes.sections) ? minutes.sections : [];
  const byTitle = new Map<string, any>();
  for (const section of existingSections) {
    const key = normalizeTitle(section?.title ?? "");
    if (key && !byTitle.has(key)) byTitle.set(key, section);
  }
  const nextSections = items.map((item) => {
    const existing = byTitle.get(normalizeTitle(item.title));
    const base = sectionFromAgendaItem(item);
    if (!existing) return base;
    const merged: Record<string, unknown> = {
      title: item.title,
      type: item.type || existing.type || base.type,
      discussion: existing.discussion || item.details || "",
      depth: item.depth === 1 ? 1 : 0,
    };
    if (existing.reportSubmitted !== undefined) merged.reportSubmitted = existing.reportSubmitted;
    if (Array.isArray(existing.decisions)) merged.decisions = existing.decisions;
    else merged.decisions = [];
    if (Array.isArray(existing.actionItems)) merged.actionItems = existing.actionItems.map(cleanActionItem);
    else merged.actionItems = [];
    if (Array.isArray(existing.linkedTaskIds)) merged.linkedTaskIds = existing.linkedTaskIds;
    if (item.presenter !== undefined) merged.presenter = item.presenter;
    else if (existing.presenter !== undefined) merged.presenter = existing.presenter;
    if (item.motionText !== undefined) merged.motionText = item.motionText;
    else if (existing.motionText !== undefined) merged.motionText = existing.motionText;
    if (item.motionTemplateId !== undefined) merged.motionTemplateId = item.motionTemplateId;
    else if (existing.motionTemplateId !== undefined) merged.motionTemplateId = existing.motionTemplateId;
    if (item.motionBacklogId !== undefined) merged.motionBacklogId = item.motionBacklogId;
    else if (existing.motionBacklogId !== undefined) merged.motionBacklogId = existing.motionBacklogId;
    return merged;
  });
  const nextTitles = new Set(items.map((item) => normalizeTitle(item.title)));
  for (const section of existingSections) {
    const key = normalizeTitle(section?.title ?? "");
    if (key && nextTitles.has(key)) continue;
    if (sectionHasDetails(section)) nextSections.push(cleanMinutesSection(section));
  }

  const existingMotions = Array.isArray(minutes.motions) ? minutes.motions.map(cleanMotion) : [];
  const agendaMotions = motionsFromAgendaItems(items);
  const agendaMotionKeys = new Set(agendaMotions.map((motion) => normalizeTitle(String(motion.text ?? ""))));
  const existingMotionByText = new Map<string, any>();
  for (const motion of existingMotions) {
    const key = normalizeTitle(motion?.text ?? "");
    if (key && !existingMotionByText.has(key)) existingMotionByText.set(key, motion);
  }
  const mergedAgendaMotions = agendaMotions.map((motion) => {
    const existing = existingMotionByText.get(normalizeTitle(String(motion.text ?? "")));
    return existing ? cleanMotion({ ...existing, sectionIndex: motion.sectionIndex, sectionTitle: motion.sectionTitle }) : cleanMotion(motion);
  });
  const preservedMotions = existingMotions.filter((motion: any) => {
    const key = normalizeTitle(motion?.text ?? "");
    return !agendaMotionKeys.has(key);
  });
  await ctx.db.patch(minutes._id, {
    sections: nextSections,
    motions: [...mergedAgendaMotions, ...preservedMotions.map(cleanMotion)],
  });
}

function cleanMinutesSection(section: any) {
  const clean: Record<string, unknown> = {
    title: String(section?.title ?? ""),
    depth: section?.depth === 1 ? 1 : 0,
  };
  if (section?.type !== undefined) clean.type = section.type;
  if (section?.presenter !== undefined) clean.presenter = section.presenter;
  if (section?.discussion !== undefined) clean.discussion = section.discussion;
  if (section?.motionText !== undefined) clean.motionText = section.motionText;
  if (section?.motionTemplateId !== undefined) clean.motionTemplateId = section.motionTemplateId;
  if (section?.motionBacklogId !== undefined) clean.motionBacklogId = section.motionBacklogId;
  if (section?.reportSubmitted !== undefined) clean.reportSubmitted = section.reportSubmitted;
  if (Array.isArray(section?.decisions)) clean.decisions = section.decisions.map(String);
  if (Array.isArray(section?.actionItems)) clean.actionItems = section.actionItems.map(cleanActionItem);
  if (Array.isArray(section?.linkedTaskIds)) clean.linkedTaskIds = section.linkedTaskIds;
  return clean;
}

function cleanActionItem(actionItem: any) {
  const clean: Record<string, unknown> = {
    text: String(actionItem?.text ?? ""),
    done: !!actionItem?.done,
  };
  if (actionItem?.assignee !== undefined) clean.assignee = actionItem.assignee;
  if (actionItem?.dueDate !== undefined) clean.dueDate = actionItem.dueDate;
  return clean;
}

function cleanMotion(motion: any) {
  const clean: Record<string, unknown> = {
    text: String(motion?.text ?? ""),
    outcome: String(motion?.outcome ?? "Pending"),
  };
  if (motion?.movedBy !== undefined) clean.movedBy = motion.movedBy;
  if (motion?.movedByMemberId !== undefined) clean.movedByMemberId = motion.movedByMemberId;
  if (motion?.movedByDirectorId !== undefined) clean.movedByDirectorId = motion.movedByDirectorId;
  if (motion?.secondedBy !== undefined) clean.secondedBy = motion.secondedBy;
  if (motion?.secondedByMemberId !== undefined) clean.secondedByMemberId = motion.secondedByMemberId;
  if (motion?.secondedByDirectorId !== undefined) clean.secondedByDirectorId = motion.secondedByDirectorId;
  if (motion?.votesFor !== undefined) clean.votesFor = motion.votesFor;
  if (motion?.votesAgainst !== undefined) clean.votesAgainst = motion.votesAgainst;
  if (motion?.abstentions !== undefined) clean.abstentions = motion.abstentions;
  if (motion?.resolutionType !== undefined) clean.resolutionType = motion.resolutionType;
  if (motion?.sectionIndex !== undefined) clean.sectionIndex = motion.sectionIndex;
  if (motion?.sectionTitle !== undefined) clean.sectionTitle = motion.sectionTitle;
  if (motion?.motionTemplateId !== undefined) clean.motionTemplateId = motion.motionTemplateId;
  if (motion?.motionBacklogId !== undefined) clean.motionBacklogId = motion.motionBacklogId;
  return clean;
}

function sectionHasDetails(section: any) {
  return !!(
    section?.discussion ||
    section?.presenter ||
    (section?.decisions ?? []).length ||
    (section?.actionItems ?? []).length ||
    (section?.linkedTaskIds ?? []).length
  );
}

export const removeItem = mutation({
  args: { itemId: v.id("agendaItems") },
  returns: v.any(),
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item) return;
    if (item.motionBacklogId) {
      await ctx.db.patch(item.motionBacklogId, {
        status: "Backlog",
        updatedAtISO: new Date().toISOString(),
      });
    }
    await ctx.db.delete(itemId);
    const siblings = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", item.agendaId))
      .collect();
    siblings.sort((a, b) => a.order - b.order);
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i].order !== i) {
        await ctx.db.patch(siblings[i]._id, { order: i });
      }
    }
  },
});

export const reorderItems = mutation({
  args: {
    agendaId: v.id("agendas"),
    orderedItemIds: v.array(v.id("agendaItems")),
  },
  returns: v.any(),
  handler: async (ctx, { agendaId, orderedItemIds }) => {
    for (let i = 0; i < orderedItemIds.length; i++) {
      const item = await ctx.db.get(orderedItemIds[i]);
      if (!item || item.agendaId !== agendaId) continue;
      await ctx.db.patch(orderedItemIds[i], { order: i });
    }
    await ctx.db.patch(agendaId, { updatedAtISO: new Date().toISOString() });
  },
});
