import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  outstandingYears,
  filingHistory,
  jurisdictionsTracked,
  isFiledFor,
  type FilingRecord,
} from "../shared/annualFilings";

/**
 * Per-year, per-jurisdiction annual-filing ledger (YCN DB_GLOB_REG_FILING).
 *
 * Thin load-and-delegate wrappers over the pure, unit-tested shared module
 * (shared/annualFilings.ts). Rows are mapped into plain FilingRecord objects
 * before being passed to the shared functions.
 */

/** Map a stored ledger row into the plain FilingRecord shape the shared fns expect. */
function toFilingRecord(row: {
  jurisdiction: string;
  year: string;
  filed: boolean;
  filedOn?: string | null;
}): FilingRecord {
  return {
    jurisdiction: row.jurisdiction,
    year: row.year,
    filed: row.filed,
    filedOn: row.filedOn ?? null,
  };
}

/** All ledger rows for a society. */
export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("annualFilingLedger")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

/** Distinct jurisdictions tracked for a society, in first-seen order. */
export const jurisdictions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("annualFilingLedger")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return jurisdictionsTracked(rows.map(toFilingRecord));
  },
});

/** Filing history for a jurisdiction, ascending by year. */
export const history = query({
  args: { societyId: v.id("societies"), jurisdiction: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, jurisdiction }) => {
    const rows = await ctx.db
      .query("annualFilingLedger")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return filingHistory(rows.map(toFilingRecord), jurisdiction);
  },
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
  handler: async (ctx, { societyId, jurisdiction, fromYear, toYear }) => {
    const rows = await ctx.db
      .query("annualFilingLedger")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const records = rows.map(toFilingRecord);
    void isFiledFor;
    return outstandingYears(records, jurisdiction, fromYear, toYear);
  },
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
  handler: async (ctx, args) => {
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
  },
});

/** Delete a ledger row. */
export const remove = mutation({
  args: { id: v.id("annualFilingLedger") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
