/**
 * PORTABLE FUNCTIONS: the register-history domain
 * (roleHoldersAsOfDate / addressesAsOf / directorsAsOf / significantIndividualsAsOf).
 *
 * Point-in-time ("as of") register queries built on the EXISTING roleHolders and
 * organizationAddresses interval models. All reconstruction logic lives in the
 * pure, unit-tested shared modules (shared/registerHistory.ts,
 * shared/significantIndividuals.ts); these handlers are thin load-and-delegate
 * wrappers over `ctx.db`, running unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import type { PortableQueryCtx } from "../portable/ctx";
import { roleHoldersAsOf, activeAsOf, type IntervalRow } from "../registerHistory";
import {
  deriveSignificanceStatus,
  type SignificantIndividual,
} from "../significantIndividuals";

/** Role-holders of a given type that were active on a specific ISO date. */
export async function roleHoldersAsOfDatePortable(
  ctx: PortableQueryCtx,
  { societyId, asOf, roleType }: { societyId: string; asOf: string; roleType: string },
) {
  const rows = await ctx.db
    .query("roleHolders")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return roleHoldersAsOf(rows as IntervalRow[], asOf, roleType);
}

/**
 * Office/business addresses in effect on a specific ISO date, using the existing
 * organizationAddresses effectiveFrom/effectiveTo intervals (YCN REG_OFFICE /
 * REC_OFFICE / BUS_ADDRESS START_DT_TM point-in-time resolution).
 */
export async function addressesAsOfPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf, type }: { societyId: string; asOf: string; type?: string },
) {
  const rows = await ctx.db
    .query("organizationAddresses")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const filtered = type ? rows.filter((r) => r.type === type) : rows;
  return activeAsOf(filtered as IntervalRow[], asOf, {
    start: "effectiveFrom",
    end: "effectiveTo",
  });
}

/** Directors who held office on a specific ISO date ("who were the directors on X?"). */
export async function directorsAsOfPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
  const rows = await ctx.db
    .query("roleHolders")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return roleHoldersAsOf(rows as IntervalRow[], asOf, "director");
}

/**
 * Significant individuals (roleType 'controller') with significance status
 * derived as of a date. Maps the interval fields onto the transparency-register
 * shape; richer fields (reason, tax residency) populate once those columns are
 * added to roleHolders.
 */
export async function significantIndividualsAsOfPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
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
}
