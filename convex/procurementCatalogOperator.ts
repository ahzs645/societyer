/** Administrator CLI only. Bounded parity reads never acquire an importer lease or alter serving data. */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, internalMutation } from "./_generated/server";
import { catalogServiceConfiguration } from "./procurementCatalog";
const table = v.union(v.literal("procurementRecords"), v.literal("procurementDetails"), v.literal("procurementDocuments"), v.literal("procurementEvidence"), v.literal("procurementTaxonomyTerms"));
export const publicationPolicy = internalQuery({
  args: { societyId: v.id("societies") }, returns: v.object({ serviceOnlyAllowed: v.boolean(), fallbackUntil: v.union(v.number(), v.null()) }),
  handler: async (ctx, { societyId }) => {
    catalogServiceConfiguration(societyId);
    const society = await ctx.db.get(societyId), rollout = await ctx.db.query("procurementServiceRollouts").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
    return { serviceOnlyAllowed: society?.integrationSettings?.procurementCatalogSource === "service" && !!rollout && rollout.folder === society.integrationSettings?.procurementReviewFolder && rollout.fallbackUntil <= Date.now() && rollout.qualificationPublications.length === 3, fallbackUntil: rollout?.fallbackUntil ?? null };
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
