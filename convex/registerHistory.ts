import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { roleHoldersAsOf, activeAsOf, type IntervalRow } from "../shared/registerHistory";
import {
  deriveSignificanceStatus,
  type SignificantIndividual,
} from "../shared/significantIndividuals";

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
  handler: async (ctx, { societyId, asOf, roleType }) => {
    const rows = await ctx.db
      .query("roleHolders")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return roleHoldersAsOf(rows as IntervalRow[], asOf, roleType);
  },
});

/**
 * Office/business addresses in effect on a specific ISO date, using the existing
 * organizationAddresses effectiveFrom/effectiveTo intervals (YCN REG_OFFICE /
 * REC_OFFICE / BUS_ADDRESS START_DT_TM point-in-time resolution).
 */
export const addressesAsOf = query({
  args: { societyId: v.id("societies"), asOf: v.string(), type: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { societyId, asOf, type }) => {
    const rows = await ctx.db
      .query("organizationAddresses")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const filtered = type ? rows.filter((r) => r.type === type) : rows;
    return activeAsOf(filtered as IntervalRow[], asOf, {
      start: "effectiveFrom",
      end: "effectiveTo",
    });
  },
});

/** Directors who held office on a specific ISO date ("who were the directors on X?"). */
export const directorsAsOf = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, asOf }) => {
    const rows = await ctx.db
      .query("roleHolders")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return roleHoldersAsOf(rows as IntervalRow[], asOf, "director");
  },
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
  handler: async (ctx, { societyId, asOf }) => {
    const rows = await ctx.db
      .query("roleHolders")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows
      .filter((row) => row.roleType === "controller")
      .map((row) => {
        const si: SignificantIndividual = {
          name: String(row.fullName ?? ""),
          dateOfBirth: row.dateOfBirth ?? undefined,
          becameSignificantOn: String(row.startDate ?? row.referenceDate ?? ""),
          ceasedSignificantOn: row.endDate ?? null,
          reason: String(row.significanceReason ?? row.notes ?? ""),
        };
        const status = si.becameSignificantOn
          ? deriveSignificanceStatus(si, asOf)
          : "current";
        return { ...si, status, roleHolderId: row._id };
      });
  },
});
