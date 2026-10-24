import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { summaryLineageFields, summaryVersions, type SummaryManifest } from "../../shared/procurementAnalyticsArtifacts";

/** One bounded marker read makes optional analytics part of atomic activation. */
export async function requirePreparedAnalytics(ctx: MutationCtx, publication: {
  societyId: Id<"societies">; generation: string; folder: string; contentHash?: string; inventoryHash?: string;
  publicationId?: string; sourceSnapshotId?: string; sourceCatalogSha256?: string;
  analytics?: { path: string; bytes: number; sha256: string };
}) {
  if (!publication.analytics) return;
  const bundle = await ctx.db.query("procurementAnalyticsBundles").withIndex("by_society_generation", q => q.eq("societyId", publication.societyId).eq("generation", publication.generation)).unique();
  if (!bundle || publication.analytics.path !== "analytics-manifest.json" || publication.analytics.sha256 !== bundle.bundleSha256 || publication.analytics.bytes !== new TextEncoder().encode(bundle.manifestJson).byteLength || bundle.folder !== publication.folder || bundle.contentHash !== publication.contentHash || bundle.inventoryHash !== publication.inventoryHash) throw new Error("Verified analytical sidecar must be staged before activation.");
  const manifest = JSON.parse(bundle.manifestJson) as SummaryManifest;
  if (summaryLineageFields.some(key => publication[key] !== manifest[key]) || Object.entries(summaryVersions).some(([key, value]) => manifest[key as keyof SummaryManifest] !== value)) throw new Error("Staged analytical sidecar has different publication lineage or versions.");
  if (Date.now() >= bundle.validUntil) throw new Error("Analytical sidecar expired; regenerate it for the same verified publication and resume the exact import.");
}
