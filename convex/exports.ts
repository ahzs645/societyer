import { query } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const EXPORTABLE = [
  "members",
  "directors",
  "committees",
  "meetings",
  "minutes",
  "filings",
  "deadlines",
  "volunteers",
  "grants",
  "grantApplications",
  "grantReports",
  "donationReceipts",
  "financialTransactions",
  "financialAccounts",
  "budgets",
  "conflicts",
  "attestations",
  "insurancePolicies",
  "pipaTrainings",
  "memberSubscriptions",
  "employees",
  "documents",
  "activity",
] as const;

export type ExportableTable = (typeof EXPORTABLE)[number];

async function collectForSociety(
  ctx: QueryCtx,
  table: ExportableTable,
  societyId: Id<"societies">,
) {
  switch (table) {
    case "members":
      return await ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "directors":
      return await ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "committees":
      return await ctx.db.query("committees").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "meetings":
      return await ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "minutes":
      return await ctx.db.query("minutes").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "filings":
      return await ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "deadlines":
      return await ctx.db.query("deadlines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "volunteers":
      return await ctx.db.query("volunteers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "grants":
      return await ctx.db.query("grants").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "grantApplications":
      return await ctx.db.query("grantApplications").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "grantReports":
      return await ctx.db.query("grantReports").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "donationReceipts":
      return await ctx.db.query("donationReceipts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "financialTransactions":
      return await ctx.db.query("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "financialAccounts":
      return await ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "budgets":
      return await ctx.db.query("budgets").withIndex("by_society_fy", (q) => q.eq("societyId", societyId)).collect();
    case "conflicts":
      return await ctx.db.query("conflicts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "attestations":
      return await ctx.db.query("directorAttestations").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "insurancePolicies":
      return await ctx.db.query("insurancePolicies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "pipaTrainings":
      return await ctx.db.query("pipaTrainings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "memberSubscriptions":
      return await ctx.db.query("memberSubscriptions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "employees":
      return await ctx.db.query("employees").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "documents":
      return await ctx.db.query("documents").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    case "activity":
      return await ctx.db.query("activity").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  }
}

export const listExportableTables = query({
  args: {},
  handler: async () => EXPORTABLE.map((t) => t),
});

export const exportTable = query({
  args: {
    societyId: v.id("societies"),
    table: v.union(...EXPORTABLE.map((t) => v.literal(t))),
  },
  handler: async (ctx, { societyId, table }) => {
    const rows = await collectForSociety(ctx, table, societyId);
    return rows.map(stripStorageRefs);
  },
});

function stripStorageRefs<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row };
  if ("storageId" in copy) copy.storageId = undefined;
  return copy as T;
}
