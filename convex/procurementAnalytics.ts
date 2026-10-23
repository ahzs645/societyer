/** Publication-scoped metrics. Only controlled server jobs read full inputs; clients receive bounded results. */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { activeCatalog, listRow, listRowFields } from "./procurementReview";
import { analysisIdentity, normalizeAnalysisRequest, PROCUREMENT_MAPPING_VERSION, PROCUREMENT_METRIC_VERSION } from "../shared/procurementAnalytics";
import { PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE } from "../shared/deploymentCapabilities";
import { ANALYTICS_BUNDLE_LIMIT, DEFAULT_ANALYTICS_VIEWS, assertSummariesFresh, canonicalSummary, defaultAnalyticsRequest, summaryVersions, validateSummaryEntries, type SummaryEntry, type SummaryManifest } from "../shared/procurementAnalyticsArtifacts";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";

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
async function artifactFor(ctx: QueryCtx | MutationCtx, active: Doc<"procurementCatalogs">, request: string, asOf: number) {
  const normalized = defaultAnalyticsRequest(request);
  if (!normalized) return null;
  const row = await ctx.db.query("procurementAnalyticsArtifacts").withIndex("by_society_generation_request", q => q.eq("societyId", active.societyId).eq("generation", active.generation).eq("request", normalized)).unique();
  if (!row || row.folder !== active.folder || row.contentHash !== active.contentHash || row.inventoryHash !== active.inventoryHash || Object.entries(summaryVersions).some(([key, version]) => row[key as "metricVersion" | "mappingVersion" | "engineVersion"] !== version) || asOf < row.asOf || asOf >= row.validUntil) return null;
  return row;
}
async function reserve(ctx: MutationCtx, societyId: Id<"societies">, generation: string, request: string, asOf: number, active: Doc<"procurementCatalogs">) {
  const n = normalized(request, asOf);
  if (await artifactFor(ctx, active, n.request, asOf)) return;
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
    const prepared = await artifactFor(ctx, active, n.request, a.asOf);
    if (prepared) return { state: "ready" as const, resultJson: prepared.resultJson, error: null, computedAt: prepared.computedAt, asOf: prepared.asOf, metricVersion: prepared.metricVersion, mappingVersion: prepared.mappingVersion };
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
    await reserve(ctx, a.societyId, a.generation, a.request, a.asOf, active);
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
    let more = rows.length === 50;
    for (const table of ["procurementAnalyticsArtifacts", "procurementAnalyticsBundles"] as const) {
      const expired = await ctx.db.query(table).withIndex("by_expiresAt", q => q.lt("expiresAt", Date.now())).take(50);
      for (const row of expired) await ctx.db.delete(row._id);
      more ||= expired.length === 50;
    }
    if (more) await ctx.scheduler.runAfter(0, jobs.prune, {});
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
    for (const view of DEFAULT_ANALYTICS_VIEWS) await reserve(ctx, a.societyId, a.generation, JSON.stringify({ view }), Date.now(), active);
    return null;
  },
});

/** Operator-only atomic staging; artifacts become readable only for the exact active publication. */
export const seed = internalMutation({
  args: { societyId: v.id("societies"), generation: v.string(), folder: v.string(), contentHash: v.string(), inventoryHash: v.string(), bundleSha256: v.string(), manifestJson: v.string(), rowsJson: v.string() },
  returns: v.object({ written: v.number(), state: v.union(v.literal("seeded"), v.literal("reused"), v.literal("stale")) }),
  handler: async (ctx, a) => {
    validateWorkspaceProcurementReviewFolder(a.societyId, a.folder);
    const society = await ctx.db.get(a.societyId);
    if (society?.integrationSettings?.procurementReviewFolder !== a.folder || ![a.contentHash, a.inventoryHash, a.bundleSha256].every(value => /^[a-f0-9]{64}$/.test(value)) || new TextEncoder().encode(a.manifestJson).byteLength > 16000 || new TextEncoder().encode(a.rowsJson).byteLength > ANALYTICS_BUNDLE_LIMIT) throw new Error("Invalid analytical artifact scope or size.");
    const sha = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
    if (await sha(a.manifestJson) !== a.bundleSha256) throw new Error("Analytical manifest integrity mismatch.");
    const manifest = JSON.parse(a.manifestJson) as SummaryManifest;
    if (manifest.societyId !== a.societyId || manifest.folder !== a.folder || manifest.generation !== a.generation || manifest.contentHash !== a.contentHash || manifest.inventoryHash !== a.inventoryHash || manifest.rows?.path !== "analytics.jsonl" || manifest.rows.rowCount !== DEFAULT_ANALYTICS_VIEWS.length || manifest.rows.bytes !== new TextEncoder().encode(a.rowsJson).byteLength || manifest.rows.sha256 !== await sha(a.rowsJson) || manifest.computedAt > Date.now() + 300_000) throw new Error("Analytical publication lineage or rows integrity mismatch.");
    const entries = a.rowsJson.trimEnd().split("\n").map(line => JSON.parse(line)) as SummaryEntry[];
    validateSummaryEntries(manifest, entries);
    assertSummariesFresh(entries);
    if (manifest.sourceMetadata) {
      const source = canonicalSummary(manifest.sourceContract) + "\n";
      if (new TextEncoder().encode(source).byteLength !== manifest.sourceMetadata.bytes || await sha(source) !== manifest.sourceMetadata.sha256) throw new Error("Analytical source contract integrity mismatch.");
    }
    const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", a.societyId)).unique();
    const job = await ctx.db.query("procurementImportJobs").withIndex("by_generation", q => q.eq("societyId", a.societyId).eq("generation", a.generation)).unique();
    const serving = active?.folder === a.folder && active.generation === a.generation && active.contentHash === a.contentHash && active.inventoryHash === a.inventoryHash && active.sourceSnapshotId === manifest.sourceSnapshotId && active.sourceCatalogSha256 === manifest.sourceCatalogSha256 && active.publicationId === manifest.publicationId;
    if (!serving && !(job?.folder === a.folder && job.contentHash === a.contentHash && job.inventoryHash === a.inventoryHash)) throw new Error("A matching verified publication job or active catalog is required before staging analytics.");
    const prior = await ctx.db.query("procurementAnalyticsBundles").withIndex("by_society_generation", q => q.eq("societyId", a.societyId).eq("generation", a.generation)).unique();
    if (prior && (prior.contentHash !== a.contentHash || prior.inventoryHash !== a.inventoryHash || prior.folder !== a.folder)) throw new Error("Analytical generation changed in place.");
    if (prior?.bundleSha256 === a.bundleSha256) return { written: 0, state: "reused" as const };
    if (prior && prior.asOf > manifest.asOf) return { written: 0, state: "stale" as const };
    if (prior && prior.asOf === manifest.asOf) {
      const previous = JSON.parse(prior.manifestJson) as SummaryManifest;
      if (Object.entries(summaryVersions).every(([key, value]) => previous[key as keyof SummaryManifest] === value) && previous.rows.sha256 !== manifest.rows.sha256) throw new Error("Conflicting analytical results for the same publication and clock.");
    }
    const expiresAt = Math.max(manifest.computedAt + 2 * 86_400_000, ...entries.map(entry => entry.validUntil));
    for (const entry of entries) {
      const row = await ctx.db.query("procurementAnalyticsArtifacts").withIndex("by_society_generation_request", q => q.eq("societyId", a.societyId).eq("generation", a.generation).eq("request", entry.request)).unique();
      const data = { societyId: a.societyId, generation: a.generation, folder: a.folder, contentHash: a.contentHash, inventoryHash: a.inventoryHash, bundleSha256: a.bundleSha256, ...summaryVersions, ...entry, computedAt: manifest.computedAt, expiresAt };
      if (row) await ctx.db.replace(row._id, data); else await ctx.db.insert("procurementAnalyticsArtifacts", data);
    }
    const marker = { societyId: a.societyId, generation: a.generation, folder: a.folder, contentHash: a.contentHash, inventoryHash: a.inventoryHash, bundleSha256: a.bundleSha256, manifestJson: a.manifestJson, asOf: manifest.asOf, computedAt: manifest.computedAt, validUntil: Math.min(...entries.map(entry => entry.validUntil)), expiresAt };
    if (prior) await ctx.db.replace(prior._id, marker); else await ctx.db.insert("procurementAnalyticsBundles", marker);
    await ctx.scheduler.runAfter(0, jobs.prune, {});
    return { written: entries.length, state: "seeded" as const };
  },
});
