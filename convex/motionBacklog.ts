import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  suggestForMeetingPortable,
  createPortable,
  updatePortable,
  removePortable,
  createFromMinutesMotionPortable,
  createFromMinutesSectionPortable,
  seedPipaSetupPortable,
  addToAgendaPortable,
  carryForwardToMeetingPortable,
  seedToMinutesPortable,
} from "../shared/functions/motionBacklog";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

// The `motionBacklog` table has been retired (see
// docs/motions-first-class-object-design.md). A "backlog item" is now just a
// row in the first-class `motions` table with an early lifecycle status
// (Backlog / Tabled / Deferred) plus the folded-in backlog columns
// (backlogPriority / source / seededKey / targetMeetingId / notes). The
// public api.motionBacklog.* surface is kept (same export names + arg
// signatures) so the frontend keeps working; each handler now reads/writes the
// motions table directly. The "backlog list" is the by_society_status query.

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const suggestForMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => suggestForMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    motionText: v.string(),
    tags: v.optional(v.array(v.string())),    priority: v.optional(v.string()),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    backlogId: v.id("motions"),
    title: v.optional(v.string()),
    motionText: v.optional(v.string()),    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { backlogId: v.id("motions") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

export const createFromMinutesMotion = mutation({
  args: {
    minutesId: v.id("minutes"),
    motionIndex: v.number(),
    title: v.optional(v.string()),    priority: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createFromMinutesMotionPortable(await toPortableMutationCtx(ctx), args),
});

export const createFromMinutesSection = mutation({
  args: {
    minutesId: v.id("minutes"),
    sectionIndex: v.number(),
    title: v.optional(v.string()),
    motionText: v.optional(v.string()),    priority: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createFromMinutesSectionPortable(await toPortableMutationCtx(ctx), args),
});

export const seedPipaSetup = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => seedPipaSetupPortable(await toPortableMutationCtx(ctx), args),
});

export const addToAgenda = mutation({
  args: {
    backlogId: v.id("motions"),
    agendaId: v.id("agendas"),
  },
  returns: v.any(),
  handler: async (ctx, args) => addToAgendaPortable(await toPortableMutationCtx(ctx), args),
});

// Create backlog motions for a set of (deferred/tabled) motions in a source
// meeting's minutes and link them onto a target meeting's agenda in one shot.
// Used by "Schedule next meeting" so unfinished business becomes tracked motion
// rows AND agenda items on the new meeting. Idempotent: deduped by source
// minutes+motion index (motion row) and by motionId (agenda item).
export const carryForwardToMeeting = mutation({
  args: {
    meetingId: v.id("meetings"),
    sourceMinutesId: v.id("minutes"),
    motionIndexes: v.array(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => carryForwardToMeetingPortable(await toPortableMutationCtx(ctx), args),
});

export const seedToMinutes = mutation({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => seedToMinutesPortable(await toPortableMutationCtx(ctx), args),
});
