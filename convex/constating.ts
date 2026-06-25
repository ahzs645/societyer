import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  constatingTimeline,
  currentRegime as computeCurrentRegime,
  regimeNarrative,
  validateConstatingEvent,
  type ConstatingEvent,
} from "../shared/constating";

/**
 * Constating-document timeline (the YCN DB_GLOB_CONSTATING idea): the lineage
 * of an entity's governing Acts over time (incorporated / transitioned /
 * continued / amalgamated / restated).
 *
 * All ordering, as-of, narrative, and validation logic lives in the pure,
 * unit-tested shared module (shared/constating.ts); these handlers are thin
 * load-and-delegate wrappers that map rows into plain ConstatingEvent objects.
 */

/** Map a stored constatingEvents row into the plain shared ConstatingEvent shape. */
function toConstatingEvent(row: {
  action: string;
  jurisdiction: string;
  legislation: string;
  regNumber?: string;
  startISO: string;
}): ConstatingEvent {
  return {
    action: row.action as ConstatingEvent["action"],
    jurisdiction: row.jurisdiction,
    legislation: row.legislation,
    regNumber: row.regNumber,
    startISO: row.startISO,
  };
}

/** Constating events for a society, sorted chronologically. */
export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("constatingEvents")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const events = rows.map(toConstatingEvent);
    return constatingTimeline(events);
  },
});

/** The governing Act as of a given ISO date (null when none has taken effect). */
export const currentRegime = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, asOf }) => {
    const rows = await ctx.db
      .query("constatingEvents")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const events = rows.map(toConstatingEvent);
    return computeCurrentRegime(events, asOf);
  },
});

/** Human-readable narrative of the constating chain. */
export const narrative = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("constatingEvents")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const events = rows.map(toConstatingEvent);
    return regimeNarrative(events);
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    action: v.string(),
    jurisdiction: v.string(),
    legislation: v.string(),
    regNumber: v.optional(v.string()),
    startISO: v.string(),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (
    ctx,
    { societyId, action, jurisdiction, legislation, regNumber, startISO, nowISO },
  ) => {
    const event: ConstatingEvent = {
      action: action as ConstatingEvent["action"],
      jurisdiction,
      legislation,
      regNumber,
      startISO,
    };
    const { ok, errors } = validateConstatingEvent(event);
    if (!ok) {
      throw new Error(errors.join("; "));
    }
    return ctx.db.insert("constatingEvents", {
      societyId,
      action,
      jurisdiction,
      legislation,
      regNumber,
      startISO,
      createdAtISO: nowISO,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("constatingEvents") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
