import { readFileSync, writeFileSync, renameSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { ANALYTICS_BUNDLE_LIMIT, buildDefaultSummaries, canonicalSummary, projectedListRow, summaryLineageFields, summaryVersions, validateSummaryEntries, type SummaryEntry, type SummaryManifest } from "../../shared/procurementAnalyticsArtifacts";
export const summarySha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const readBounded = (directory: string, name: string, limit: number) => {
  const path = resolve(directory, name), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error("Unsafe or oversized analytical artifact.");
  return readFileSync(path);
};
export function validateAnalyticsArtifacts(directory: string, verified: { activation: any; rows: Record<string, any[]> }, recompute = true) {
  const descriptor = verified.activation.analytics;
  if (descriptor === undefined) return null;
  if (!descriptor || typeof descriptor !== "object" || descriptor.path !== "analytics-manifest.json" || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error("Invalid analytical artifact descriptor.");
  const manifestBytes = readBounded(directory, descriptor.path, 16000);
  if (manifestBytes.length !== descriptor.bytes || summarySha(manifestBytes) !== descriptor.sha256) throw new Error("Analytical manifest integrity mismatch.");
  const manifest: SummaryManifest = JSON.parse(manifestBytes.toString("utf8"));
  if (summaryLineageFields.some(key => manifest[key] !== verified.activation[key]) || manifest.rows?.path !== "analytics.jsonl" || manifest.rows.rowCount !== 10 || !Number.isSafeInteger(manifest.rows.bytes) || !/^[a-f0-9]{64}$/.test(manifest.rows.sha256)) throw new Error("Analytical publication lineage mismatch.");
  const bytes = readBounded(directory, manifest.rows.path, ANALYTICS_BUNDLE_LIMIT);
  if (bytes.length !== manifest.rows.bytes || summarySha(bytes) !== manifest.rows.sha256) throw new Error("Analytical rows integrity mismatch.");
  const entries: SummaryEntry[] = bytes.toString("utf8").trimEnd().split("\n").map(line => JSON.parse(line));
  validateSummaryEntries(manifest, entries);
  if (Buffer.byteLength(JSON.stringify({ manifestJson: manifestBytes.toString("utf8"), rowsJson: bytes.toString("utf8") })) > 7_000_000) throw new Error("Analytical seed payload exceeds safe request budget.");
  if (manifest.sourceMetadata) {
    const source = readBounded(directory, manifest.sourceMetadata.path, 8000);
    if (source.length !== manifest.sourceMetadata.bytes || summarySha(source) !== manifest.sourceMetadata.sha256 || canonicalSummary(JSON.parse(source.toString("utf8"))) !== canonicalSummary(manifest.sourceContract)) throw new Error("Analytical source metadata integrity mismatch.");
  }
  if (recompute) {
    const expected = buildDefaultSummaries(verified.rows.procurementRecords.map(projectedListRow), verified.rows.procurementEvidence, manifest.asOf, true);
    if (canonicalSummary(entries) !== canonicalSummary(expected)) throw new Error("Precomputed analytics differ from verified publication semantics.");
  }
  return { manifest, entries, manifestJson: manifestBytes.toString("utf8"), rowsJson: bytes.toString("utf8"), sha256: descriptor.sha256 };
}
export function writeAnalyticsArtifacts(directory: string, verified: { activation: any; rows: Record<string, any[]> }, asOf: number, computedAt?: number, sourceContract?: Record<string, unknown>) {
  const entries = buildDefaultSummaries(verified.rows.procurementRecords.map(projectedListRow), verified.rows.procurementEvidence, asOf, true);
  const rowsJson = entries.map(entry => canonicalSummary(entry) + "\n").join("");
  if (Buffer.byteLength(rowsJson) > ANALYTICS_BUNDLE_LIMIT) throw new Error("Analytical bundle exceeds 6 MB ingestion budget.");
  const sourceJson = sourceContract ? canonicalSummary(sourceContract) + "\n" : null;
  if (sourceJson && Buffer.byteLength(sourceJson) > 8000) throw new Error("Analytical source contract exceeds 8 KB.");
  const manifest = { schemaVersion: 1, ...Object.fromEntries(summaryLineageFields.filter(key => verified.activation[key] !== undefined).map(key => [key, verified.activation[key]])), ...summaryVersions, asOf, computedAt: computedAt ?? Date.now(), rows: { path: "analytics.jsonl", rowCount: entries.length, bytes: Buffer.byteLength(rowsJson), sha256: summarySha(rowsJson) }, ...(sourceJson ? { sourceContract, sourceMetadata: { path: "publication-source.json", bytes: Buffer.byteLength(sourceJson), sha256: summarySha(sourceJson) } } : {}) } as SummaryManifest;
  validateSummaryEntries(manifest, entries);
  const manifestJson = canonicalSummary(manifest) + "\n";
  if (Buffer.byteLength(manifestJson) > 16000 || Buffer.byteLength(JSON.stringify({ manifestJson, rowsJson })) > 7_000_000) throw new Error("Analytical manifest or seed payload exceeds safe request budget.");
  const descriptor = { path: "analytics-manifest.json", bytes: Buffer.byteLength(manifestJson), sha256: summarySha(manifestJson) };
  if (sourceJson) writeFileSync(resolve(directory, "publication-source.json"), sourceJson, { mode: 0o600 });
  for (const [name, data] of [["analytics.jsonl", rowsJson], ["analytics-manifest.json", manifestJson], ["activation.json", JSON.stringify({ ...verified.activation, analytics: descriptor }, null, 2) + "\n"]]) {
    const path = resolve(directory, name), temporary = path + ".tmp-" + process.pid;
    writeFileSync(temporary, data, { mode: 0o600 }); renameSync(temporary, path);
  }
  return { manifest, descriptor, entries };
}
