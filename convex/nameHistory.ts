import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  nameAsOf,
  currentName,
  nameTimeline,
  nameChangeNarrative,
  type NameRecord,
} from "../shared/nameHistory";

/**
 * Effective-dated corporate NAME history (YCN DB_GLOB_CORP_NAME).
 *
 * A society can carry multiple legal names over its lifetime; each takes effect
 * on its `startISO` and remains in effect until superseded by the next-starting
 * name. All reconstruction logic lives in the pure, unit-tested shared module
 * (shared/nameHistory.ts); these handlers are thin load-and-delegate wrappers
 * that map rows into plain NameRecord objects before delegating.
 */

function toNameRecord(row: {
  name?: unknown;
  shortName?: unknown;
  startISO?: unknown;
  regPosn?: unknown;
}): NameRecord {
  return {
    name: String(row.name ?? ""),
    shortName: row.shortName == null ? undefined : String(row.shortName),
    startISO: String(row.startISO ?? ""),
    regPosn: typeof row.regPosn === "number" ? row.regPosn : undefined,
  };
}

/** Full name timeline (sorted by startISO, tie-broken by regPosn). */
export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("societyNameHistory")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const records = rows.map(toNameRecord);
    return nameTimeline(records);
  },
});

/** The legal name in effect on a specific ISO date. */
export const asOf = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, asOf }) => {
    const rows = await ctx.db
      .query("societyNameHistory")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const records = rows.map(toNameRecord);
    return nameAsOf(records, asOf);
  },
});

/** Human-readable summary of the society's name-change history. */
export const narrative = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("societyNameHistory")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const records = rows.map(toNameRecord);
    return nameChangeNarrative(records);
  },
});

/** Create a new name record or patch an existing one. Returns the id. */
export const upsert = mutation({
  args: {
    id: v.optional(v.id("societyNameHistory")),
    societyId: v.id("societies"),
    name: v.string(),
    shortName: v.optional(v.string()),
    startISO: v.string(),
    regPosn: v.optional(v.number()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { id, societyId, name, shortName, startISO, regPosn, nowISO } = args;
    if (id) {
      await ctx.db.patch(id, { name, shortName, startISO, regPosn });
      return id;
    }
    return ctx.db.insert("societyNameHistory", {
      societyId,
      name,
      shortName,
      startISO,
      regPosn,
      createdAtISO: nowISO,
    });
  },
});

/** Delete a name record. */
export const remove = mutation({
  args: { id: v.id("societyNameHistory") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

// `currentName` is re-used by callers needing the present-moment name without a
// separate query round-trip; referenced here to keep the import surface aligned
// with the shared module's public API.
void currentName;
