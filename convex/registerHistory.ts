import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  roleHoldersAsOfDatePortable,
  addressesAsOfPortable,
  directorsAsOfPortable,
  significantIndividualsAsOfPortable,
} from "../shared/functions/registerHistory";
import { toPortableQueryCtx } from "./lib/portable";

/**
 * Point-in-time register queries (the YCN bitemporal-register idea), built on
 * the EXISTING roleHolders startDate/endDate interval model — no schema change.
 *
 * All reconstruction logic lives in the pure, unit-tested shared modules
 * (shared/registerHistory.ts, shared/significantIndividuals.ts); these handlers
 * are thin load-and-delegate wrappers.
 */

/** Role-holders of a given type that were active on a specific ISO date. */
export const roleHoldersAsOfDate = query({
  args: {
    societyId: v.id("societies"),
    asOf: v.string(),
    roleType: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => roleHoldersAsOfDatePortable(toPortableQueryCtx(ctx), args),
});

/**
 * Office/business addresses in effect on a specific ISO date, using the existing
 * organizationAddresses effectiveFrom/effectiveTo intervals (YCN REG_OFFICE /
 * REC_OFFICE / BUS_ADDRESS START_DT_TM point-in-time resolution).
 */
export const addressesAsOf = query({
  args: { societyId: v.id("societies"), asOf: v.string(), type: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => addressesAsOfPortable(toPortableQueryCtx(ctx), args),
});

/** Directors who held office on a specific ISO date ("who were the directors on X?"). */
export const directorsAsOf = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: (ctx, args) => directorsAsOfPortable(toPortableQueryCtx(ctx), args),
});

/**
 * Significant individuals (roleType 'controller') with significance status
 * derived as of a date. Maps the interval fields onto the transparency-register
 * shape; richer fields (reason, tax residency) populate once those columns are
 * added to roleHolders.
 */
export const significantIndividualsAsOf = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: (ctx, args) => significantIndividualsAsOfPortable(toPortableQueryCtx(ctx), args),
});
