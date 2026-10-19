/** Operator-only metadata activation. Public clients cannot write procurement data. */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";
import { procurementTermFields } from "./tables/procurement";

const tables = ["procurementRecords", "procurementDetails", "procurementDocuments", "procurementEvidence"] as const;
const tableValidator = v.union(v.literal("procurementRecords"), v.literal("procurementDetails"), v.literal("procurementDocuments"), v.literal("procurementEvidence"));
const activation = { societyId: v.id("societies"), generation: v.string(), folder: v.string(), publishedAt: v.string(), counts: v.record(v.string(), v.number()), expected: v.record(v.string(), v.number()),
  profileVersion: v.optional(v.number()), contentHash: v.optional(v.string()), sourceCounts: v.optional(v.record(v.string(), v.number())),
  taxonomyReleases: v.optional(v.array(v.string())), taxonomyCount: v.optional(v.number()),
};

/** Small operator preflight; unchanged publications need no import or validation scan. */
export const state = internalQuery({
  args: { societyId: v.id("societies") },
  returns: v.union(v.null(), v.object({ generation: v.string(), folder: v.string(), publishedAt: v.string(), contentHash: v.optional(v.string()), profileVersion: v.optional(v.number()) })),
  handler: async (ctx, { societyId }) => {
    const row = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
    if (!row) return null;
    return { generation: row.generation, folder: row.folder, publishedAt: row.publishedAt, ...(row.contentHash ? { contentHash: row.contentHash } : {}), ...(row.profileVersion ? { profileVersion: row.profileVersion } : {}) };
  },
});

/** Each referenced term is stored once per workspace/release, not once per snapshot. */
export const importTerms = internalMutation({
  args: { societyId: v.id("societies"), folder: v.string(), terms: v.array(v.object(procurementTermFields)) },
  returns: v.object({ inserted: v.number(), reused: v.number() }),
  handler: async (ctx, { societyId, folder, terms }) => {
    validateWorkspaceProcurementReviewFolder(societyId, folder);
    const society = await ctx.db.get(societyId);
    if (!society || society.integrationSettings?.procurementReviewFolder !== folder) throw new Error("Workspace folder changed; taxonomy import refused.");
    if (terms.length > 150) throw new Error("Import at most 150 terms per batch.");
    let inserted = 0, reused = 0;
    const seen = new Set<string>();
    for (const term of terms) {
      const key = `${term.releaseId}\0${term.key}`;
      if (seen.has(key)) throw new Error("Duplicate taxonomy key in batch.");
      seen.add(key);
      const prior = await ctx.db.query("procurementTaxonomyTerms").withIndex("by_release_key", q => q.eq("societyId", societyId).eq("releaseId", term.releaseId).eq("key", term.key)).unique();
      if (prior) {
        if ((Object.keys(procurementTermFields) as (keyof typeof term)[]).some(field => prior[field] !== term[field])) throw new Error("Taxonomy release changed in place; publish a new reference release.");
        reused++;
      } else { await ctx.db.insert("procurementTaxonomyTerms", { societyId, ...term }); inserted++; }
    }
    return { inserted, reused };
  },
});

/** Enumerate generations with one indexed seek per generation, not a full count scan. */
export const generations = internalQuery({
  args: { societyId: v.id("societies") },
  returns: v.object({ active: v.union(v.string(), v.null()), generations: v.array(v.string()), truncated: v.boolean() }),
  handler: async (ctx, { societyId }) => {
    const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
    const generations: string[] = [];
    let after: string | undefined;
    for (let i = 0; i < 21; i++) {
      const row = await ctx.db.query("procurementRecords").withIndex("by_key", q => after === undefined ? q.eq("societyId", societyId) : q.eq("societyId", societyId).gt("generation", after)).first();
      if (!row) return { active: active?.generation ?? null, generations, truncated: false };
      if (i === 20) return { active: active?.generation ?? null, generations, truncated: true };
      generations.push(row.generation); after = row.generation;
    }
    return { active: active?.generation ?? null, generations, truncated: true };
  },
});

export const countPage = internalQuery({
  args: { societyId: v.id("societies"), generation: v.string(), table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ count: v.number(), cursor: v.string(), done: v.boolean() }),
  handler: async (ctx, args) => {
    // Every index begins with workspace + immutable generation.
    const index = args.table === "procurementRecords" || args.table === "procurementDetails" ? "by_key" : args.table === "procurementDocuments" ? "by_record" : "by_record_source";
    const page = await ctx.db.query(args.table).withIndex(index as any, (q: any) => q.eq("societyId", args.societyId).eq("generation", args.generation))
      .paginate({ cursor: args.cursor, numItems: 200, maximumBytesRead: 2_000_000 });
    return { count: page.page.length, cursor: page.continueCursor, done: page.isDone };
  },
});

export const commit = internalMutation({
  args: activation, returns: v.null(),
  handler: async (ctx, args) => {
    validateWorkspaceProcurementReviewFolder(args.societyId, args.folder);
    const society = await ctx.db.get(args.societyId);
    if (!society || society.integrationSettings?.procurementReviewFolder !== args.folder) throw new Error("Workspace folder changed; activation refused.");
    const prior = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", args.societyId)).unique();
    const { expected, ...catalog } = args;
    // Replacement also clears compact-only metadata when deliberately rolling back a legacy import.
    if (prior) await ctx.db.replace(prior._id, catalog);
    else await ctx.db.insert("procurementCatalogs", catalog);
    return null;
  },
});

export const activate = internalAction({
  args: activation, returns: v.null(),
  handler: async (ctx, args) => {
    validateWorkspaceProcurementReviewFolder(args.societyId, args.folder);
    if (args.profileVersion !== undefined && (args.profileVersion !== 2 || Object.keys(args.counts).some(kind => kind !== "opportunity" && kind !== "award"))) throw new Error("Compact imports contain only opportunities and awards.");
    const expectedRecords = Object.values(args.counts).reduce((sum, value) => sum + value, 0);
    if (args.expected.procurementRecords !== expectedRecords || args.expected.procurementDetails !== expectedRecords) throw new Error("Record counts do not match the source manifest.");
    for (const table of tables) {
      let cursor: string | null = null; let total = 0;
      for (;;) {
        const page: { count: number; cursor: string; done: boolean } = await ctx.runQuery(internal.procurementImport.countPage, { societyId: args.societyId, generation: args.generation, table, cursor });
        total += page.count;
        if (total > (args.expected[table] ?? 0)) throw new Error(`${table}: duplicate or unexpected generation rows. Activation refused.`);
        if (page.done) break;
        cursor = page.cursor;
      }
      if (total !== (args.expected[table] ?? 0)) throw new Error(`${table}: import is incomplete. Activation refused.`);
    }
    await ctx.runMutation(internal.procurementImport.commit, args);
    return null;
  },
});

export const purgePage = internalMutation({
  args: { societyId: v.id("societies"), generation: v.string(), table: tableValidator },
  returns: v.number(),
  handler: async (ctx, args) => {
    const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", args.societyId)).unique();
    if (active?.generation === args.generation) throw new Error("Cannot purge the active generation.");
    const index = args.table === "procurementRecords" || args.table === "procurementDetails" ? "by_key" : args.table === "procurementDocuments" ? "by_record" : "by_record_source";
    const page = await ctx.db.query(args.table).withIndex(index as any, (q: any) => q.eq("societyId", args.societyId).eq("generation", args.generation))
      .paginate({ cursor: null, numItems: 500, maximumBytesRead: 2_000_000 });
    for (const row of page.page) await ctx.db.delete(row._id);
    return page.page.length;
  },
});

export const purgeGeneration = internalAction({
  args: { societyId: v.id("societies"), generation: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    for (const table of tables) {
      while (await ctx.runMutation(internal.procurementImport.purgePage, { ...args, table }) > 0) { /* bounded, checkpointed deletes */ }
    }
    return null;
  },
});
