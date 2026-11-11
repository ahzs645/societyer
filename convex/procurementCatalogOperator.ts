/** Administrator CLI only. Bounded parity reads never acquire an importer lease or alter serving data. */
import { v } from "convex/values";
import { paginationOptsValidator, type IndexRangeBuilder } from "convex/server";
import { internalQuery, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { catalogServiceConfiguration } from "./procurementCatalog";
const table = v.union(v.literal("procurementRecords"), v.literal("procurementDetails"), v.literal("procurementDocuments"), v.literal("procurementEvidence"), v.literal("procurementTaxonomyTerms"));
export const publicationPolicy = internalQuery({
  args: { societyId: v.id("societies") }, returns: v.object({ serviceOnlyAllowed: v.boolean(), fallbackUntil: v.union(v.number(), v.null()) }),
  handler: async (ctx, { societyId }) => {
    catalogServiceConfiguration(societyId);
    const society = await ctx.db.get(societyId), rollout = await ctx.db.query("procurementServiceRollouts").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
    return { serviceOnlyAllowed: society?.integrationSettings?.procurementCatalogSource === "service" && !!rollout && rollout.folder === society.integrationSettings?.procurementReviewFolder && (rollout.convexRetirement !== undefined || rollout.fallbackUntil <= Date.now()) && rollout.qualificationPublications.length === 3, fallbackUntil: rollout?.fallbackUntil ?? null };
  },
});

const retirementIndexes = {
  procurementRecords: "by_key",
  procurementDetails: "by_key",
  procurementDocuments: "by_document_key",
  procurementEvidence: "by_record_source",
  procurementSearch: "by_key",
  procurementTaxonomyTerms: "by_release_key",
  procurementTaxonomyReleases: "by_release",
  procurementAnalytics: "by_society_generation_key",
  procurementAnalyticsArtifacts: "by_society_generation_request",
  procurementAnalyticsBundles: "by_society_generation",
} as const;
type RetirementTable = keyof typeof retirementIndexes;
const retirementTables = Object.keys(retirementIndexes) as RetirementTable[];
const retirementScope = { societyId: v.id("societies"), backupSha256: v.string() };

async function retirementRollout(ctx: QueryCtx | MutationCtx, societyId: Id<"societies">) {
  catalogServiceConfiguration(societyId);
  const society = await ctx.db.get(societyId);
  const rollout = await ctx.db.query("procurementServiceRollouts").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
  if (!rollout || society?.integrationSettings?.procurementCatalogSource !== "service" || society.integrationSettings.procurementReviewFolder !== rollout.folder || new Set(rollout.qualificationPublications).size !== 3)
    throw new Error("Retirement requires a qualified workspace serving from its catalog service.");
  return rollout;
}

/** Freeze legacy writers against a checksummed backup and the last matching live publication. */
export const approveRetirement = internalMutation({
  args: { ...retirementScope, generation: v.string(), inventoryHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rollout = await retirementRollout(ctx, args.societyId);
    const { societyId, ...backup } = args;
    const existing = rollout.convexRetirement;
    if (existing) {
      if (existing.backupSha256 !== backup.backupSha256 || existing.generation !== backup.generation || existing.inventoryHash !== backup.inventoryHash)
        throw new Error("Resume with the original retirement backup.");
      return null;
    }
    const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
    const service = await ctx.db.query("procurementServicePublications").withIndex("by_latest", q => q.eq("societyId", societyId).eq("folder", rollout.folder)).order("desc").first();
    const job = await ctx.db.query("procurementImportJobs").withIndex("by_society_folder", q => q.eq("societyId", societyId).eq("folder", rollout.folder)).order("desc").first();
    if (!/^[a-f0-9]{64}$/.test(backup.backupSha256) || !active || active.syncRunId || active.folder !== rollout.folder || (job && job.phase !== "ready") ||
      active.generation !== backup.generation || active.inventoryHash !== backup.inventoryHash || !service?.parityVerifiedAt || !service.parityReportHash ||
      service.publicationId !== active.publicationId || service.generation !== active.generation || service.inventoryHash !== active.inventoryHash)
      throw new Error("The backup, idle Convex catalog and qualified service publication must match exactly.");
    await ctx.db.patch(rollout._id, { convexRetirement: { ...backup, approvedAt: Date.now() } });
    return null;
  },
});

/** Invoke after the service-only publisher has verified its serving receipt. */
export const detachRetiredCatalog = internalMutation({
  args: { ...retirementScope, servicePublicationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rollout = await retirementRollout(ctx, args.societyId);
    const retirement = rollout.convexRetirement;
    if (!retirement || retirement.backupSha256 !== args.backupSha256) throw new Error("Retirement backup mismatch.");
    if (retirement.detachedAt) return null;
    const service = await ctx.db.query("procurementServicePublications").withIndex("by_latest", q => q.eq("societyId", args.societyId).eq("folder", rollout.folder)).order("desc").first();
    const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", args.societyId)).unique();
    if (!service || service.publicationId !== args.servicePublicationId || !active || active.syncRunId || active.folder !== rollout.folder ||
      active.generation !== retirement.generation || active.inventoryHash !== retirement.inventoryHash)
      throw new Error("Check the live service receipt and the backed-up Convex catalog before detaching.");
    await ctx.db.delete(active._id);
    await ctx.db.patch(rollout._id, { convexRetirement: { ...retirement, detachedAt: Date.now() } });
    return null;
  },
});

function retirementRows(ctx: QueryCtx | MutationCtx, societyId: Id<"societies">, table: RetirementTable) {
  // Each allowed index starts with societyId, even though the names differ by table.
  return ctx.db.query(table).withIndex(retirementIndexes[table] as never, q => {
    const scoped = q as unknown as IndexRangeBuilder<{ societyId: Id<"societies"> }, ["societyId"]>;
    return scoped.eq("societyId", societyId);
  });
}

export const retirePage = internalMutation({
  args: { ...retirementScope, table: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ removed: v.number(), cursor: v.string(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const rollout = await retirementRollout(ctx, args.societyId);
    if (!rollout.convexRetirement?.detachedAt || rollout.convexRetirement.backupSha256 !== args.backupSha256 || !Object.hasOwn(retirementIndexes, args.table))
      throw new Error("Retirement requires a detached catalog, matching backup and a mirrored data table.");
    const page = await retirementRows(ctx, args.societyId, args.table as RetirementTable).paginate({
      cursor: args.cursor, numItems: 200, maximumRowsRead: 200, maximumBytesRead: 1_000_000,
    });
    for (const row of page.page) await ctx.db.delete(row._id);
    return { removed: page.page.length, cursor: page.continueCursor, done: page.isDone };
  },
});

export const retirementStatus = internalQuery({
  args: { societyId: v.id("societies") },
  returns: v.object({ approved: v.boolean(), detached: v.boolean(), remainingTables: v.array(v.string()) }),
  handler: async (ctx, { societyId }) => {
    const rollout = await retirementRollout(ctx, societyId);
    const remainingTables: RetirementTable[] = [];
    for (const table of retirementTables) if (await retirementRows(ctx, societyId, table).first()) remainingTables.push(table);
    return { approved: !!rollout.convexRetirement, detached: !!rollout.convexRetirement?.detachedAt, remainingTables };
  },
});
export const page = internalQuery({
  args: { societyId: v.id("societies"), generation: v.string(), table, releaseId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: v.object({ rowsJson: v.string(), isDone: v.boolean(), continueCursor: v.string(), inventoryHash: v.string() }),
  handler: async (ctx, args) => {
    const catalog = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", args.societyId)).unique();
    if (!catalog || catalog.syncRunId || catalog.generation !== args.generation || !catalog.inventoryHash) throw new Error("The comparison generation is no longer serving in Convex.");
    const opts = { ...args.paginationOpts, numItems: Math.min(500, Math.max(1, args.paginationOpts.numItems)), maximumRowsRead: 500, maximumBytesRead: 1_000_000 };
    const storage = catalog.storageGeneration ?? catalog.generation;
    let result;
    if (args.table === "procurementTaxonomyTerms") {
      if (!args.releaseId || !catalog.taxonomyIndexes?.some(index => index.releaseId === args.releaseId)) throw new Error("Choose one of the serving catalog's taxonomy releases.");
      result = await ctx.db.query("procurementTaxonomyTerms").withIndex("by_release_key", q => q.eq("societyId", args.societyId).eq("releaseId", args.releaseId!)).paginate(opts);
    } else if (args.table === "procurementDocuments") result = await ctx.db.query("procurementDocuments").withIndex("by_document_key", q => q.eq("societyId", args.societyId).eq("generation", storage)).paginate(opts);
    else if (args.table === "procurementEvidence") result = await ctx.db.query("procurementEvidence").withIndex("by_record_source", q => q.eq("societyId", args.societyId).eq("generation", storage)).paginate(opts);
    else if (args.table === "procurementDetails") result = await ctx.db.query("procurementDetails").withIndex("by_key", q => q.eq("societyId", args.societyId).eq("generation", storage)).paginate(opts);
    else result = await ctx.db.query("procurementRecords").withIndex("by_key", q => q.eq("societyId", args.societyId).eq("generation", storage)).paginate(opts);
    return { rowsJson: JSON.stringify(result.page.filter((row: any) => !row.archived).map(({ _id, _creationTime, ...row }: any) => ({ ...row, ...(args.table !== "procurementTaxonomyTerms" ? { generation: args.generation } : {}) }))), isDone: result.isDone, continueCursor: result.continueCursor, inventoryHash: catalog.inventoryHash };
  },
});
export const verifyParity = internalMutation({
  args: { societyId: v.id("societies"), folder: v.string(), publicationId: v.string(), inventoryHash: v.string(), reportHash: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    catalogServiceConfiguration(args.societyId);
    if (!/^[a-f0-9]{64}$/.test(args.reportHash)) throw new Error("Retain the complete checksummed parity report first.");
    const publication = await ctx.db.query("procurementServicePublications").withIndex("by_identity", q => q.eq("societyId", args.societyId).eq("folder", args.folder).eq("publicationId", args.publicationId)).unique();
    const convex = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", args.societyId)).unique();
    if (!publication || publication.inventoryHash !== args.inventoryHash || !convex || convex.syncRunId || convex.folder !== args.folder || convex.publicationId !== args.publicationId || convex.inventoryHash !== args.inventoryHash || convex.generation !== publication.generation) throw new Error("Parity can only qualify the exact publication currently serving in both stores.");
    if (publication.parityReportHash && publication.parityReportHash !== args.reportHash) throw new Error("Qualified publication already has different parity evidence.");
    await ctx.db.patch(publication._id, { parityReportHash: args.reportHash, parityVerifiedAt: publication.parityVerifiedAt ?? Date.now() }); return null;
  },
});
