/** Local-only producer; uses the exact Societyer analytical engine on a verified publication. */
import { validateExport } from "./verify-export";
import { validateAnalyticsArtifacts, writeAnalyticsArtifacts } from "./analytics-artifacts";
import { assertSummariesFresh, canonicalSummary } from "../../shared/procurementAnalyticsArtifacts";
import { readFileSync, lstatSync } from "node:fs";
const args = process.argv.slice(2), value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const directory = value("--input"), asOf = value("--as-of") ? Date.parse(value("--as-of")!) : Math.floor(Date.now() / 60_000) * 60_000, computedAt = value("--computed-at"), sourceMetadata = value("--source-metadata");
if (!directory || !Number.isSafeInteger(asOf)) throw new Error("Usage: precompute-analytics.ts --input VERIFIED_EXPORT [--as-of ISO_TIMESTAMP] [--computed-at ISO_TIMESTAMP] [--source-metadata PRIVATE_JSON]");
if (sourceMetadata && (lstatSync(sourceMetadata).size > 8000 || !lstatSync(sourceMetadata).isFile() || lstatSync(sourceMetadata).isSymbolicLink())) throw new Error("Unsafe analytical source metadata.");
const verified = await validateExport(directory, { skipAnalytics: true });
const sourceContract = sourceMetadata ? JSON.parse(readFileSync(sourceMetadata, "utf8")) : undefined;
// Reuse the original clock and receipt when every view is still valid. The final
// validation independently recomputes exact parity, including on this path.
const existing = validateAnalyticsArtifacts(directory, verified, false);
const reused = existing && asOf >= existing.manifest.asOf && existing.entries.every(entry => asOf < entry.validUntil && Date.now() < entry.validUntil) && (!value("--as-of") || existing.manifest.asOf === asOf) && (!computedAt || existing.manifest.computedAt === Date.parse(computedAt)) && (!sourceContract || canonicalSummary(existing.manifest.sourceContract) === canonicalSummary(sourceContract));
let result = reused ? { manifest: existing.manifest, descriptor: verified.activation.analytics, entries: existing.entries } : writeAnalyticsArtifacts(directory, verified, asOf, computedAt ? Date.parse(computedAt) : undefined, sourceContract ?? existing?.manifest.sourceContract);
// A deadline can fall inside the current minute. Use the precise clock on that
// rare refresh; earlier client clocks correctly fall back until their next tick.
if (!value("--as-of") && !computedAt && result.entries.some(entry => Date.now() >= entry.validUntil)) result = writeAnalyticsArtifacts(directory, verified, Date.now(), undefined, sourceContract ?? existing?.manifest.sourceContract);
const final = await validateExport(directory);
assertSummariesFresh(final.analytics!.entries);
console.log(JSON.stringify({ schemaVersion: 1, generation: result.manifest.generation, asOf: result.manifest.asOf, computedAt: result.manifest.computedAt, entries: result.manifest.rows.rowCount, bytes: result.manifest.rows.bytes, sha256: result.descriptor.sha256, reused: !!reused, action: "Prepared and independently verified bounded default summaries locally; no network requests." }));
