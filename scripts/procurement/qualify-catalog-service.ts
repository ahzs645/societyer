/** Full current-generation parity. No fake publications and no user impersonation. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { ALL_TABLES, canonical, validateExport } from "./verify-export";
import { publisherConfig, remoteCommand } from "./catalog-transport";
import { createPersistentOperator } from "./operator-client";
import { catalogMeta, hash, openCatalog, readRows, rowKey } from "../../server/procurement-catalog/database";
import { fingerprintDatabase } from "../../server/procurement-catalog/qualification";
import { browserListRow } from "../../server/procurement-catalog/model";
import { buildDefaultSummaries, projectedListRow } from "../../shared/procurementAnalyticsArtifacts";

const args = process.argv.slice(2), value = (key: string) => args[args.indexOf(key) + 1];
if (!["--input", "--config", "--deployment"].every(key => args.includes(key) && value(key))) throw new Error("Usage: tsx qualify-catalog-service.ts --input VERIFIED_EXPORT --config PRIVATE_PUBLISHER_JSON --deployment NAME");
const input = resolve(value("--input")), config = publisherConfig(resolve(value("--config"))), { activation } = await validateExport(input, { skipAnalytics: true });
if (activation.societyId !== config.societyId || activation.folder !== config.folder) throw new Error("Qualification belongs to another workspace or folder.");
const db = openCatalog(config.originFile), meta = catalogMeta(db);
if (meta.inventoryHash !== activation.inventoryHash || meta.generation !== activation.generation) throw new Error("The persistent origin no longer contains this publication; qualify before the next publish.");
const receiptPath = join(input, "catalog-service-parity.json");
const previousReport = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) : null;
if (previousReport) assert(previousReport.schemaVersion === 1 && previousReport.result === "passed" && previousReport.societyId === config.societyId && previousReport.folder === config.folder && previousReport.publicationId === activation.publicationId && previousReport.generation === activation.generation && previousReport.inventoryHash === activation.inventoryHash && Number.isSafeInteger(previousReport.asOf), "Retained parity evidence belongs to another publication or is invalid.");
// A retry after report persistence or journal ACK failure must retain the same
// analytical clock and immutable evidence hash. All comparisons still run again.
const asOf = previousReport?.asOf ?? Date.now(), expected = fingerprintDatabase(config.originFile, asOf), remote = await remoteCommand(config, "qualify", { societyId: config.societyId, publicationId: activation.publicationId, asOf });
assert.equal(canonical(remote), canonical(expected), "Serving service SQLite/list/ten-view fingerprints differ from the verified origin.");
const operator = await createPersistentOperator(value("--deployment")), reports: Record<string, { rows: number; sha256: string }> = {};
let records: any[] = [], evidence: any[] = [];
try {
  for (const table of ALL_TABLES) {
    const wanted = readRows(db, table), byKey = new Map(wanted.map(row => [rowKey(table, row), row])), actual = new Map<string, any>();
    const releases = table === "procurementTaxonomyTerms" ? [...new Set(wanted.map(row => row.releaseId))] : [undefined];
    for (const releaseId of releases) {
      let cursor: string | null = null;
      for (let page = 0; ; page++) {
        if (page >= 10_000) throw new Error("Parity cursor exceeded its bounded number of pages.");
        const result = await operator.run("procurementCatalogOperator:page", JSON.stringify({ societyId: config.societyId, generation: activation.generation, table, ...(releaseId ? { releaseId } : {}), paginationOpts: { numItems: 500, cursor } })) as { rowsJson: string; inventoryHash: string; isDone: boolean; continueCursor: string };
        assert.equal(result.inventoryHash, activation.inventoryHash, "Convex publication changed during comparison.");
        for (const row of JSON.parse(result.rowsJson)) {
          const key = rowKey(table, row), target = byKey.get(key);
          assert(target, `Convex contains an unexpected ${table} row.`); assert(!actual.has(key), "Duplicate Convex row.");
          assert.equal(canonical(Object.fromEntries(Object.keys(target).map(field => [field, row[field]]))), canonical(target), `A source field differs in ${table}.`);
          actual.set(key, row);
        }
        if (result.isDone) break;
        if (!result.continueCursor || result.continueCursor === cursor) throw new Error("Convex parity cursor did not advance."); cursor = result.continueCursor;
      }
    }
    assert.equal(actual.size, wanted.length, `Convex ${table} row count differs.`);
    console.error(JSON.stringify({ phase: "catalog_parity", table, rows: actual.size }));
    reports[table] = expected.tables[table];
    const ordered = wanted.map(row => actual.get(rowKey(table, row))!);
    if (table === "procurementRecords") records = ordered;
    if (table === "procurementEvidence") evidence = ordered.map(row => ({ recordKey: row.recordKey, source: row.source, dataJson: row.dataJson }));
  }
  const lists = Object.fromEntries(["opportunity", "award"].map(kind => [kind, hash(canonical(records.filter(row => row.kind === kind).map(browserListRow)))]));
  assert.equal(canonical(lists), canonical(expected.lists), "Convex list projections differ from the service's complete thin lists.");
  const analytics = Object.fromEntries(buildDefaultSummaries(records.map(projectedListRow), evidence, asOf, true).map(entry => [JSON.parse(entry.request).view, hash(canonical(JSON.parse(entry.resultJson)))]));
  assert.equal(canonical(analytics), canonical(expected.analytics), "Convex inputs differ in the ten default analytical views.");
  const report = canonical({ schemaVersion: 1, result: "passed", societyId: config.societyId, folder: config.folder, publicationId: activation.publicationId, generation: activation.generation, inventoryHash: activation.inventoryHash, asOf, service: remote, convex: { tables: reports, lists, analytics } }) + "\n";
  if (previousReport) assert.equal(canonical(previousReport) + "\n", report, "Repeated full comparison changed the retained immutable parity evidence.");
  else writeFileSync(receiptPath, report, { mode: 0o600 });
  await operator.run("procurementCatalogOperator:verifyParity", JSON.stringify({ societyId: config.societyId, folder: config.folder, publicationId: activation.publicationId, inventoryHash: activation.inventoryHash, reportHash: hash(report) }));
  console.log(JSON.stringify({ state: "passed", publicationId: activation.publicationId, tables: reports, receiptPath }));
} finally { db.close(); operator.close(); }
