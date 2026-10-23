/** Pure upstream/default-summary contract; the analytical arithmetic stays in buildAnalysis. */
import { buildAnalysis, normalizeAnalysisRequest, PROCUREMENT_MAPPING_VERSION, PROCUREMENT_METRIC_VERSION, type AnalysisRequest, type AnalysisResult } from "./procurementAnalytics";
import { zoneToday } from "../src/features/procurementReview/lib/notice";
import type { ListRow } from "./procurementListRow";
import type { CatalogReviewRow } from "../src/features/procurementReview/reader/source";
export const ANALYTICS_ENGINE_VERSION = "procurement-summary-v1";
export const DEFAULT_ANALYTICS_VIEWS = ["overview", "trends", "buyers", "suppliers", "sizes", "mix", "quality", "opportunities", "decisions", "compare"] as const;
export const ANALYTICS_BUNDLE_LIMIT = 6_000_000;
export const ANALYTICS_RESULT_LIMIT = 900_000;
export const canonicalSummary = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
export const defaultAnalyticsRequest = (request: string | AnalysisRequest): string | null => {
  const normalized = normalizeAnalysisRequest(request);
  return (DEFAULT_ANALYTICS_VIEWS as readonly string[]).includes(normalized.view) && canonicalSummary(normalized) === canonicalSummary(normalizeAnalysisRequest({ view: normalized.view })) ? JSON.stringify(normalized) : null;
};
export function nextAnalyticsDay(asOf: number): number {
  const today = zoneToday(asOf);
  let lo = Math.floor(asOf), hi = lo + 27 * 3_600_000;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (zoneToday(mid) === today) lo = mid; else hi = mid; }
  return hi;
}
export function analyticsValidUntil(result: AnalysisResult, asOf: number): number {
  const boundary = result.type === "opportunities" || result.type === "decisions" ? result.data.nextBoundaryAt : null;
  if (boundary !== null && (!Number.isFinite(boundary) || boundary <= asOf)) throw new Error("Invalid analytical clock boundary.");
  return Math.min(nextAnalyticsDay(asOf), asOf + 2 * 86_400_000, boundary ?? Infinity);
}
export type SummaryEntry = { request: string; asOf: number; validUntil: number; resultJson: string };
export function assertSummariesFresh(entries: SummaryEntry[], now = Date.now()) {
  if (entries.some(entry => now >= entry.validUntil)) throw new Error("Analytical sidecar expired; regenerate it for the same verified publication and resume the exact import.");
}
export type SummaryManifest = {
  schemaVersion: 1; societyId: string; folder: string; generation: string; publicationId?: string; sourceSnapshotId: string; sourceCatalogSha256: string;
  contentHash: string; inventoryHash: string; metricVersion: string; mappingVersion: string; engineVersion: string; asOf: number; computedAt: number;
  rows: { path: "analytics.jsonl"; rowCount: number; bytes: number; sha256: string };
  sourceMetadata?: { path: "publication-source.json"; bytes: number; sha256: string };
  sourceContract?: Record<string, unknown>;
};
export const summaryLineageFields = ["societyId", "folder", "generation", "publicationId", "sourceSnapshotId", "sourceCatalogSha256", "contentHash", "inventoryHash"] as const;
export const summaryVersions = { metricVersion: PROCUREMENT_METRIC_VERSION, mappingVersion: PROCUREMENT_MAPPING_VERSION, engineVersion: ANALYTICS_ENGINE_VERSION };
export function projectedListRow(row: any): ListRow {
  return { recordKey: row.recordKey, kind: row.kind, title: row.title, organization: row.organization, issuedFor: row.issuedFor ?? "", status: row.status, date: row.date, dateText: row.dateText ?? "", reference: row.reference ?? "", documents: row.documents ?? 0, listedDocuments: row.listedDocuments ?? 0, supplier: row.supplier ?? "", value: row.value ?? null, currency: row.currency ?? "", procurementType: row.procurementType ?? "", ...(row.analyticsJson ? { analyticsJson: row.analyticsJson } : {}) };
}
export function buildDefaultSummaries(records: ListRow[], evidence: CatalogReviewRow[], asOf: number, verifiedEvidence: boolean): SummaryEntry[] {
  if (!Number.isSafeInteger(asOf)) throw new Error("Invalid analytical asOf timestamp.");
  return DEFAULT_ANALYTICS_VIEWS.map(view => {
    const request = normalizeAnalysisRequest({ view });
    const input = view === "decisions" ? records : records.filter(row => row.kind === (view === "opportunities" ? "opportunity" : "award"));
    const result = buildAnalysis(input, view === "decisions" ? evidence : [], request, asOf);
    if (result.type === "decisions") result.data.coverage.complete = verifiedEvidence;
    const resultJson = JSON.stringify(result);
    if (new TextEncoder().encode(resultJson).byteLength > ANALYTICS_RESULT_LIMIT) throw new Error("Precomputed analytical result exceeds bounded response size.");
    return { request: JSON.stringify(request), asOf, validUntil: analyticsValidUntil(result, asOf), resultJson };
  });
}
export function validateSummaryEntries(manifest: SummaryManifest, entries: SummaryEntry[]) {
  if (manifest.schemaVersion !== 1 || Object.entries(summaryVersions).some(([key, value]) => manifest[key as keyof SummaryManifest] !== value) || !Number.isSafeInteger(manifest.asOf) || !Number.isSafeInteger(manifest.computedAt) || manifest.computedAt < manifest.asOf || entries.length !== DEFAULT_ANALYTICS_VIEWS.length) throw new Error("Unsupported or malformed analytical manifest.");
  const requests = new Set<string>();
  if (manifest.sourceMetadata !== undefined && (!manifest.sourceMetadata || manifest.sourceMetadata.path !== "publication-source.json" || !Number.isSafeInteger(manifest.sourceMetadata.bytes) || manifest.sourceMetadata.bytes < 1 || manifest.sourceMetadata.bytes > 8000 || !/^[a-f0-9]{64}$/.test(manifest.sourceMetadata.sha256) || manifest.sourceContract?.schemaVersion !== 1 || manifest.sourceContract.publicationId !== manifest.publicationId || manifest.sourceContract.sourceSnapshotId !== manifest.sourceSnapshotId || typeof manifest.sourceContract.sourceManifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.sourceContract.sourceManifestSha256))) throw new Error("Invalid analytical source contract.");
  if ((manifest.sourceMetadata !== undefined) !== (manifest.sourceContract !== undefined)) throw new Error("Analytical source metadata must be explicitly bound.");
  for (const entry of entries) {
    const request = defaultAnalyticsRequest(entry.request);
    if (!request || request !== entry.request || requests.has(request) || entry.asOf !== manifest.asOf || typeof entry.resultJson !== "string" || new TextEncoder().encode(entry.resultJson).byteLength > ANALYTICS_RESULT_LIMIT) throw new Error("Invalid or duplicate default analytical request.");
    const result = JSON.parse(entry.resultJson) as AnalysisResult, view = normalizeAnalysisRequest(request).view;
    if (result?.type !== (view === "opportunities" ? "opportunities" : view === "decisions" ? "decisions" : "award") || !result.data || entry.validUntil !== analyticsValidUntil(result, entry.asOf)) throw new Error("Invalid precomputed analytical response or clock window.");
    requests.add(request);
  }
}
