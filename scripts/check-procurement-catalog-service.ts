/** Runs a real HTTP listener, SQLite files and isolated worker threads. No live credentials. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign } from "node:crypto";
import JSZip from "jszip";
import { buildCatalog, hash, openCatalog } from "../server/procurement-catalog/database";
import { ALL_TABLES, TABLES, canonical } from "./procurement/verify-export";
import { createCatalogService } from "../server/procurement-catalog/server";

const root = mkdtempSync(join(tmpdir(), "catalog-http-")), societyId = "fixture-ddc", folder = "Zoer/bc-bid-monitor/fixture-ddc";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const issuer = "https://fixture.convex.site", adminSecret = "test-only-" + "a".repeat(40), origin = "https://fixture.ddcnorth.test";
const grant = (workspace = societyId) => {
  const now = Math.floor(Date.now() / 1000), head = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "fixture" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: issuer, aud: "procurement-catalog", sub: "fixture-user", societyId: workspace, folder, iat: now, exp: now + 600 })).toString("base64url");
  const data = head + "." + claims;
  return data + "." + sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
};
async function fixture(publicationId: string) {
  const directory = join(root, "export-" + publicationId); mkdirSync(directory);
  const scope = { societyId, generation: publicationId + "-reader-v2" }, recordKey = "opportunity:roads";
  const rows: Record<string, any[]> = { procurementRecords: [{ ...scope, recordKey, kind: "opportunity", title: "Fictional road works", organization: "Example", status: "open", date: "2026-11-10", updatedAt: "2026-11-10T00:00:00Z", analyticsJson: JSON.stringify({ sourceId: "bcbid", closingAt: "2027-01-01T20:00:00Z", industryCategories: ["Construction"], privateUnusedAnalytics: "not in list" }) }], procurementDetails: [{ ...scope, recordKey, dataJson: '{"body":"Underground zebra conduits"}' }], procurementDocuments: [], procurementEvidence: [{ ...scope, recordKey, source: "fixture", dataJson: '{"id":"review","note":"Workspace-private evidence"}' }], procurementTaxonomyTerms: [] };
  const tables: Record<string, any> = {}, zip = new JSZip();
  for (const table of ALL_TABLES) { const data = rows[table].map(row => canonical(row) + "\n").join(""); writeFileSync(join(directory, table + ".jsonl"), data); tables[table] = { path: table + ".jsonl", rowCount: rows[table].length, bytes: Buffer.byteLength(data), sha256: hash(data) }; if ((TABLES as readonly string[]).includes(table)) zip.file(table + "/documents.jsonl", data); }
  const archive = await zip.generateAsync({ type: "nodebuffer" }); writeFileSync(join(directory, "metadata.zip"), archive);
  const inventoryHash = hash(canonical({ schemaVersion: 1, tables }));
  writeFileSync(join(directory, "activation.json"), canonical({ schemaVersion: 1, profileVersion: 2, societyId, folder, publicationId, generation: scope.generation, publishedAt: new Date().toISOString(), sourceSnapshotId: "fixture-snapshot", sourceCatalogSha256: "a".repeat(64), contentHash: "b".repeat(64), expected: Object.fromEntries(TABLES.map(table => [table, rows[table].length])), counts: { opportunity: 1, award: 0 }, coverage: { complete: true, sources: [{ source: "fixture", complete: true }] }, tables, inventoryHash, archives: { "metadata.zip": { bytes: archive.length, sha256: hash(archive) } }, taxonomyCount: 0, taxonomyIndexes: [], taxonomyReleases: [] }) + "\n");
  const output = join(root, "staging", societyId, "catalog.sqlite"); await buildCatalog(directory, output);
  return { societyId, publicationId, inventoryHash, bytesReceived: readFileSync(output).length };
}
const errors: unknown[] = [];
const server = await createCatalogService({ root, issuer, publicKeys: { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }, workspaces: [{ societyId, folder }], origins: [origin], adminSecret, onError: error => errors.push(error) });
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
await new Promise<void>(resolve => server.adminServer.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert(address && typeof address !== "string"); const base = "http://127.0.0.1:" + address.port;
const adminAddress = server.adminServer.address(); assert(adminAddress && typeof adminAddress !== "string"); const adminBase = "http://127.0.0.1:" + adminAddress.port;
const call = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { Authorization: "Bearer " + grant(), Origin: origin, ...init.headers } });
const activate = (input: unknown) => fetch(adminBase + "/admin/activate", { method: "POST", headers: { Authorization: "Bearer " + adminSecret, "Content-Type": "application/json" }, body: JSON.stringify(input) });
try {
  assert.equal((await fetch(base + "/v1/" + societyId + "/catalog")).status, 401);
  assert.equal((await call("/admin/status", { headers: { Authorization: "Bearer " + adminSecret } })).status, 404, "Even an operator secret cannot expose admin routes on the public listener");
  assert.equal((await call("/v1/other/catalog")).status, 401);
  assert.equal((await call("/v1/" + societyId + "/catalog", { headers: { Origin: "https://attacker.invalid" } })).status, 403);
  const first = await fixture("one"), activation = await activate(first);
  assert.equal(activation.status, 200, String(errors[0]) + await activation.text());
  const catalogResponse = await call("/v1/" + societyId + "/catalog"), catalog = await catalogResponse.json();
  assert.equal(catalogResponse.status, 200, String(errors[0]) + JSON.stringify(catalog));
  assert.equal(catalog.publicationId, "one"); assert.equal(catalogResponse.headers.get("cache-control"), "no-store");
  const prefix = "/v1/" + societyId + "/p/one";
  const listResponse = await call(prefix + "/list/opportunity.json"), list = await listResponse.json();
  assert.equal(list.length, 1); assert.equal(JSON.parse(list[0].analyticsJson).closingAt, "2027-01-01T20:00:00Z"); assert(!list[0].analyticsJson.includes("privateUnused"));
  assert.match(listResponse.headers.get("cache-control")!, /private.*immutable/);
  const notice = await (await call(prefix + "/notice?key=opportunity%3Aroads")).json(); assert.equal(JSON.parse(notice.dataJson).body, "Underground zebra conduits"); assert.equal(notice.removed, false);
  const search = await (await call(prefix + "/search?q=zebra&kind=opportunity")).json(); assert.equal(search.matches[0].recordKey, "opportunity:roads");
  assert.equal((await call(prefix + "/search?q=%22%20OR%20*&kind=opportunity")).status, 200, "FTS expressions are treated literally");
  const reviews = await (await call(prefix + "/reviews")).json(); assert.equal(reviews.rows.length, 1);
  const analysisResponse = await call(prefix + "/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: { view: "opportunities" }, asOf: Date.now() }) });
  assert.equal(analysisResponse.status, 200, await analysisResponse.clone().text()); assert.equal((await analysisResponse.json()).result.type, "opportunities"); assert.equal(analysisResponse.headers.get("cache-control"), "no-store");
  const second = await fixture("two");
  const tampered = openCatalog(join(root, "staging", societyId, "catalog.sqlite"), false); tampered.prepare("UPDATE details SET source_json='{}'").run(); tampered.close();
  assert.equal((await activate(second)).status, 503, "failed preparation never switches the pointer");
  assert.equal((await (await call("/v1/" + societyId + "/catalog")).json()).publicationId, "one");
  assert.equal((await call(prefix + "/notice?key=opportunity%3Aroads")).status, 200);
  assert.equal((await call("/v1/" + societyId + "/p/missing/list/award.json")).status, 410);
  assert.equal((await fetch(base + "/healthz")).status, 200);
  console.log("Catalog HTTP checks passed: grant/workspace/origin isolation, real activation workers, thin gzip lists, body search, private evidence, analytics and atomic failure recovery.");
} finally { await new Promise<void>(resolve => { server.close(resolve); server.closeAllConnections(); }); rmSync(root, { recursive: true, force: true }); }
