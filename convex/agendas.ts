import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  listForMeetingPortable,
  getForMeetingPortable,
  getPortable,
  listForSocietyPortable,
  createPortable,
  updateAgendaPortable,
  removePortable,
  addItemPortable,
  updateItemPortable,
  syncForMeetingPortable,
  startMinutesFromAgendaPortable,
  removeItemPortable,
  reorderItemsPortable,
} from "../shared/functions/agendas";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const listForMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => listForMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const getForMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => getForMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { agendaId: v.id("agendas") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const listForSociety = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listForSocietyPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    title: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const updateAgenda = mutation({
  args: {
    agendaId: v.id("agendas"),
    title: v.optional(v.string()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateAgendaPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { agendaId: v.id("agendas") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
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
    motionId: v.optional(v.id("motions")),
    motionText: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => addItemPortable(await toPortableMutationCtx(ctx), args),
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
  handler: async (ctx, args) => updateItemPortable(await toPortableMutationCtx(ctx), args),
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
      motionId: v.optional(v.id("motions")),
      motionText: v.optional(v.string()),
    })),
  },
  returns: v.any(),
  handler: async (ctx, args) => syncForMeetingPortable(await toPortableMutationCtx(ctx), args),
});

export const startMinutesFromAgenda = mutation({
  args: { agendaId: v.id("agendas") },
  returns: v.any(),
  handler: async (ctx, args) => startMinutesFromAgendaPortable(await toPortableMutationCtx(ctx), args),
});

export const removeItem = mutation({
  args: { itemId: v.id("agendaItems") },
  returns: v.any(),
  handler: async (ctx, args) => removeItemPortable(await toPortableMutationCtx(ctx), args),
});

export const reorderItems = mutation({
  args: {
    agendaId: v.id("agendas"),
    orderedItemIds: v.array(v.id("agendaItems")),
  },
  returns: v.any(),
  handler: async (ctx, args) => reorderItemsPortable(await toPortableMutationCtx(ctx), args),
});
