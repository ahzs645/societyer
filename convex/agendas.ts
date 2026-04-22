import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listForMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const agendas = await ctx.db
      .query("agendas")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    return agendas;
  },
});

export const get = query({
  args: { agendaId: v.id("agendas") },
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
    timeAllottedMinutes: v.optional(v.number()),
    motionTemplateId: v.optional(v.id("motionTemplates")),
    motionBacklogId: v.optional(v.id("motionBacklog")),
    motionText: v.optional(v.string()),
  },
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
    timeAllottedMinutes: v.optional(v.number()),
    motionText: v.optional(v.string()),
    outcome: v.optional(v.string()),
  },
  handler: async (ctx, { itemId, ...patch }) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
    await ctx.db.patch(itemId, clean);
    return itemId;
  },
});

export const removeItem = mutation({
  args: { itemId: v.id("agendaItems") },
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
  handler: async (ctx, { agendaId, orderedItemIds }) => {
    for (let i = 0; i < orderedItemIds.length; i++) {
      const item = await ctx.db.get(orderedItemIds[i]);
      if (!item || item.agendaId !== agendaId) continue;
      await ctx.db.patch(orderedItemIds[i], { order: i });
    }
    await ctx.db.patch(agendaId, { updatedAtISO: new Date().toISOString() });
  },
});
