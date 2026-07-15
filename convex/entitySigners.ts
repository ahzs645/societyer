import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  activeAsOfQueryPortable,
  upsertPortable,
  removePortable,
} from "../shared/functions/entitySigners";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Thin persistence/query wrapper for the `entitySigners` table.
 *
 * Signers record their validity as a `validFromISO`/`validToISO` interval, so
 * point-in-time reconstruction delegates to the pure, unit-tested
 * `activeAsOf` helper in shared/registerHistory.ts (with the interval field
 * names remapped). Handlers stay thin: load rows, delegate, sort, return.
 */

/** All signers for a society, ordered by signOrder ascending (undefined last). */
export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

/** Signers whose validity interval covers a specific ISO date, ordered by signOrder. */
export const activeAsOfQuery = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => activeAsOfQueryPortable(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

/** Delete a signer. */
export const remove = mutation({
  args: { id: v.id("entitySigners") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
