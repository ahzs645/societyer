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
    items: v.array(v.object({
      title: v.string(),
      depth: v.optional(v.union(v.literal(0), v.literal(1))),
      type: v.optional(v.string()),
      details: v.optional(v.string()),
      presenter: v.optional(v.string()),
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
      if (item.motionText !== undefined) payload.motionText = item.motionText;

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

    return agendaId;
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
