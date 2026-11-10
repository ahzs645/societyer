import { ALL_TABLES, canonical } from "../../scripts/procurement/verify-export";
import { buildDefaultSummaries, projectedListRow } from "../../shared/procurementAnalyticsArtifacts";
import { hash, openCatalog, readRows, verifyCatalog } from "./database";
import { browserListRow } from "./model";
import { join } from "node:path";

export function fingerprintCatalog(directory: string, asOf: number) {
  return fingerprintDatabase(join(directory, "catalog.sqlite"), asOf);
}
export function fingerprintDatabase(path: string, asOf: number) {
  if (!Number.isSafeInteger(asOf) || Math.abs(Date.now() - asOf) > 31 * 86400_000) throw new Error("Qualification needs a bounded, explicit analytical clock.");
  const db = openCatalog(path);
  try {
    const meta = verifyCatalog(db), tables: Record<string, { rows: number; sha256: string }> = {};
    for (const table of ALL_TABLES) { const rows = readRows(db, table); tables[table] = { rows: rows.length, sha256: hash(canonical(rows)) }; }
    const full = readRows(db, "procurementRecords"), evidence = readRows(db, "procurementEvidence").map(row => ({ recordKey: row.recordKey, source: row.source, dataJson: row.dataJson }));
    const lists = Object.fromEntries(["opportunity", "award"].map(kind => [kind, hash(canonical(full.filter(row => row.kind === kind).map(browserListRow)))]));
    const summaries = buildDefaultSummaries(full.map(projectedListRow), evidence, asOf, true);
    const analytics = Object.fromEntries(summaries.map(entry => [JSON.parse(entry.request).view, hash(canonical(JSON.parse(entry.resultJson)))]));
    return { schemaVersion: 1, societyId: meta.societyId, publicationId: meta.publicationId, generation: meta.generation, folder: meta.folder, inventoryHash: meta.inventoryHash, asOf, tables, lists, analytics };
  } finally { db.close(); }
}
