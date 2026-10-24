/** Operator-only metadata activation. Public clients cannot write procurement data. */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";
import { procurementPublicationFields, procurementTaxonomyIndexFields, procurementTermFields } from "./tables/procurement";
import { requireMaintenanceLease, withMaintenanceLease } from "./procurementMaintenance";
import { requirePreparedAnalytics } from "./lib/procurementAnalyticsArtifacts";

const tables = ["procurementRecords", "procurementDetails", "procurementDocuments", "procurementEvidence"] as const;
const tableValidator = v.union(v.literal("procurementRecords"), v.literal("procurementDetails"), v.literal("procurementDocuments"), v.literal("procurementEvidence"));
const activation = { ...procurementPublicationFields, societyId: v.id("societies"), generation: v.string(), folder: v.string(), publishedAt: v.string(), counts: v.record(v.string(), v.number()), expected: v.record(v.string(), v.number()),
  profileVersion: v.optional(v.number()), contentHash: v.optional(v.string()), sourceCounts: v.optional(v.record(v.string(), v.number())),
  taxonomyReleases: v.optional(v.array(v.string())), taxonomyCount: v.optional(v.number()),
  taxonomyIndexes: v.optional(v.array(v.object(procurementTaxonomyIndexFields))),
  sourceSnapshotId: v.optional(v.string()), sourceCatalogSha256: v.optional(v.string()),
};

/** Record verified source availability before uploading rows; never writes the active pointer. */
export const beginJob = internalMutation({
  args: { societyId: v.id("societies"), folder: v.string(), generation: v.string(), inventoryHash: v.string(), contentHash: v.string(), publishedAt: v.string(), collectedAt: v.optional(v.string()), complete: v.boolean(), planHash: v.optional(v.string()) },
  returns: v.id("procurementImportJobs"),
  handler: async (ctx, args) => {
    validateWorkspaceProcurementReviewFolder(args.societyId, args.folder);
    const society = await ctx.db.get(args.societyId);
    if (society?.integrationSettings?.procurementReviewFolder !== args.folder || ![args.inventoryHash,args.contentHash].every(hash => /^[a-f0-9]{64}$/.test(hash))) throw new Error("Invalid verified publication job.");
    const prior = await ctx.db.query("procurementImportJobs").withIndex("by_generation", q => q.eq("societyId", args.societyId).eq("generation", args.generation)).unique();
    const pending = await ctx.db.query("procurementImportJobs").withIndex("by_society", q => q.eq("societyId", args.societyId)).order("desc").first();
    if (pending && pending.folder === args.folder && pending._id !== prior?._id && pending.phase !== "ready") throw new Error("Another publication is pending; resume its exact verified export before starting another.");
    if (prior) {
      if (prior.inventoryHash !== args.inventoryHash || prior.contentHash !== args.contentHash || prior.planHash !== args.planHash) throw new Error("Publication job changed; retry the exact verified export.");
      if (prior.phase !== "ready") await ctx.db.patch(prior._id, { phase: "validated", heartbeatAt: Date.now(), error: undefined });
      return prior._id;
    }
    return ctx.db.insert("procurementImportJobs", { ...args, phase: "validated", startedAt: Date.now(), heartbeatAt: Date.now() });
  },
});
export const jobProgress = internalMutation({
  args: { jobId: v.id("procurementImportJobs"), phase: v.union(v.literal("taxonomy"),v.literal("importing"),v.literal("activating"),v.literal("failed")), error: v.optional(v.string()), runId: v.optional(v.id("procurementSyncRuns")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Publication job missing.");
    if (job.phase === "ready") return null;
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (!run || run.societyId !== job.societyId || run.targetHash !== job.contentHash) throw new Error("Publication run mismatch.");
    }
    await ctx.db.patch(job._id, { phase: args.phase, heartbeatAt: Date.now(), error: args.error?.slice(0,2000), ...(args.runId ? {runId:args.runId} : {}) });
    return null;
  },
});

/** Small operator preflight; unchanged publications need no import or validation scan. */
export const state = internalQuery({
  args: { societyId: v.id("societies") },
  returns: v.union(v.null(), v.object({ generation: v.string(), folder: v.string(), publishedAt: v.string(), contentHash: v.optional(v.string()), profileVersion: v.optional(v.number()), inventoryHash: v.optional(v.string()), activatedAt: v.optional(v.number()), updating: v.boolean() })),
  handler: async (ctx, { societyId }) => {
    const row = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
    if (!row) return null;
    return { generation: row.generation, folder: row.folder, publishedAt: row.publishedAt, ...(row.contentHash ? { contentHash: row.contentHash } : {}), ...(row.profileVersion ? { profileVersion: row.profileVersion } : {}), ...(row.inventoryHash ? { inventoryHash: row.inventoryHash } : {}), ...(row.activatedAt ? { activatedAt: row.activatedAt } : {}), updating: !!row.syncRunId };
  },
});

/** Each term is stored once per workspace/release, not once per snapshot. */
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

const taxonomyScope = { societyId: v.id("societies"), ...procurementTaxonomyIndexFields };

/** Reserve one immutable release before a bulk import; concurrent retries cannot append duplicates. */
export const beginTaxonomy = internalMutation({
  args: { ...taxonomyScope, folder: v.string() }, returns: v.union(v.literal("import"), v.literal("resume"), v.literal("reuse")),
  handler: async (ctx, args) => {
    validateWorkspaceProcurementReviewFolder(args.societyId, args.folder);
    const society = await ctx.db.get(args.societyId);
    if (!society || society.integrationSettings?.procurementReviewFolder !== args.folder) throw new Error("Workspace folder changed; taxonomy import refused.");
    if (!Number.isSafeInteger(args.count) || args.count < 1 || args.count > 500000 || !/^[a-f0-9]{64}$/.test(args.contentHash)) throw new Error("Invalid taxonomy release metadata.");
    const prior = await ctx.db.query("procurementTaxonomyReleases").withIndex("by_release", q => q.eq("societyId", args.societyId).eq("releaseId", args.releaseId)).unique();
    if (prior) {
      if (prior.contentHash !== args.contentHash || prior.count !== args.count) throw new Error("Taxonomy release changed in place; publish a new reference release.");
      return prior.status === "ready" ? "reuse" as const : "resume" as const;
    }
    const existing = await ctx.db.query("procurementTaxonomyTerms").withIndex("by_release_key", q => q.eq("societyId", args.societyId).eq("releaseId", args.releaseId)).first();
    const { folder, ...release } = args;
    await ctx.db.insert("procurementTaxonomyReleases", { ...release, status: "importing" });
    return existing ? "resume" as const : "import" as const;
  },
});
export const taxonomyState = internalQuery({
  args: { societyId: v.id("societies"), releaseId: v.string() },
  returns: v.union(v.null(), v.object({ ...procurementTaxonomyIndexFields, status: v.union(v.literal("importing"), v.literal("ready")) })),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("procurementTaxonomyReleases").withIndex("by_release", q => q.eq("societyId", args.societyId).eq("releaseId", args.releaseId)).unique();
    return row ? { releaseId: row.releaseId, contentHash: row.contentHash, count: row.count, status: row.status } : null;
  },
});
export const termsPage = internalQuery({
  args: { societyId: v.id("societies"), releaseId: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ terms: v.array(v.object(procurementTermFields)), cursor: v.string(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("procurementTaxonomyTerms").withIndex("by_release_key", q => q.eq("societyId", args.societyId).eq("releaseId", args.releaseId))
      .paginate({ cursor: args.cursor, numItems: 1000, maximumBytesRead: 2_000_000 });
    return { terms: page.page.map(({ societyId, _id, _creationTime, ...term }) => term), cursor: page.continueCursor, done: page.isDone };
  },
});
export const commitTaxonomy = internalMutation({
  args: taxonomyScope, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("procurementTaxonomyReleases").withIndex("by_release", q => q.eq("societyId", args.societyId).eq("releaseId", args.releaseId)).unique();
    if (!row || row.contentHash !== args.contentHash || row.count !== args.count) throw new Error("Taxonomy reservation mismatch.");
    await ctx.db.patch(row._id, { status: "ready" }); return null;
  },
});
/** Enumerate generations with one indexed seek per generation, not a full count scan. */
export const generations = internalQuery({
  args: { societyId: v.id("societies") },
  returns: v.object({ active: v.union(v.string(), v.null()), generations: v.array(v.string()), truncated: v.boolean() }),
  handler: async (ctx, { societyId }) => {
    const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
    const found = new Set<string>();
    // Include partially retired generations whose list rows are gone but details/files remain.
    for (const table of tables) {
      const index = table === "procurementRecords" || table === "procurementDetails" ? "by_key" : table === "procurementDocuments" ? "by_record" : "by_record_source";
      let after: string | undefined;
      for (let i = 0; i < 21; i++) {
        const row = await ctx.db.query(table).withIndex(index as any, (q: any) => after === undefined ? q.eq("societyId", societyId) : q.eq("societyId", societyId).gt("generation", after)).first();
        if (!row) break;
        if (i === 20) return { active: active?.storageGeneration ?? active?.generation ?? null, generations: [...found].sort(), truncated: true };
        found.add(row.generation); after = row.generation;
        if (found.size > 20) return { active: active?.storageGeneration ?? active?.generation ?? null, generations: [...found].sort(), truncated: true };
      }
    }
    return { active: active?.storageGeneration ?? active?.generation ?? null, generations: [...found].sort(), truncated: false };
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
  args: { ...activation, reuseActive: v.optional(v.boolean()), restoreFromBackup: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    validateWorkspaceProcurementReviewFolder(args.societyId, args.folder);
    const society = await ctx.db.get(args.societyId);
    if (!society || society.integrationSettings?.procurementReviewFolder !== args.folder) throw new Error("Workspace folder changed; activation refused.");
    const prior = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", args.societyId)).unique();
    if (prior?.syncRunId) throw new Error("An incremental import is in progress; resume it before activation.");
    const {reuseActive,restoreFromBackup,...metadata} = args;
    if (restoreFromBackup && (args.restoration?.backupSha256 !== restoreFromBackup || !/^[a-f0-9]{64}$/.test(restoreFromBackup))) throw new Error("Restore backup verification does not match this publication.");
    if (reuseActive && (!prior || prior.contentHash !== args.contentHash)) throw new Error("Only verified unchanged content may reuse the active storage generation.");
    await requirePreparedAnalytics(ctx, args);
    const baseCatalog = { ...metadata, activatedAt: Date.now() };
    const catalog = reuseActive && prior ? { ...baseCatalog, storageGeneration: prior.storageGeneration ?? prior.generation } : prior?.generation === args.generation && prior.storageGeneration ? { ...baseCatalog, storageGeneration: prior.storageGeneration } : baseCatalog;
    // Replacement also clears compact-only metadata when deliberately rolling back a legacy import.
    if (prior) await ctx.db.replace(prior._id, catalog);
    else await ctx.db.insert("procurementCatalogs", catalog);
    const job = await ctx.db.query("procurementImportJobs").withIndex("by_generation", q => q.eq("societyId", args.societyId).eq("generation", args.generation)).unique();
    if (job) await ctx.db.patch(job._id, { phase: "ready", activatedAt: Date.now(), heartbeatAt: Date.now(), error: undefined });
    if (prior?.generation !== args.generation || prior?.contentHash !== args.contentHash)
      await ctx.scheduler.runAfter(0, internal.procurementAnalytics.prepare, { societyId: args.societyId, generation: args.generation });
    return null;
  },
});

export const activate = internalAction({
  args: { ...activation, restoreFromBackup: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    validateWorkspaceProcurementReviewFolder(args.societyId, args.folder);
    if (args.profileVersion !== undefined && (args.profileVersion !== 2 || Object.keys(args.counts).some(kind => kind !== "opportunity" && kind !== "award"))) throw new Error("Compact imports contain only opportunities and awards.");
    const prior = await ctx.runQuery(internal.procurementImport.state,{societyId:args.societyId});
    const verifiedRestore = args.restoration && /^[a-f0-9]{64}$/.test(args.restoration.backupSha256) && args.restoreFromBackup === args.restoration.backupSha256;
    if (args.restoration && !verifiedRestore) throw new Error("A deliberate restore requires the verified original backup.");
    if (args.schemaVersion === 1 && prior && prior.contentHash !== args.contentHash && !verifiedRestore && !(args.coverage?.complete === true && args.coverage.sources.every(source => source.complete))) throw new Error("Replacing an active catalog requires complete source/window coverage.");
    if (args.profileVersion === 2) {
      if (!args.sourceSnapshotId || !/^[a-f0-9]{64}$/.test(args.sourceCatalogSha256 ?? "")) throw new Error("Compact imports must retain source snapshot and checksum provenance.");
      const indexes = args.taxonomyIndexes ?? [];
      if (indexes.length > 32 || new Set(indexes.map(x => x.releaseId)).size !== indexes.length || indexes.reduce((n, x) => n + x.count, 0) !== args.taxonomyCount) throw new Error("Invalid taxonomy release inventory.");
      for (const index of indexes) {
        const release = await ctx.runQuery(internal.procurementImport.taxonomyState, { societyId: args.societyId, releaseId: index.releaseId });
        if (!release || release.status !== "ready" || release.count !== index.count || release.contentHash !== index.contentHash) throw new Error("Taxonomy release is not verified and ready.");
      }
    }
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
  args: { societyId: v.id("societies"), generation: v.string(), table: tableValidator, maintenanceOwner: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireMaintenanceLease(ctx, args.societyId, args.maintenanceOwner);
    const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", args.societyId)).unique();
    if ((active?.storageGeneration ?? active?.generation) === args.generation) throw new Error("Cannot purge the active generation.");
    const index = args.table === "procurementRecords" || args.table === "procurementDetails" ? "by_key" : args.table === "procurementDocuments" ? "by_record" : "by_record_source";
    const page = await ctx.db.query(args.table).withIndex(index as any, (q: any) => q.eq("societyId", args.societyId).eq("generation", args.generation))
      .paginate({ cursor: null, numItems: 100, maximumRowsRead: 100, maximumBytesRead: 500_000 });
    for (const row of page.page) await ctx.db.delete(row._id);
    return page.page.length;
  },
});

const retirementRange = { lowerKey: v.string(), upperKey: v.union(v.string(), v.null()) };
/** Bound the index range as well as the page. This also skips large already-deleted prefixes on retries. */
export const purgeRangePage = internalMutation({
  args: { societyId: v.id("societies"), generation: v.string(), table: tableValidator, ...retirementRange, cursor: v.union(v.string(), v.null()), maintenanceOwner: v.optional(v.string()) },
  returns: v.object({ removed: v.number(), cursor: v.string(), done: v.boolean() }),
  handler: async (ctx, args) => {
    await requireMaintenanceLease(ctx, args.societyId, args.maintenanceOwner);
    if (args.upperKey !== null && args.lowerKey >= args.upperKey) throw new Error("Invalid retirement range.");
    const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", args.societyId)).unique();
    if ((active?.storageGeneration ?? active?.generation) === args.generation) throw new Error("Cannot purge the active generation.");
    const index = args.table === "procurementRecords" || args.table === "procurementDetails" ? "by_key" : args.table === "procurementDocuments" ? "by_record" : "by_record_source";
    const page = await ctx.db.query(args.table).withIndex(index as any, (q: any) => {
      const range = q.eq("societyId", args.societyId).eq("generation", args.generation).gte("recordKey", args.lowerKey);
      return args.upperKey === null ? range : range.lt("recordKey", args.upperKey);
    }).paginate({ cursor: args.cursor, numItems: 100, maximumRowsRead: 100, maximumBytesRead: 500_000 });
    for (const row of page.page) await ctx.db.delete(row._id);
    return { removed: page.page.length, cursor: page.continueCursor, done: page.isDone };
  },
});
export const purgeRanges = internalAction({
  args: { societyId: v.id("societies"), generation: v.string(), table: tableValidator, ranges: v.array(v.object(retirementRange)), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ removed: v.number(), completedRanges: v.number(), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    if (!args.ranges.length || args.ranges.length > 10) throw new Error("Retire one to ten verified backup ranges per request.");
    return withMaintenanceLease(ctx, args.societyId, "retire backed-up ranges", async maintenanceOwner => {
      let cursor = args.cursor, removed = 0, completedRanges = 0;
      for (let step = 0; step < 10 && completedRanges < args.ranges.length; step++) {
        const page: { removed: number; cursor: string; done: boolean } = await ctx.runMutation(internal.procurementImport.purgeRangePage, { societyId: args.societyId, generation: args.generation, table: args.table, ...args.ranges[completedRanges], cursor, maintenanceOwner });
        removed += page.removed;
        if (page.done) { completedRanges++; cursor = null; } else cursor = page.cursor;
      }
      return { removed, completedRanges, cursor };
    });
  },
});

/** Legacy operator API; prefer the backup-bounded retirement tool for large catalogs. */
export const purgeGeneration = internalAction({
  args: { societyId: v.id("societies"), generation: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    return withMaintenanceLease(ctx, args.societyId, "retire legacy generation", async (maintenanceOwner, renew) => {
      let pages = 0;
      for (const table of tables) {
        for (;;) {
          if (pages++ % 20 === 0) await renew();
          if (await ctx.runMutation(internal.procurementImport.purgePage, { ...args, table, maintenanceOwner }) === 0) break;
        }
      }
      return null;
    });
  },
});
