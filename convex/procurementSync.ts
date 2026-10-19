/** Operator-only, resumable changed-row application. Readers pause while a plan is incomplete. */
import type { Id } from "./_generated/dataModel";
import { makeFunctionReference } from "convex/server";
import { listRow } from "./procurementReview";
import { toNoticeRow } from "../shared/procurementNoticeRow";
import {
  procurementGrams,
  procurementIndexCorpus,
} from "../shared/procurementSearchText";
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";
const table = v.union(
  v.literal("procurementRecords"),
  v.literal("procurementDetails"),
  v.literal("procurementDocuments"),
  v.literal("procurementEvidence"),
);
export const begin = internalMutation({
  args: {
    societyId: v.id("societies"),
    folder: v.string(),
    baseHash: v.string(),
    targetHash: v.string(),
    planHash: v.string(),
    operations: v.number(),
  },
  returns: v.object({
    runId: v.id("procurementSyncRuns"),
    applied: v.number(),
    nextBatch: v.number(),
    completed: v.boolean(),
  }),
  handler: async (ctx, a) => {
    validateWorkspaceProcurementReviewFolder(a.societyId, a.folder);
    if (
      ![a.baseHash, a.targetHash, a.planHash].every((h) =>
        /^[a-f0-9]{64}$/.test(h),
      ) ||
      !Number.isSafeInteger(a.operations) ||
      a.operations < 0
    )
      throw new Error("Invalid incremental plan.");
    const c = await ctx.db
      .query("procurementCatalogs")
      .withIndex("by_society", (q) => q.eq("societyId", a.societyId))
      .unique();
    const society = await ctx.db.get(a.societyId);
    if (
      !c ||
      c.folder !== a.folder ||
      society?.integrationSettings?.procurementReviewFolder !== a.folder
    )
      throw new Error("Workspace folder changed.");
    if (c.syncRunId) {
      const run = await ctx.db.get(c.syncRunId);
      if (
        !run ||
        run.planHash !== a.planHash ||
        run.targetHash !== a.targetHash ||
        run.baseHash !== a.baseHash ||
        run.operations !== a.operations
      )
        throw new Error(
          "Another incremental plan is in progress; resume its exact export.",
        );
      return {
        runId: run._id,
        applied: run.applied,
        nextBatch: run.nextBatch,
        completed: run.completed,
      };
    }
    if (c.contentHash !== a.baseHash)
      throw new Error(
        "Stale baseline; no data changed. Use the last successful export.",
      );
    const runId = await ctx.db.insert("procurementSyncRuns", {
      societyId: a.societyId,
      baseHash: a.baseHash,
      targetHash: a.targetHash,
      planHash: a.planHash,
      operations: a.operations,
      counts: c.counts,
      applied: 0,
      nextBatch: 0,
      completed: false,
      changedAt: Date.now(),
    });
    await ctx.db.patch(c._id, { syncRunId: runId });
    return { runId, applied: 0, nextBatch: 0, completed: false };
  },
});
export const applyBatch = internalMutation({
  args: {
    runId: v.id("procurementSyncRuns"),
    planHash: v.string(),
    batch: v.number(),
    operations: v.array(
      v.object({
        table,
        key: v.string(),
        recordKey: v.string(),
        row: v.union(v.null(), v.string()),
        before: v.union(v.null(), v.string()),
      }),
    ),
  },
  returns: v.object({ applied: v.number(), nextBatch: v.number() }),
  handler: async (ctx, a) => {
    if (
      a.operations.length < 1 ||
      a.operations.length > 50 ||
      JSON.stringify(a.operations).length > 1_500_000
    )
      throw new Error("Incremental batch exceeds budget.");
    const run = await ctx.db.get(a.runId);
    if (!run || run.completed || run.planHash !== a.planHash)
      throw new Error("Invalid or completed incremental run.");
    const c = await ctx.db
      .query("procurementCatalogs")
      .withIndex("by_society", (q) => q.eq("societyId", run.societyId))
      .unique();
    const society = await ctx.db.get(run.societyId);
    if (
      c?.syncRunId !== run._id ||
      c.folder !== society?.integrationSettings?.procurementReviewFolder
    )
      throw new Error("Import lock or workspace folder changed.");
    if (a.batch < run.nextBatch)
      return { applied: run.applied, nextBatch: run.nextBatch };
    if (
      a.batch !== run.nextBatch ||
      run.applied + a.operations.length > run.operations
    )
      throw new Error("Out-of-order incremental batch.");
    const generation = c.storageGeneration ?? c.generation;
    const counts = { ...run.counts };
    const canonical = (value: any): string =>
      JSON.stringify(value, (_k, v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(
              Object.entries(v).sort(([a], [b]) =>
                a < b ? -1 : a > b ? 1 : 0,
              ),
            )
          : v,
      );
    const clean = (row: any) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([k]) =>
            ![
              "_id",
              "_creationTime",
              "societyId",
              "generation",
              "archived",
              "syncKey",
            ].includes(k),
        ),
      );
    for (const op of a.operations) {
      const row = op.row === null ? null : JSON.parse(op.row),
        before = op.before === null ? null : JSON.parse(op.before),
        identity = row ?? before;
      if (
        !identity ||
        identity.recordKey !== op.recordKey ||
        identity.societyId !== run.societyId ||
        (row &&
          ("_id" in row ||
            "_creationTime" in row ||
            "archived" in row ||
            "syncKey" in row))
      )
        throw new Error("Invalid scoped incremental row.");
      let old;
      if (
        op.table === "procurementRecords" ||
        op.table === "procurementDetails"
      ) {
        if (op.key !== op.recordKey) throw new Error("Record key mismatch.");
        old = await ctx.db
          .query(op.table)
          .withIndex("by_key", (q) =>
            q
              .eq("societyId", run.societyId)
              .eq("generation", generation)
              .eq("recordKey", op.key),
          )
          .unique();
      } else if (op.table === "procurementDocuments") {
        if (op.key !== identity.documentKey)
          throw new Error("Document key mismatch.");
        old = await ctx.db
          .query("procurementDocuments")
          .withIndex("by_document_key", (q) =>
            q
              .eq("societyId", run.societyId)
              .eq("generation", generation)
              .eq("documentKey", op.key),
          )
          .unique();
      } else {
        old = await ctx.db
          .query("procurementEvidence")
          .withIndex("by_sync_key", (q) =>
            q
              .eq("societyId", run.societyId)
              .eq("generation", generation)
              .eq("syncKey", op.key),
          )
          .unique();
        if (!old) {
          const candidates = await ctx.db
            .query("procurementEvidence")
            .withIndex("by_record_source", (q) =>
              q
                .eq("societyId", run.societyId)
                .eq("generation", generation)
                .eq("recordKey", op.recordKey)
                .eq("source", identity.source),
            )
            .take(251);
          if (candidates.length > 250)
            throw new Error(
              "Evidence lookup exceeds budget; migrate this record separately.",
            );
          old = candidates.find((r) => r.dataJson === (before ?? row).dataJson);
        }
      }
      if (
        before &&
        (!old ||
          old.archived ||
          canonical(clean(old)) !== canonical(clean(before)))
      )
        throw new Error(
          "Baseline conflict; refusing to overwrite untracked changes.",
        );
      if (!before && old && !old.archived)
        throw new Error("Unexpected live row at new source key.");
      if (op.table === "procurementRecords") {
        if (before) counts[before.kind] = (counts[before.kind] ?? 0) - 1;
        if (row) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
      }
      if (op.table === "procurementRecords") {
        const entry = await ctx.db
          .query("procurementSearch")
          .withIndex("by_key", (q) =>
            q
              .eq("societyId", run.societyId)
              .eq("generation", generation)
              .eq("recordKey", op.recordKey),
          )
          .unique();
        const data = {
          societyId: run.societyId,
          generation,
          recordKey: op.recordKey,
          kind: identity.kind,
          active: !!row,
          grams: row
            ? procurementGrams(
                procurementIndexCorpus(toNoticeRow(listRow(row), 0)),
              )
            : (entry?.grams ?? ""),
        };
        if (entry) await ctx.db.replace(entry._id, data);
        else await ctx.db.insert("procurementSearch", data);
      }
      if (op.row === null) {
        if (!old)
          throw new Error(
            "Baseline row missing; refusing to silently discard information.",
          );
        await ctx.db.patch(old._id, { archived: true });
      } else {
        const data = {
          ...row,
          societyId: run.societyId,
          generation,
          ...(op.table === "procurementEvidence" ? { syncKey: op.key } : {}),
        };
        if (old)
          await ctx.db.replace(old._id as Id<"procurementRecords">, data);
        else await ctx.db.insert(op.table as "procurementRecords", data);
      }
    }
    const progress = {
      applied: run.applied + a.operations.length,
      nextBatch: run.nextBatch + 1,
    };
    await ctx.db.patch(run._id, { ...progress, counts, changedAt: Date.now() });
    return progress;
  },
});
export const finish = internalMutation({
  args: {
    runId: v.id("procurementSyncRuns"),
    planHash: v.string(),
    generation: v.string(),
    publishedAt: v.string(),
    counts: v.record(v.string(), v.number()),
    sourceCounts: v.record(v.string(), v.number()),
    sourceSnapshotId: v.string(),
    sourceCatalogSha256: v.string(),
    taxonomyIndexes: v.array(
      v.object({
        releaseId: v.string(),
        contentHash: v.string(),
        count: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const run = await ctx.db.get(a.runId);
    if (!run || run.planHash !== a.planHash)
      throw new Error("Invalid incremental run.");
    if (run.completed) return null;
    if (run.applied !== run.operations)
      throw new Error(
        "Incremental plan is incomplete; resume before activation.",
      );
    const kinds = new Set([
      ...Object.keys(run.counts),
      ...Object.keys(a.counts),
    ]);
    if ([...kinds].some((k) => (run.counts[k] ?? 0) !== (a.counts[k] ?? 0)))
      throw new Error("Target notice counts do not match applied changes.");
    const c = await ctx.db
      .query("procurementCatalogs")
      .withIndex("by_society", (q) => q.eq("societyId", run.societyId))
      .unique();
    const society = await ctx.db.get(run.societyId);
    if (
      !c ||
      c.syncRunId !== run._id ||
      society?.integrationSettings?.procurementReviewFolder !== c.folder
    )
      throw new Error("Import lock or workspace folder changed.");
    for (const index of a.taxonomyIndexes) {
      const release = await ctx.db
        .query("procurementTaxonomyReleases")
        .withIndex("by_release", (q) =>
          q.eq("societyId", run.societyId).eq("releaseId", index.releaseId),
        )
        .unique();
      if (
        !release ||
        release.status !== "ready" ||
        release.contentHash !== index.contentHash ||
        release.count !== index.count
      )
        throw new Error("Taxonomy release is not verified.");
    }
    await ctx.db.patch(c._id, {
      storageGeneration: c.storageGeneration ?? c.generation,
      generation: a.generation,
      publishedAt: a.publishedAt,
      counts: a.counts,
      sourceCounts: a.sourceCounts,
      sourceSnapshotId: a.sourceSnapshotId,
      sourceCatalogSha256: a.sourceCatalogSha256,
      contentHash: run.targetHash,
      taxonomyIndexes: a.taxonomyIndexes,
      taxonomyReleases: a.taxonomyIndexes.map((r) => r.releaseId),
      taxonomyCount: a.taxonomyIndexes.reduce((n, r) => n + r.count, 0),
      syncRunId: undefined,
    });
    await ctx.db.patch(run._id, { completed: true, changedAt: Date.now() });
    return null;
  },
});

/** One-off materialization of the search projection; a new import updates only changed notices. */
export const indexSearchPage = internalMutation({
  args: { societyId: v.id("societies"), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    cursor: v.string(),
    done: v.boolean(),
    rows: v.number(),
  }),
  handler: async (ctx, a) => {
    const c = await ctx.db
      .query("procurementCatalogs")
      .withIndex("by_society", (q) => q.eq("societyId", a.societyId))
      .unique();
    if (!c || c.syncRunId) throw new Error("Catalog unavailable or updating.");
    const generation = c.storageGeneration ?? c.generation;
    const page = await ctx.db
      .query("procurementRecords")
      .withIndex("by_key", (q) =>
        q.eq("societyId", a.societyId).eq("generation", generation),
      )
      .paginate({
        numItems: 100,
        cursor: a.cursor,
        maximumRowsRead: 100,
        maximumBytesRead: 1000000,
      });
    for (const row of page.page) {
      const entry = await ctx.db
        .query("procurementSearch")
        .withIndex("by_key", (q) =>
          q
            .eq("societyId", a.societyId)
            .eq("generation", generation)
            .eq("recordKey", row.recordKey),
        )
        .unique();
      const data = {
        societyId: a.societyId,
        generation,
        recordKey: row.recordKey,
        kind: row.kind,
        active: !row.archived,
        grams: procurementGrams(
          procurementIndexCorpus(toNoticeRow(listRow(row), 0)),
        ),
      };
      if (!entry) await ctx.db.insert("procurementSearch", data);
      else if (entry.grams !== data.grams || entry.active !== data.active)
        await ctx.db.replace(entry._id, data);
    }
    if (page.isDone) await ctx.db.patch(c._id, { searchReady: true });
    return {
      cursor: page.continueCursor,
      done: page.isDone,
      rows: page.page.length,
    };
  },
});
export const indexSearchSlice = internalAction({
  args: { societyId: v.id("societies"), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    cursor: v.string(),
    done: v.boolean(),
    rows: v.number(),
  }),
  handler: async (ctx, a) => {
    let cursor = a.cursor,
      rows = 0;
    for (let i = 0; i < 10; i++) {
      const result: { cursor: string; done: boolean; rows: number } =
        await ctx.runMutation(
          makeFunctionReference<"mutation">("procurementSync:indexSearchPage"),
          { societyId: a.societyId, cursor },
        );
      rows += result.rows;
      cursor = result.cursor;
      if (result.done) return { cursor, done: true, rows };
    }
    return { cursor: cursor!, done: false, rows };
  },
});
