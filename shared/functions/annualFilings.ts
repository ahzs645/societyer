/**
 * PORTABLE FUNCTIONS: the annual-filings domain
 * (list / jurisdictions / history / outstanding / upsert / remove).
 *
 * Per-year, per-jurisdiction annual-filing ledger (YCN DB_GLOB_REG_FILING).
 *
 * Thin load-and-delegate wrappers over the pure, unit-tested shared module
 * (shared/annualFilings.ts) on the portable `ctx.db` contract. Rows are mapped
 * into plain FilingRecord objects before being passed to the shared functions.
 * Each handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  outstandingYears,
  filingHistory,
  jurisdictionsTracked,
  isFiledFor,
  type FilingRecord,
} from "../annualFilings";

/** Map a stored ledger row into the plain FilingRecord shape the shared fns expect. */
function toFilingRecord(row: Record<string, any>): FilingRecord {
  return {
    jurisdiction: row.jurisdiction,
    year: row.year,
    filed: row.filed,
    filedOn: row.filedOn ?? null,
  };
}

/** All ledger rows for a society. */
export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("annualFilingLedger")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

/** Distinct jurisdictions tracked for a society, in first-seen order. */
export async function jurisdictionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("annualFilingLedger")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return jurisdictionsTracked(rows.map(toFilingRecord));
}

/** Filing history for a jurisdiction, ascending by year. */
export async function historyPortable(
  ctx: PortableQueryCtx,
  { societyId, jurisdiction }: { societyId: string; jurisdiction: string },
) {
  const rows = await ctx.db
    .query("annualFilingLedger")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return filingHistory(rows.map(toFilingRecord), jurisdiction);
}

/** Years in [fromYear, toYear] with no filed=true record for the jurisdiction. */
export async function outstandingPortable(
  ctx: PortableQueryCtx,
  {
    societyId,
    jurisdiction,
    fromYear,
    toYear,
  }: { societyId: string; jurisdiction: string; fromYear: string; toYear: string },
) {
  const rows = await ctx.db
    .query("annualFilingLedger")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const records = rows.map(toFilingRecord);
  void isFiledFor;
  return outstandingYears(records, jurisdiction, fromYear, toYear);
}

/** Create or patch a ledger row. Returns the row id. */
export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    jurisdiction: string;
    year: string;
    filed: boolean;
    filedOn?: string;
    regnNature?: string;
    regnLegislation?: string;
    nowISO: string;
  },
) {
  const {
    id,
    societyId,
    jurisdiction,
    year,
    filed,
    filedOn,
    regnNature,
    regnLegislation,
    nowISO,
  } = args;
  if (id) {
    await ctx.db.patch(id, {
      societyId,
      jurisdiction,
      year,
      filed,
      filedOn,
      regnNature,
      regnLegislation,
    });
    return id;
  }
  return ctx.db.insert("annualFilingLedger", {
    societyId,
    jurisdiction,
    year,
    filed,
    filedOn,
    regnNature,
    regnLegislation,
    createdAtISO: nowISO,
  });
}

/** Delete a ledger row. */
export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}
