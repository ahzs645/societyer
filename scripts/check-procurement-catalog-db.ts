/** Synthetic artifacts only; this check never connects to a live workspace. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { ALL_TABLES, TABLES, canonical } from "./procurement/verify-export";
import { buildCatalog, catalogMeta, hash, openCatalog, readRow, readRows, sqliteSelfTest, verifyCatalog } from "../server/procurement-catalog/database";

const root = mkdtempSync(join(tmpdir(), "societyer-catalog-db-"));
const societyId = "fictional-workspace", folder = "Zoer/bc-bid-monitor/fictional-workspace";
async function fixture(name: string, { generation = name, complete = false, size = 500, changed = false, workspace = societyId } = {}) {
  const { mkdirSync } = await import("node:fs"); const directory = join(root, name); mkdirSync(directory);
  const scope = { societyId: workspace, generation };
  const rows: Record<string, any[]> = Object.fromEntries(ALL_TABLES.map(table => [table, []]));
  for (let n = 0; n < size; n++) {
    const recordKey = `opportunity:${String(n).padStart(5, "0")}`;
    rows.procurementRecords.push({ ...scope, recordKey, kind: "opportunity", title: "Fictional roads project " + n, organization: "Example municipality", date: "2026-11-10", status: "open", updatedAt: "2026-11-10T00:00:00Z" });
    rows.procurementDetails.push({ ...scope, recordKey, dataJson: JSON.stringify({ text: (changed && n === 0 ? "replacement words" : "infrastructure renewal") + " " + "Fictional requirements. ".repeat(60) }) });
  }
  rows.procurementEvidence.push({ ...scope, recordKey: "opportunity:00000", source: "synthetic-review", dataJson: '{"id":"z","note":"Fictional internal review"}' });
  rows.procurementEvidence.push({ ...scope, recordKey: "opportunity:00000", source: "synthetic-review", dataJson: '{"id":"a","note":"Second fictional review"}' });
  const tables: Record<string, any> = {}, zip = new JSZip();
  for (const table of ALL_TABLES) {
    const data = rows[table].map(row => canonical(row) + "\n").join(""); writeFileSync(join(directory, table + ".jsonl"), data);
    tables[table] = { path: table + ".jsonl", rowCount: rows[table].length, bytes: Buffer.byteLength(data), sha256: hash(data) };
    if ((TABLES as readonly string[]).includes(table)) zip.file(table + "/documents.jsonl", data);
  }
  const zipped = await zip.generateAsync({ type: "nodebuffer" }); writeFileSync(join(directory, "metadata.zip"), zipped);
  const activation = { schemaVersion: 1, profileVersion: 2, societyId: workspace, generation, folder, publicationId: name, publishedAt: "2026-11-10T00:00:00Z", sourceSnapshotId: "synthetic-snapshot", sourceCatalogSha256: "a".repeat(64), contentHash: "b".repeat(64), expected: Object.fromEntries(TABLES.map(table => [table, rows[table].length])), counts: { opportunity: size }, coverage: { complete, sources: [{ source: "fictional", complete }] }, tables, inventoryHash: hash(canonical({ schemaVersion: 1, tables })), archives: { "metadata.zip": { bytes: zipped.length, sha256: hash(zipped) } }, taxonomyCount: 0, taxonomyIndexes: [], taxonomyReleases: [] };
  writeFileSync(join(directory, "activation.json"), canonical(activation) + "\n"); return directory;
}
try {
  assert.match(sqliteSelfTest(), /^3\./);
  const output = join(root, "origin.sqlite"), first = await fixture("one");
  assert.equal((await buildCatalog(first, output)).changedRows, 1002);
  let db = openCatalog(output);
  assert.equal(verifyCatalog(db).generation, "one");
  assert.equal(readRows(db, "procurementEvidence").length, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM notice_text WHERE notice_text MATCH ?").get('infrastructure')!.n, 500);
  db.close();
  const second = await fixture("two");
  assert.equal((await buildCatalog(second, output)).changedRows, 0, "scope changes do not rewrite payloads");
  const before = readFileSync(output), third = await fixture("three", { changed: true });
  assert.equal((await buildCatalog(third, output)).changedRows, 1);
  const after = readFileSync(output); let changedPages = 0;
  for (let at = 0; at < Math.max(before.length, after.length); at += 4096) if (!before.subarray(at, at + 4096).equals(after.subarray(at, at + 4096))) changedPages++;
  assert(changedPages < before.length / 4096 / 4, "one changed row does not rewrite most pages");
  db = openCatalog(output); assert.equal(verifyCatalog(db).generation, "three");
  assert.equal(db.prepare("SELECT count(*) AS n FROM notice_text WHERE notice_text MATCH ?").get('replacement')!.n, 1); db.close();
  const incomplete = await fixture("incomplete", { size: 1 }); await buildCatalog(incomplete, output);
  db = openCatalog(output); assert.equal(readRows(db, "procurementRecords").length, 500, "incomplete coverage removes nothing"); verifyCatalog(db); db.close();
  const complete = await fixture("complete", { size: 1, complete: true }); await buildCatalog(complete, output);
  db = openCatalog(output); assert.equal(readRows(db, "procurementRecords").length, 1); assert.equal(readRow(db, "procurementRecords", "opportunity:00001")?.removed, true); db.close();
  const foreign = await fixture("foreign", { workspace: "other-workspace" });
  await assert.rejects(buildCatalog(foreign, output), /rebound/);
  db = openCatalog(output); assert.equal(catalogMeta(db).generation, "complete"); db.close();
  db = openCatalog(output, false); db.prepare("UPDATE notices SET source_json=? WHERE key=?").run('{"societyId":null,"generation":null,"title":"tampered"}', 'opportunity:00000');
  assert.throws(() => verifyCatalog(db), /inventory/); db.close();
  console.log(`Catalog database checks passed: source-byte inventory, scope isolation, retained/archived rows, FTS, unchanged-row reuse and ${changedPages} changed pages for a one-row update.`);
} finally { rmSync(root, { recursive: true, force: true }); }
