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
import { annualFilingYear } from "../annualFilings";
import { getOwned, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import {
  outstandingYears,
  annualFilingKind,
  filingHistory,
  jurisdictionsTracked,
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

/** Resolve an explicit detailed-record link on every read; no stale status mirror. */
async function resolvedRows(ctx: PortableQueryCtx, societyId: string) {
  await requirePermissionPortable(ctx, societyId, "filings:read");
  const rows = await ctx.db.query("annualFilingLedger")
    .withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return Promise.all(rows.map(async row => {
    if (!row.sourceFilingId) return row;
    const source = await ctx.db.get(String(row.sourceFilingId), "filings");
    const valid = source?.societyId === societyId && annualFilingKind(String(source.kind))
      && source.jurisdictionCode === row.jurisdiction && annualFilingYear(source.periodLabel) === row.year;
    return { ...row, filed: Boolean(valid && source.status === "Filed"),
      filedOn: valid && source.status === "Filed" ? source.filedAt : undefined,
      sourceMissing: !valid };
  }));
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return resolvedRows(ctx, societyId);
}
export async function jurisdictionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return jurisdictionsTracked((await resolvedRows(ctx, societyId)).map(toFilingRecord));
}
export async function historyPortable(ctx: PortableQueryCtx, { societyId, jurisdiction }: { societyId: string; jurisdiction: string }) {
  return filingHistory((await resolvedRows(ctx, societyId)).map(toFilingRecord), jurisdiction);
}
export async function outstandingPortable(ctx: PortableQueryCtx,
  { societyId, jurisdiction, fromYear, toYear }: { societyId: string; jurisdiction: string; fromYear: string; toYear: string }) {
  return outstandingYears((await resolvedRows(ctx, societyId)).map(toFilingRecord), jurisdiction, fromYear, toYear);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
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
    sourceFilingId?: string;
    nowISO: string;
  },
) {
  const { id, societyId, sourceFilingId, nowISO } = args;
  await requirePermissionPortable(ctx, societyId, "filings:write");
  const jurisdiction = args.jurisdiction.trim();
  const year = args.year.trim();
  if (!jurisdiction || jurisdiction.length > 200 || !/^[1-9]\d{3}$/.test(year)) {
    throw new Error("Enter a jurisdiction and a four-digit filing year.");
  }
  if (Number.isNaN(Date.parse(nowISO))) throw new Error("Invalid creation timestamp.");
  let filed = args.filed;
  let filedOn = filed ? args.filedOn : undefined;
  if (sourceFilingId) {
    await requirePermissionPortable(ctx, societyId, "filings:read");
    const source = await getOwned(ctx, "filings", sourceFilingId, societyId);
    if (!annualFilingKind(String(source.kind)) || source.jurisdictionCode !== jurisdiction || annualFilingYear(source.periodLabel) !== year) {
      throw new Error("Link an annual filing with the same jurisdiction whose period names the same year.");
    }
    filed = source.status === "Filed";
    filedOn = filed && typeof source.filedAt === "string" ? source.filedAt : undefined;
  }
  if (filed && (!filedOn || !validDate(filedOn))) throw new Error("Add a valid filed-on date before marking this filing as filed.");
  if (id) await getOwned(ctx, "annualFilingLedger", id, societyId);
  const rows = await ctx.db.query("annualFilingLedger")
    .withIndex("by_society", q => q.eq("societyId", societyId)).collect();
  const matches = rows.filter(row => String(row.jurisdiction).trim().toLowerCase() === jurisdiction.toLowerCase() && row.year === year && row._id !== id);
  if (matches.length > 1 || (id && matches.length)) throw new Error("Another annual ledger entry already tracks this jurisdiction and year. Edit that entry first.");
  // Repeated new-save requests target the same logical row instead of adding duplicates.
  const targetId = id ?? matches[0]?._id;
  const payload = { societyId, jurisdiction, year, filed, filedOn, sourceFilingId,
    regnNature: args.regnNature, regnLegislation: args.regnLegislation };
  if (!id && matches[0]) {
    const previous = matches[0];
    const sameLink = previous.sourceFilingId === sourceFilingId;
    const sameLabels = previous.regnNature === args.regnNature && previous.regnLegislation === args.regnLegislation;
    const sameManualFacts = sourceFilingId || (previous.filed === filed && previous.filedOn === filedOn);
    if (!sameLink || !sameLabels || !sameManualFacts) throw new Error("Another annual ledger entry already tracks this jurisdiction and year. Edit that entry first.");
  }
  if (targetId) { await ctx.db.patch(targetId, payload); return targetId; }
  return ctx.db.insert("annualFilingLedger", { ...payload, createdAtISO: nowISO });
}

/** Delete a ledger row. */
export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "annualFilingLedger");
  if (!candidate || typeof candidate.societyId !== "string") {
    throw new Error("annualFilingLedger not found.");
  }
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "annualFilingLedger", id, candidate.societyId);
  await ctx.db.delete(id);
}
