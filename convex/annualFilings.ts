import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  jurisdictionsPortable,
  historyPortable,
  outstandingPortable,
  upsertPortable,
  removePortable,
} from "../shared/functions/annualFilings";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Per-year, per-jurisdiction annual-filing ledger (YCN DB_GLOB_REG_FILING).
 *
 * Thin load-and-delegate wrappers over the pure, unit-tested shared module
 * (shared/annualFilings.ts). Rows are mapped into plain FilingRecord objects
 * before being passed to the shared functions.
 */

/** All ledger rows for a society. */
export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

/** Distinct jurisdictions tracked for a society, in first-seen order. */
export const jurisdictions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => jurisdictionsPortable(await toPortableQueryCtx(ctx), args),
});

/** Filing history for a jurisdiction, ascending by year. */
export const history = query({
  args: { societyId: v.id("societies"), jurisdiction: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => historyPortable(await toPortableQueryCtx(ctx), args),
});

/** Years in [fromYear, toYear] with no filed=true record for the jurisdiction. */
export const outstanding = query({
  args: {
    societyId: v.id("societies"),
    jurisdiction: v.string(),
    fromYear: v.string(),
    toYear: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => outstandingPortable(await toPortableQueryCtx(ctx), args),
});

/** Create or patch a ledger row. Returns the row id. */
export const upsert = mutation({
  args: {
    id: v.optional(v.id("annualFilingLedger")),
    societyId: v.id("societies"),
    jurisdiction: v.string(),
    year: v.string(),
    filed: v.boolean(),
    filedOn: v.optional(v.string()),
    regnNature: v.optional(v.string()),
    regnLegislation: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertPortable(await toPortableMutationCtx(ctx), args),
});

/** Delete a ledger row. */
export const remove = mutation({
  args: { id: v.id("annualFilingLedger") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
