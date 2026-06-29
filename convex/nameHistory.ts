import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  asOfPortable,
  narrativePortable,
  upsertPortable,
  removePortable,
} from "../shared/functions/nameHistory";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Effective-dated corporate NAME history (YCN DB_GLOB_CORP_NAME).
 *
 * A society can carry multiple legal names over its lifetime; each takes effect
 * on its `startISO` and remains in effect until superseded by the next-starting
 * name. All reconstruction logic lives in the pure, unit-tested shared module
 * (shared/nameHistory.ts); these handlers are thin load-and-delegate wrappers
 * that map rows into plain NameRecord objects before delegating.
 */

/** Full name timeline (sorted by startISO, tie-broken by regPosn). */
export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

/** The legal name in effect on a specific ISO date. */
export const asOf = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: (ctx, args) => asOfPortable(toPortableQueryCtx(ctx), args),
});

/** Human-readable summary of the society's name-change history. */
export const narrative = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => narrativePortable(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => upsertPortable(toPortableMutationCtx(ctx), args),
});

/** Delete a name record. */
export const remove = mutation({
  args: { id: v.id("societyNameHistory") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
