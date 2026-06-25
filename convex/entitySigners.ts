import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { activeAsOf, type IntervalRow } from "../shared/registerHistory";

/**
 * Thin persistence/query wrapper for the `entitySigners` table.
 *
 * Signers record their validity as a `validFromISO`/`validToISO` interval, so
 * point-in-time reconstruction delegates to the pure, unit-tested
 * `activeAsOf` helper in shared/registerHistory.ts (with the interval field
 * names remapped). Handlers stay thin: load rows, delegate, sort, return.
 */

/** Sort comparator: ascending signOrder, undefined/null last. */
function bySignOrder(a: { signOrder?: unknown }, b: { signOrder?: unknown }) {
  const av = typeof a.signOrder === "number" ? a.signOrder : Infinity;
  const bv = typeof b.signOrder === "number" ? b.signOrder : Infinity;
  return av - bv;
}

/** All signers for a society, ordered by signOrder ascending (undefined last). */
export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("entitySigners")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return [...rows].sort(bySignOrder);
  },
});

/** Signers whose validity interval covers a specific ISO date, ordered by signOrder. */
export const activeAsOfQuery = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, asOf }) => {
    const rows = await ctx.db
      .query("entitySigners")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const active = activeAsOf(rows as unknown as IntervalRow[], asOf, {
      start: "validFromISO",
      end: "validToISO",
    });
    return [...(active as Array<{ signOrder?: unknown }>)].sort(bySignOrder);
  },
});

/** Create or update a signer. Patches when `id` is given, otherwise inserts. */
export const upsert = mutation({
  args: {
    id: v.optional(v.id("entitySigners")),
    societyId: v.id("societies"),
    directoryPersonId: v.optional(v.id("peopleDirectory")),
    name: v.string(),
    signOrder: v.optional(v.number()),
    validFromISO: v.optional(v.string()),
    validToISO: v.optional(v.string()),
    corpSign: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const {
      id,
      societyId,
      directoryPersonId,
      name,
      signOrder,
      validFromISO,
      validToISO,
      corpSign,
      nowISO,
    } = args;
    const fields = {
      societyId,
      directoryPersonId,
      name,
      signOrder,
      validFromISO,
      validToISO,
      corpSign,
    };
    if (id) {
      await ctx.db.patch(id, fields);
      return id;
    }
    return ctx.db.insert("entitySigners", { ...fields, createdAtISO: nowISO });
  },
});

/** Delete a signer. */
export const remove = mutation({
  args: { id: v.id("entitySigners") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
