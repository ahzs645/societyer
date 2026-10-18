/** Operator-only metadata activation. Public clients cannot write procurement data. */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";

const tables = ["procurementRecords", "procurementDetails", "procurementDocuments", "procurementEvidence"] as const;
const tableValidator = v.union(v.literal("procurementRecords"), v.literal("procurementDetails"), v.literal("procurementDocuments"), v.literal("procurementEvidence"));
const activation = { societyId: v.id("societies"), generation: v.string(), folder: v.string(), publishedAt: v.string(), counts: v.record(v.string(), v.number()), expected: v.record(v.string(), v.number()) };

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
    if (prior) await ctx.db.patch(prior._id, catalog);
    else await ctx.db.insert("procurementCatalogs", catalog);
    return null;
  },
});

export const activate = internalAction({
  args: activation, returns: v.null(),
  handler: async (ctx, args) => {
    validateWorkspaceProcurementReviewFolder(args.societyId, args.folder);
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
      .paginate({ cursor: null, numItems: 100, maximumBytesRead: 2_000_000 });
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
