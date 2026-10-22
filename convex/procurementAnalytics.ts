/** Publication-scoped metrics. Only controlled server jobs read full inputs; clients receive bounded results. */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { activeCatalog, listRow, listRowFields } from "./procurementReview";
import { analysisIdentity, normalizeAnalysisRequest, PROCUREMENT_MAPPING_VERSION, PROCUREMENT_METRIC_VERSION } from "../shared/procurementAnalytics";
import { PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE } from "../shared/deploymentCapabilities";

const scope = { societyId: v.id("societies"), generation: v.string() };
const args = { ...scope, request: v.string(), asOf: v.number() };
const jobs = (internal as any).procurementAnalytics;
const response = v.object({ state: v.union(v.literal("preparing"), v.literal("ready"), v.literal("failed")), resultJson: v.union(v.string(), v.null()), error: v.union(v.string(), v.null()), computedAt: v.union(v.number(), v.null()), asOf: v.number(), metricVersion: v.string(), mappingVersion: v.string() });
async function backgroundCatalog(ctx: Parameters<typeof activeCatalog>[0], societyId: Id<"societies">) {
  try { return await activeCatalog(ctx, societyId); }
  catch (error) {
    if ((error as any)?.data?.code === "MODULE_DISABLED" || (error instanceof Error && error.message === PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE)) return null;
    throw error;
  }
}

function normalized(request: string, asOf: number) {
  if (!Number.isFinite(asOf) || Math.abs(asOf - Date.now()) > 2 * 86_400_000) throw new Error("Refresh the analysis clock.");
  const parsed = normalizeAnalysisRequest(request);
  return { request: JSON.stringify(parsed), key: analysisIdentity(parsed, asOf) };
}
async function reserve(ctx: MutationCtx, societyId: Id<"societies">, generation: string, request: string, asOf: number) {
  const n = normalized(request, asOf);
  const existing = await ctx.db.query("procurementAnalytics").withIndex("by_society_generation_key", q => q.eq("societyId", societyId).eq("generation", generation).eq("key", n.key)).unique();
  if (existing && ((existing.state === "ready" && (!existing.validUntil || asOf < existing.validUntil)) || (existing.state === "preparing" && Date.now() - existing.startedAt < 10 * 60_000))) return;
  // One durable reservation per exact publication/filter/metric/clock key. A stalled action can be retried.
  const id = existing?._id ?? await ctx.db.insert("procurementAnalytics", { societyId, generation, ...n, asOf, state: "preparing", startedAt: Date.now(), expiresAt: Date.now() + 2 * 86_400_000 });
  if (existing) await ctx.db.patch(id, { state: "preparing", startedAt: Date.now(), asOf, error: undefined, resultJson: undefined, validUntil: undefined });
  await ctx.scheduler.runAfter(0, jobs.compute, { id });
}

export const get = authorizedQuery("procurementAnalytics:get", query)({
  args, returns: response,
  handler: async (ctx, a) => {
    const active = await activeCatalog(ctx, a.societyId);
    if (!active || active.generation !== a.generation) throw new Error("The publication changed. Refresh procurement.");
    const n = normalized(a.request, a.asOf);
    const row = await ctx.db.query("procurementAnalytics").withIndex("by_society_generation_key", q => q.eq("societyId", a.societyId).eq("generation", a.generation).eq("key", n.key)).unique();
    const stalled = row?.state === "preparing" && Date.now() - row.startedAt >= 10 * 60_000;
    const expired = !!row?.validUntil && a.asOf >= row.validUntil;
    return { state: stalled ? "failed" as const : expired ? "preparing" as const : row?.state ?? "preparing" as const, resultJson: expired ? null : row?.resultJson ?? null, error: stalled ? "Analysis preparation stopped. Retry to resume." : row?.error ?? null, computedAt: row?.computedAt ?? null, asOf: row?.asOf ?? a.asOf, metricVersion: PROCUREMENT_METRIC_VERSION, mappingVersion: PROCUREMENT_MAPPING_VERSION };
  },
});
export const request = authorizedMutation("procurementAnalytics:request", mutation)({
  args, returns: v.null(),
  handler: async (ctx, a) => {
    const active = await activeCatalog(ctx, a.societyId);
    if (!active || active.generation !== a.generation) throw new Error("The publication changed. Refresh procurement.");
    await reserve(ctx, a.societyId, a.generation, a.request, a.asOf);
    return null;
  },
});

export const inputPage = internalQuery({
  args: { ...scope, table: v.union(v.literal("award"), v.literal("opportunity"), v.literal("evidence")), paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(v.union(v.object(listRowFields), v.object({ recordKey: v.string(), source: v.string(), dataJson: v.string() }))), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, a) => {
    const active = await activeCatalog(ctx, a.societyId);
    if (!active || active.generation !== a.generation) throw new Error("Publication changed during analytical preparation.");
    const generation = active.storageGeneration ?? active.generation;
    const opts = { ...a.paginationOpts, numItems: 500, maximumRowsRead: 500, maximumBytesRead: 2_000_000 };
    if (a.table === "evidence") {
      const page = await ctx.db.query("procurementEvidence").withIndex("by_record_source", q => q.eq("societyId", a.societyId).eq("generation", generation)).paginate(opts);
      return { page: page.page.filter(r => !r.archived).map(r => ({ recordKey: r.recordKey, source: r.source, dataJson: r.dataJson })), isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query("procurementRecords").withIndex("by_live_kind_date", q => q.eq("societyId", a.societyId).eq("generation", generation).eq("archived", undefined).eq("kind", a.table as "award" | "opportunity")).paginate(opts);
    return { page: page.page.map(listRow), isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
export const job = internalQuery({ args: { id: v.id("procurementAnalytics") }, returns: v.any(), handler: (ctx, a) => ctx.db.get(a.id) });
export const publication = internalQuery({
  args: scope, returns: v.object({ counts: v.record(v.string(), v.number()), evidenceCount: v.union(v.number(), v.null()), verified: v.boolean(), sourceComplete: v.boolean() }),
  handler: async (ctx, a) => {
    const active = await activeCatalog(ctx, a.societyId);
    if (!active || active.generation !== a.generation) throw new Error("Publication changed during analytical preparation.");
    return { counts: active.counts, evidenceCount: active.expected?.procurementEvidence ?? active.tables?.procurementEvidence?.rowCount ?? null, verified: !!active.inventoryHash, sourceComplete: active.coverage?.complete ?? false };
  },
});
export const finish = internalMutation({
  args: { id: v.id("procurementAnalytics"), startedAt: v.number(), resultJson: v.optional(v.string()), validUntil: v.optional(v.number()), error: v.optional(v.string()), measurements: v.optional(v.object({ inputRows: v.number(), inputBytes: v.number(), inputPages: v.number(), resultBytes: v.number(), durationMs: v.number() })) }, returns: v.null(),
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    if (!row || row.startedAt !== a.startedAt || row.state !== "preparing") return null;
    const active = await backgroundCatalog(ctx, row.societyId);
    if (!active || active.generation !== row.generation) { await ctx.db.patch(a.id, { state: "failed", error: "Publication changed during analytical preparation." }); return null; }
    if (a.resultJson && new TextEncoder().encode(a.resultJson).byteLength > 900_000) throw new Error("Analytical result exceeds the bounded response size.");
    await ctx.db.patch(a.id, { state: a.error ? "failed" : "ready", resultJson: a.resultJson, validUntil: a.validUntil, error: a.error, computedAt: Date.now(), measurements: a.measurements });
    await ctx.scheduler.runAfter(0, jobs.prune, {});
    return null;
  },
});
export const prune = internalMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const rows = await ctx.db.query("procurementAnalytics").withIndex("by_expiresAt", q => q.lt("expiresAt", Date.now())).take(50);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 50) await ctx.scheduler.runAfter(0, jobs.prune, {});
    return null;
  },
});
export const compute = internalAction({
  args: { id: v.id("procurementAnalytics") }, returns: v.null(),
  handler: async (ctx, a) => { await ctx.runAction((internal as any).procurementAnalyticsJobs.compute, a); return null; },
});
export const prepare = internalAction({
  args: scope, returns: v.null(),
  handler: async (ctx, a) => { await ctx.runMutation(jobs.prepareDefaults, a); return null; },
});
export const prepareDefaults = internalMutation({
  args: scope, returns: v.null(),
  handler: async (ctx, a) => {
    const active = await backgroundCatalog(ctx, a.societyId);
    if (!active || active.generation !== a.generation) return null;
    for (const view of ["overview", "trends", "buyers", "suppliers", "sizes", "mix", "quality", "opportunities", "decisions"] as const) await reserve(ctx, a.societyId, a.generation, JSON.stringify({ view }), Date.now());
    return null;
  },
});
