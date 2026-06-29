import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  currentRegimePortable,
  narrativePortable,
  createPortable,
  removePortable,
} from "../shared/functions/constating";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Constating-document timeline (the YCN DB_GLOB_CONSTATING idea): the lineage
 * of an entity's governing Acts over time (incorporated / transitioned /
 * continued / amalgamated / restated).
 *
 * All ordering, as-of, narrative, and validation logic lives in the pure,
 * unit-tested shared module (shared/constating.ts); these handlers are thin
 * load-and-delegate wrappers that map rows into plain ConstatingEvent objects.
 */

/** Constating events for a society, sorted chronologically. */
export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

/** The governing Act as of a given ISO date (null when none has taken effect). */
export const currentRegime = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: (ctx, args) => currentRegimePortable(toPortableQueryCtx(ctx), args),
});

/** Human-readable narrative of the constating chain. */
export const narrative = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => narrativePortable(toPortableQueryCtx(ctx), args),
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
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("constatingEvents") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
