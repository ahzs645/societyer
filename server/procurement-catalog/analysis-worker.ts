import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analysisIdentity, buildAnalysis, normalizeAnalysisRequest } from "../../shared/procurementAnalytics";
import { analyticsValidUntil, projectedListRow, type SummaryEntry } from "../../shared/procurementAnalyticsArtifacts";
import { openCatalog, readRows } from "./database";

try {
  const db = openCatalog(join(workerData.directory, "catalog.sqlite"));
  const records = readRows(db, "procurementRecords").map(projectedListRow);
  const evidence = readRows(db, "procurementEvidence").map(row => ({ recordKey: row.recordKey, source: row.source, dataJson: row.dataJson }));
  db.close();
  const cache = new Map<string, SummaryEntry>();
  const summaries = JSON.parse(readFileSync(join(workerData.directory, "summaries.json"), "utf8")) as SummaryEntry[];
  for (const entry of summaries) cache.set(analysisIdentity(normalizeAnalysisRequest(entry.request), entry.asOf), entry);
  parentPort!.on("message", (message: { id: number; request: unknown; asOf: number }) => {
    try {
      if (!Number.isSafeInteger(message.asOf) || message.asOf < Date.now() - 31 * 86400_000 || message.asOf > Date.now() + 60_000) throw new Error("Choose an analysis time within the last 31 days.");
      const request = normalizeAnalysisRequest(message.request as any), key = analysisIdentity(request, message.asOf);
      let entry = cache.get(key);
      if (!entry || message.asOf < entry.asOf || message.asOf >= entry.validUntil) {
        const input = request.view === "decisions" || request.view === "party" ? records : records.filter(row => row.kind === (request.view === "opportunities" ? "opportunity" : "award"));
        const result = buildAnalysis(input, evidence, request, message.asOf);
        if (result.type === "decisions") result.data.coverage.complete = true;
        const resultJson = JSON.stringify(result);
        if (Buffer.byteLength(resultJson) > 900_000) throw new Error("Analysis exceeds the response limit; narrow the filters.");
        entry = { request: JSON.stringify(request), asOf: message.asOf, validUntil: analyticsValidUntil(result, message.asOf), resultJson };
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(key, entry);
      }
      parentPort!.postMessage({ id: message.id, resultJson: entry.resultJson, asOf: entry.asOf });
    } catch (error) { parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : "Analysis failed." }); }
  });
  parentPort!.postMessage({ ready: true });
} catch { parentPort!.postMessage({ startupError: "Analytical catalog could not be loaded." }); }
