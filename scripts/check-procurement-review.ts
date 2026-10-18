/**
 * Procurement review reads a Zoer snapshot from one SharePoint folder per
 * workspace and shows it read-only (zoer/docs/societyer-review-contract.md).
 * Checks folder validation and path confinement, the manifest and integrity
 * rules, the SELECT validator, the wa-sqlite catalog port against a real
 * catalog, the bridge refusing writes, the module staying off by default,
 * and the server functions and blob route.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { isProcurementReviewBlobPath, procurementReviewDrivePath, procurementReviewFoldersOverlap, validateProcurementReviewFolder } from "../shared/procurementReview/paths";
import { parseSnapshotManifest, snapshotFilePaths, SNAPSHOT_PART_BYTES, SnapshotFormatError, type SnapshotManifest } from "../shared/procurementReview/manifest";
import { validateCatalogSelect } from "../shared/procurementReview/catalogSelect";
import { defaultIntegrationSettings, validateIntegrationSettings } from "../shared/integrationSettings";
import { deploymentCapabilities, LOCAL_RUNTIME_CAPABILITIES, STATIC_DEMO_CAPABILITIES } from "../shared/deploymentCapabilities";
import { DEMO_PROCUREMENT_REVIEW_DIRECTORY, DEMO_PROCUREMENT_REVIEW_FOLDER } from "../shared/procurementReview/demo";
import { actionPermission } from "../shared/functions/actionPolicy";
import { isModuleEnabled, normalizeModuleSettings, setDeploymentUnavailableModules, settingsToDisabledModules } from "../src/lib/modules";
import { getModuleAccess } from "../src/lib/moduleAccess";
import { fetchSnapshotManifest, loadSnapshotCatalog, readSnapshotDocument, SnapshotIntegrityError, type CatalogCache } from "../src/features/procurementReview/lib/snapshot";
import { openCatalogDatabase } from "../src/features/procurementReview/lib/catalogSql";
import { ReadOnlyCatalog } from "../src/features/procurementReview/lib/readOnlyCatalog";
import { createReviewHost, downloadFileName, READ_ONLY_MESSAGE, validatePluginLocation, type ReviewHostDependencies } from "../src/features/procurementReview/lib/bridge";
import { appPathFor, hrefBaseFor, pluginLocationFor } from "../src/features/procurementReview/lib/navigation";
import { artifactUrls } from "../src/features/procurementReview/lib/artifact";
import { createDemoBlobReader } from "../src/features/procurementReview/lib/blobs";
import { society as demoSociety } from "../src/lib/staticConvexFixtures";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

// 1. Folder validation (contract §3) and the files Societyer may read inside it.
assert.equal(validateProcurementReviewFolder(" Zoer/bc-bid-monitor/Our Society_1.0 "), "Zoer/bc-bid-monitor/Our Society_1.0");
for (const bad of ["", "   ", "/Zoer", "Zoer/", "Zoer//x", "Zoer/../x", "./Zoer", "Zoer/.", "Zoer\\x", "Zoer/x:y", "Zoer/%2e%2e", "Zoer/é", "a".repeat(401), 42]) {
  assert.throws(() => validateProcurementReviewFolder(bad), `rejects folder ${JSON.stringify(bad)}`);
}
assert.equal(validateProcurementReviewFolder("a".repeat(400)).length, 400);
const snapshotId = "20261018T090000Z-0123456789ab";
const fileSha = "f".repeat(64);
for (const good of ["manifest.json", `snapshots/${snapshotId}/catalog.part-000`, `snapshots/${snapshotId}/catalog.part-123`, `files/${fileSha}`, `files/${fileSha}.part-002`]) {
  assert.ok(isProcurementReviewBlobPath(good), `allows ${good}`);
}
for (const bad of ["../manifest.json", "manifest.json/../../x", "/manifest.json", "Manifest.json", "snapshots/x/catalog.part-000", `snapshots/${snapshotId}/catalog.part-0`, `snapshots/${snapshotId}/../catalog.part-000`,
  `snapshots/${snapshotId}/catalog.sqlite`, `files/${fileSha.slice(1)}`, `files/${fileSha.toUpperCase()}`, `files/${fileSha}.part-1`, `files/${fileSha}/x`, "files/", "", `manifest.json?x=1`, `files/${fileSha}%2f`]) {
  assert.equal(isProcurementReviewBlobPath(bad), false, `refuses ${JSON.stringify(bad)}`);
}
assert.equal(procurementReviewDrivePath("Zoer/ws", "manifest.json"), "Zoer/ws/manifest.json");
assert.throws(() => procurementReviewDrivePath("Zoer/ws", "../secret"), /not part of a published/);
assert.throws(() => procurementReviewDrivePath("Zoer/../ws", "manifest.json"));
assert.throws(() => procurementReviewDrivePath(" Zoer/ws", "manifest.json"), /Invalid/, "a stored folder is used exactly as validated");
// Stored with the non-secret integration settings; credentials still can't ride along.
assert.equal(validateIntegrationSettings({ ...defaultIntegrationSettings(), procurementReviewFolder: " Zoer/ws " }).procurementReviewFolder, "Zoer/ws");
assert.equal(validateIntegrationSettings({ ...defaultIntegrationSettings(), procurementReviewFolder: "" }).procurementReviewFolder, "");
assert.throws(() => validateIntegrationSettings({ ...defaultIntegrationSettings(), procurementReviewFolder: "../x" }), /segments/);
const { procurementReviewFolder: _omitted, ...legacySettings } = defaultIntegrationSettings();
assert.equal(validateIntegrationSettings(legacySettings).procurementReviewFolder, undefined, "Settings saved before procurement review stay valid");
assert.throws(() => validateIntegrationSettings({ ...defaultIntegrationSettings(), procurementReviewClientSecret: "x" }), /unsupported fields/);

// 2. The SELECT validator matches zoer/backend/src/catalog-reader.ts.
validateCatalogSelect("SELECT id, json_extract(data,'$.title') FROM records WHERE kind=? LIMIT 5", ["opportunity"]);
validateCatalogSelect("select count(*) from documents where record_id in (?, ?)", ["a", 1]);
for (const [statement, parameters, pattern] of [
  ["SELECT 1; DROP TABLE records", [], /one read-only SELECT/],
  ["WITH x AS (SELECT 1) SELECT * FROM x", [], /one read-only SELECT/],
  ["DELETE FROM records", [], /one read-only SELECT/],
  ["SELECT * FROM main.records", [], /one read-only SELECT/],
  ["SELECT * FROM pragma_table_info('records')", [], /simple aggregates/],
  ["SELECT sqlite_version()", [], /simple aggregates/],
  ["SELECT * FROM temp.documents", [], /one read-only SELECT/],
  ["SELECT load_extension('x')", [], /one read-only SELECT/],
  ["SELECT readfile('/etc/passwd')", [], /simple aggregates/],
  ["SELECT hex(name) FROM documents", [], /simple aggregates/],
  ["SELECT content FROM documents", [], /binary content/],
  [" update records set kind='x'", [], /one read-only SELECT/],
  ["SELECT 1", [{}], /bounded string or number/],
  ["SELECT 1", [Number.NaN], /bounded string or number/],
  ["SELECT 1", Array(201).fill(1), /bounded string or number/],
  ["SELECT 1", "x", /bounded string or number/],
  ["SELECT " + "1,".repeat(5000) + "1", [], /one read-only SELECT/],
] as const) {
  assert.throws(() => validateCatalogSelect(statement, parameters), pattern, statement.slice(0, 60));
}

// 3. A real catalog, published the way Zoer publishes it.
const scratch = join(import.meta.dirname, "..", "tmp", "check-procurement-review");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const catalogPath = join(scratch, "catalog.sqlite");
{
  const db = new DatabaseSync(catalogPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT,sha256 TEXT,content BLOB,text TEXT,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,byte_length INTEGER NOT NULL DEFAULT 0,UNIQUE(record_id,url));
    CREATE TABLE prompts(id TEXT PRIMARY KEY,name TEXT NOT NULL,prompt TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE reviews(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,prompt_id TEXT NOT NULL,prompt_version INTEGER NOT NULL,fingerprint TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,created_at TEXT NOT NULL);
    CREATE TABLE tags(record_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(record_id,value));
    CREATE TABLE batches(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL,error TEXT,updated_at TEXT NOT NULL);
    CREATE TABLE research_tasks(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,attempt INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE workspace_state(key TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE record_history(run_id TEXT NOT NULL,record_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,record_id));`);
  const record = db.prepare("INSERT INTO records VALUES (?,?,?,?,?,?)");
  for (let index = 0; index < 250; index++) {
    const id = `opp-${String(index).padStart(3, "0")}`;
    record.run(id, "opportunity", `Opportunity ${index}`, JSON.stringify({ title: `Opportunity ${index}`, number: `BC-${index}`, attachmentLookup: index === 0 ? { kind: "source", field: "number", value: "S-1" } : undefined }), "h", "2026-10-18");
  }
  record.run("src-1", "source", "Source", JSON.stringify({ number: "S-1", attachments: [{ name: "spec.pdf" }], detailUrl: "https://bcbid.example/1" }), "h", "2026-10-18");
  db.prepare("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("doc-1", "opp-000", "https://bcbid.example/spec.pdf", "spec.pdf", "application/pdf", "x", fileSha, "Specification text", "downloaded", null, "2026-10-18", 9);
  db.prepare("INSERT INTO prompts VALUES (?,?,?,?,?)").run("p1", "Fit", "Is it a fit?", 1, "2026-10-18");
  db.prepare("INSERT INTO reviews VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("r1", "run-1", "opp-000", "p1", 1, "fp", "model", "succeeded", JSON.stringify({ fit: "high" }), null, "2026-10-18");
  db.prepare("INSERT INTO tags VALUES (?,?)").run("opp-000", "starred");
  db.prepare("INSERT INTO batches VALUES (?,?,?,?,?,?,?,?,?)").run("run-1", "review", "stopped", "{}", 1, 0, 1, null, "2026-10-18");
  db.prepare("INSERT INTO record_history VALUES (?,?,?)").run("run-1", "opp-000", JSON.stringify({ title: "Before" }));
  const state = db.prepare("INSERT INTO workspace_state VALUES (?,?,?)");
  state.run("_revision", "7", "2026-10-18");
  state.run("_primary", "true", "2026-10-18");
  state.run("view", JSON.stringify({ columns: ["title"] }), "2026-10-18");
  db.close();
}
const catalogBytes = new Uint8Array(readFileSync(catalogPath));
assert.equal(catalogBytes[18], 2, "the fixture is a WAL-mode database, like a live Zoer catalog");
const catalogSha = sha(catalogBytes);
const id = `20261018T090000Z-${catalogSha.slice(0, 12)}`;
const compressed = gzipSync(catalogBytes);
const partSize = Math.ceil(compressed.byteLength / 3);
const parts = [0, 1, 2].map((index) => compressed.subarray(index * partSize, (index + 1) * partSize));
const pdf = new TextEncoder().encode("%PDF-1.7\n");
const pdfSha = sha(pdf);
const large = new Uint8Array(SNAPSHOT_PART_BYTES + 10).fill(7);
const largeSha = sha(large);
const manifestJson = {
  format: "zoer-plugin-snapshot", formatVersion: 1, pluginId: "bc-bid-monitor", pluginVersion: "0.24.1", snapshotId: id,
  publishedAt: "2026-10-18T09:00:00.000Z", publisher: { zoerVersion: "1.0.0", host: "office-mac" },
  catalog: { encoding: "gzip", sha256: catalogSha, bytes: catalogBytes.byteLength, parts: parts.map((part, index) => ({ path: `snapshots/${id}/catalog.part-00${index}`, bytes: part.byteLength, sha256: sha(part) })) },
  files: { [pdfSha]: { bytes: pdf.byteLength, parts: 0 }, [largeSha]: { bytes: large.byteLength, parts: 2 } },
  counts: { opportunity: 250, source: 1 },
};

// 4. Manifest parsing rejects anything the reader wasn't written for.
const manifest = parseSnapshotManifest(manifestJson);
assert.equal(manifest.snapshotId, id);
const bad = (patch: (value: typeof manifestJson) => unknown, pattern: RegExp) =>
  assert.throws(() => parseSnapshotManifest(patch(structuredClone(manifestJson))), (error: Error) => error instanceof SnapshotFormatError && pattern.test(error.message), pattern.source);
bad((value) => ({ ...value, format: "other" }), /unknown snapshot format/);
bad((value) => ({ ...value, formatVersion: 2 }), /format version 2/);
bad((value) => ({ ...value, pluginId: "other" }), /different plugin/);
bad((value) => ({ ...value, snapshotId: "20261018T090000Z-000000000000" }), /doesn't match its catalog checksum/);
bad((value) => ({ ...value, snapshotId: "../x" }), /invalid snapshot ID/);
bad((value) => { value.catalog.parts.reverse(); return value; }, /should be snapshots/);
bad((value) => { value.catalog.parts[0].path = "../../secret"; return value; }, /should be snapshots/);
bad((value) => { value.catalog.parts[0].bytes = SNAPSHOT_PART_BYTES + 1; return value; }, /invalid size/);
bad((value) => ({ ...value, catalog: { ...value.catalog, encoding: "zstd" } }), /unsupported encoding/);
bad((value) => ({ ...value, files: { "../x": { bytes: 1, parts: 0 } } }), /invalid entry/);
bad((value) => ({ ...value, files: { [fileSha]: { bytes: SNAPSHOT_PART_BYTES + 1, parts: 0 } } }), /isn't split/);
bad((value) => ({ ...value, counts: { opportunity: -1 } }), /record counts/);
bad((value) => ({ ...value, publishedAt: "yesterday" }), /publish time/);
assert.deepEqual(snapshotFilePaths(largeSha, manifest.files[largeSha]), [`files/${largeSha}.part-000`, `files/${largeSha}.part-001`]);

// 5. Integrity: every part, the whole catalog, the cache and each document are checked.
const folderFiles = new Map<string, Uint8Array>([
  ["manifest.json", new TextEncoder().encode(JSON.stringify(manifestJson))],
  ...parts.map((part, index) => [`snapshots/${id}/catalog.part-00${index}`, part] as [string, Uint8Array]),
  [`files/${pdfSha}`, pdf],
  [`files/${largeSha}.part-000`, large.subarray(0, SNAPSHOT_PART_BYTES)],
  [`files/${largeSha}.part-001`, large.subarray(SNAPSHOT_PART_BYTES)],
]);
const requested: string[] = [];
const reader = (files: Map<string, Uint8Array>) => async (path: string) => { requested.push(path); return files.get(path) ?? null; };
assert.equal(await fetchSnapshotManifest(reader(new Map())), null, "An empty folder has no snapshot yet");
await assert.rejects(fetchSnapshotManifest(reader(new Map([["manifest.json", new TextEncoder().encode("{")]]))), SnapshotFormatError);
assert.deepEqual(await fetchSnapshotManifest(reader(folderFiles)), manifest);
const progress: string[] = [];
const loaded = await loadSnapshotCatalog(manifest, reader(folderFiles), { onProgress: (step) => progress.push(step.stage) });
assert.equal(loaded.fromCache, false);
assert.equal(sha(loaded.bytes), catalogSha);
assert.ok(progress.includes("download") && progress.includes("decompress"));
const tampered = new Map(folderFiles);
tampered.set(`snapshots/${id}/catalog.part-001`, parts[1].map((byte, index) => (index === 0 ? byte ^ 1 : byte)));
await assert.rejects(loadSnapshotCatalog(manifest, reader(tampered)), (error: Error) => error instanceof SnapshotIntegrityError && /part 2 of 3 doesn't match/.test(error.message));
const missingPart = new Map(folderFiles);
missingPart.delete(`snapshots/${id}/catalog.part-002`);
await assert.rejects(loadSnapshotCatalog(manifest, reader(missingPart)), /part 3 of 3 is missing/);
// Parts that pass their own checksums but don't assemble to the promised catalog.
const forged = gzipSync(new TextEncoder().encode("not the catalog"));
const forgedManifest = parseSnapshotManifest({ ...manifestJson, catalog: { ...manifestJson.catalog, parts: [{ path: `snapshots/${id}/catalog.part-000`, bytes: forged.byteLength, sha256: sha(forged) }] } });
await assert.rejects(loadSnapshotCatalog(forgedManifest, reader(new Map([[`snapshots/${id}/catalog.part-000`, forged]]))), /doesn't match the manifest checksum/);
const garbage = new Uint8Array([1, 2, 3, 4]);
const garbageManifest = parseSnapshotManifest({ ...manifestJson, catalog: { ...manifestJson.catalog, parts: [{ path: `snapshots/${id}/catalog.part-000`, bytes: 4, sha256: sha(garbage) }] } });
await assert.rejects(loadSnapshotCatalog(garbageManifest, reader(new Map([[`snapshots/${id}/catalog.part-000`, garbage]]))), /valid gzip stream/);
const cacheStore = new Map<string, Uint8Array>();
const cache: CatalogCache = { get: async (key) => cacheStore.get(key) ?? null, put: async (key, bytes) => { cacheStore.clear(); cacheStore.set(key, bytes); } };
await loadSnapshotCatalog(manifest, reader(folderFiles), { cache });
assert.ok(cacheStore.has(id), "A verified catalog is cached by snapshot ID");
requested.length = 0;
assert.equal((await loadSnapshotCatalog(manifest, reader(folderFiles), { cache })).fromCache, true);
assert.deepEqual(requested, [], "A cached snapshot isn't refetched");
cacheStore.set(id, loaded.bytes.map((byte, index) => (index === 100 ? byte ^ 1 : byte)));
assert.equal((await loadSnapshotCatalog(manifest, reader(folderFiles), { cache })).fromCache, false, "A tampered cache entry is refetched, not opened");
assert.deepEqual([...await readSnapshotDocument(manifest, reader(folderFiles), pdfSha)], [...pdf]);
assert.equal(sha(await readSnapshotDocument(manifest, reader(folderFiles), largeSha)), largeSha, "Split documents are reassembled in order");
const badDocument = new Map(folderFiles);
badDocument.set(`files/${pdfSha}`, new TextEncoder().encode("%PDF-1.8\n"));
await assert.rejects(readSnapshotDocument(manifest, reader(badDocument), pdfSha), SnapshotIntegrityError);
await assert.rejects(readSnapshotDocument(manifest, reader(folderFiles), "e".repeat(64)), /isn't in the published snapshot/);

// 6. The wa-sqlite catalog answers with the reference shapes, read-only.
const wasmBinary = readFileSync(join(import.meta.dirname, "..", "node_modules", "@journeyapps", "wa-sqlite", "dist", "wa-sqlite.wasm"));
const sql = await openCatalogDatabase(loaded.bytes, { wasmBinary });
const catalog = await ReadOnlyCatalog.open(sql);
const head = await catalog.workspaceRead({ ids: [] });
assert.deepEqual({ revision: head.revision, primary: head.primary, records: head.records, next: head.next }, { revision: 7, primary: true, records: [], next: null });
await assert.rejects(catalog.workspaceRead({ ids: [], revision: 6 }), /Catalog changed/);
const first = (await catalog.workspaceRead({ ids: ["opp-000", "missing"] })).records;
assert.equal(first.length, 1);
assert.deepEqual((first[0].data as Record<string, unknown>).attachments, [{ name: "spec.pdf" }], "Attachment lookups resolve through the source record");
const page1 = await catalog.workspaceRead({ kind: "opportunity", revision: 7, limit: 200 });
assert.equal(page1.records.length, 200);
assert.equal(page1.next, "opp-199");
const page2 = await catalog.workspaceRead({ kind: "opportunity", after: page1.next, limit: 200 });
assert.equal(page2.records.length, 50);
assert.equal((await catalog.workspaceRead({ match: { kind: "opportunity", field: "number", value: "BC-7" }, limit: 1 })).records[0].id, "opp-007");
await assert.rejects(catalog.workspaceRead({ match: { kind: "opportunity", field: "x') OR 1=1 --", value: "1" } }), /Invalid record lookup/);
await assert.rejects(catalog.workspaceRead({ ids: Array(201).fill("x") }), /at most 200/);
assert.deepEqual(await catalog.workspaceState({ keys: ["view", "absent"] }), { revision: 7, entries: [{ key: "view", value: { columns: ["title"] } }], next: null });
await assert.rejects(catalog.workspaceState({ keys: ["_revision"] }), /Invalid state keys/);
assert.deepEqual((await catalog.workspaceState({})).entries.map((entry) => entry.key), ["view"], "Internal state keys stay hidden");
assert.deepEqual(await catalog.historyRead({ runId: "run-1" }), { rows: [{ id: "opp-000", data: { title: "Before" } }], next: "opp-000" });
const details = await catalog.details("opp-000");
assert.deepEqual(details.tags, ["starred"]);
assert.deepEqual(details.reviews[0].result, { fit: "high" });
assert.equal(details.documents[0].bytes, 9);
assert.equal("content" in details.documents[0], false, "Document rows never carry content");
const overview = await catalog.overview();
assert.deepEqual(overview.counts, [{ kind: "opportunity", count: 250 }, { kind: "source", count: 1 }]);
assert.equal(overview.prompts.length, 1);
assert.equal(overview.batches.length, 1);
const query = await catalog.query("SELECT id, json_extract(data,'$.number') AS number FROM records WHERE kind=? ORDER BY id", ["opportunity"]);
assert.equal(query.rows.length, 200);
assert.equal(query.truncated, true);
assert.deepEqual(query.columns, ["id", "number"]);
assert.deepEqual(query.rows[0], { id: "opp-000", number: "BC-0" });
assert.deepEqual((await catalog.query("SELECT name, bytes FROM documents", [])).rows, [{ name: "spec.pdf", bytes: 9 }], "The console sees the documents view");
await assert.rejects(catalog.query("SELECT * FROM documents WHERE content IS NOT NULL", []), /binary content/);
await assert.rejects(catalog.query("SELECT * FROM nowhere", []), /three-second limit/);
assert.deepEqual(await catalog.document("doc-1"), { name: "spec.pdf", content: fileSha });
assert.equal(await catalog.document("missing"), null);
await assert.rejects(catalog.document("doc-1", "nope"), /Invalid document version/);
await assert.rejects(catalog.document("doc-1", pdfSha), /Retained document version not found/);
await assert.rejects(sql.all("INSERT INTO records VALUES ('x','x','x','{}','x','x')"), /readonly/, "The database itself refuses writes");
await assert.rejects(sql.all("UPDATE workspace_state SET data='0'"), /readonly/);
await catalog.close();

// 7. The bridge: contract §2 reads, everything else refused.
const opened: string[] = [];
const saved: Array<{ name: string; bytes: number }> = [];
let navigatedTo = "";
const deps: ReviewHostDependencies = {
  sourceLabel: "Snapshot published Oct 18, 2026",
  catalog: async (method, input) => {
    if (method === "document") return (input as { id: string }).id === "doc-1" ? { name: "spec/../x.pdf", content: pdfSha } : (input as { id: string }).id === "doc-zip" ? { name: "a.zip", content: largeSha } : null;
    return { method, input };
  },
  readDocument: (content) => readSnapshotDocument(manifest, reader(folderFiles), content),
  navigation: { read: () => ({ version: 1, location: "/home", baseUrl: "https://app.example/app/procurement-review", hrefBase: "/app/procurement-review" }), write: (location) => { navigatedTo = location; return { version: 1, location, baseUrl: "https://app.example/app/procurement-review", hrefBase: "/app/procurement-review" }; } },
  appearance: () => ({ dark: false, tokens: {} as ReturnType<ReviewHostDependencies["appearance"]>["tokens"] }),
  overlay: (open) => ({ open, insets: { top: 0, right: 0, bottom: 0, left: 0 } }),
  previewUrl: () => { opened.push("preview"); return "blob:preview"; },
  download: (bytes, name) => saved.push({ name, bytes: bytes.byteLength }),
};
const host = createReviewHost(deps);
assert.deepEqual(await host.request("host.capabilities"), { version: 1, surface: "societyer", collection: false, writes: false, ai: false, sourceLabel: "Snapshot published Oct 18, 2026" });
assert.deepEqual(await host.request("state", { summary: true }), { runs: [], runsTruncated: false, artifacts: [], capabilities: { readOnly: true } });
assert.deepEqual(await host.request("schedules.read"), { schedules: [] });
assert.deepEqual(await host.request("models"), { models: [], activeModelProfileId: null });
for (const [method, routed] of [["catalog.query", "query"], ["catalog.read", "read"], ["catalog.workspace", "workspace"], ["catalog.history", "history"], ["catalog.record", "record"], ["catalog.state", "state"]]) {
  assert.deepEqual(await host.request(method, { id: "x" }), { method: routed, input: { id: "x" } });
}
assert.deepEqual(await host.request("catalog.preview", { id: "doc-1" }), { url: "blob:preview", mediaType: "application/pdf" });
await assert.rejects(host.request("catalog.preview", { id: "doc-zip" }), /Only PDF files/);
await assert.rejects(host.request("catalog.preview", { id: "missing" }), /Downloaded document not found/);
assert.deepEqual(await host.request("catalog.download", { id: "doc-1", name: "../../etc/passwd" }), { downloaded: true });
assert.equal(saved[0].name, ".._.._etc_passwd");
await host.request("catalog.download", { id: "doc-1" });
assert.equal(saved[1].name, "spec_.._x.pdf", "The stored name is used when the plugin passes none");
const events: string[] = [];
const unsubscribe = host.subscribe((event) => events.push(event));
assert.deepEqual(await host.request("overlay", { open: true }), { open: true, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
host.publish("appearance", {});
unsubscribe();
host.publish("navigation", {});
assert.deepEqual(events, ["overlay", "appearance"]);
assert.deepEqual(await host.request("navigation.write", { location: "/opportunities/opp-1?tab=docs", mode: "replace" }), { version: 1, location: "/opportunities/opp-1?tab=docs", baseUrl: "https://app.example/app/procurement-review", hrefBase: "/app/procurement-review" });
assert.equal(navigatedTo, "/opportunities/opp-1?tab=docs");
for (const target of ["https://evil.example", "//evil.example", "opportunities", "/x\\y", 7, "/" + "x".repeat(2000)]) {
  await assert.rejects(host.request("navigation.write", { location: target }), /Invalid navigation target/);
}
for (const method of ["catalog.save", "catalog.upsert", "catalog.delete", "catalog.open", "catalog.tag", "catalog.writeState", "records.review", "records.star", "pursuits.update", "triage.decide", "profiles.save", "prompts.save", "schedules.write", "schedules.run", "collection.run", "sources.refresh", "runs.start", "evidence", "models.select", "imports.run", "bulk.download", "__proto__", "constructor", "hasOwnProperty"]) {
  await assert.rejects(host.request(method, {}), (error: Error) => error.message === READ_ONLY_MESSAGE, `${method} is refused`);
}
assert.equal(validatePluginLocation("/"), "/");
assert.equal(downloadFileName(""), "document");
assert.equal(pluginLocationFor("/app/procurement-review", ""), "/");
assert.equal(pluginLocationFor("/app/procurement-review/", "?q=1"), "/?q=1");
assert.equal(pluginLocationFor("/app/procurement-review/opportunities/opp-1", "?tab=docs"), "/opportunities/opp-1?tab=docs");
assert.equal(appPathFor("/"), "/app/procurement-review");
assert.equal(appPathFor("/?q=1"), "/app/procurement-review?q=1");
assert.equal(appPathFor("/opportunities/opp-1"), "/app/procurement-review/opportunities/opp-1");
assert.equal(pluginLocationFor("/app/procurement-review/procurement", "?notice=BC-7"), "/procurement?notice=BC-7", "A deep link keeps its query string");
assert.equal(hrefBaseFor("/demo/app/procurement-review"), "/demo/app/procurement-review");
assert.equal(hrefBaseFor("/societyer/app/procurement-review/"), "/societyer/app/procurement-review", "hrefBase never ends in a slash");
const pin = { pluginId: "bc-bid-monitor" as const, pluginVersion: "0.24.1", sha256: { "index.js": "a".repeat(64), "style.css": "b".repeat(64) } };
assert.deepEqual(artifactUrls(pin, "/"), { script: "/plugins/bc-bid-monitor/index.js?v=aaaaaaaaaaaaaaaa", style: "/plugins/bc-bid-monitor/style.css?v=bbbbbbbbbbbbbbbb" });

// 8. Off by default for every workspace, and unavailable without SharePoint.
assert.equal(normalizeModuleSettings(undefined).procurementReview, false, "New workspaces start with it off");
assert.equal(normalizeModuleSettings({ disabledModules: ["grants"] }).procurementReview, false, "Existing workspaces start with it off");
assert.equal(normalizeModuleSettings({ name: "Society with no module choices" } as Parameters<typeof normalizeModuleSettings>[0]).procurementReview, false);
assert.equal(normalizeModuleSettings({ disabledModules: ["procurementReview"] }).procurementReview, false);
assert.equal(normalizeModuleSettings({ disabledModules: ["+procurementReview"] }).procurementReview, true, "A workspace turns it on with +procurementReview");
assert.equal(normalizeModuleSettings({ disabledModules: ["+grants"] }).grants, true, "An opt-in marker can't turn a default-on module off");
assert.equal(normalizeModuleSettings({ modules: { procurementReview: true } }).procurementReview, true);
assert.equal(normalizeModuleSettings({ modules: { procurementReview: false, grants: false } }).grants, false);
const turnedOn = { ...normalizeModuleSettings({ disabledModules: ["grants"] }), procurementReview: true };
assert.deepEqual(settingsToDisabledModules(turnedOn), ["grants", "+procurementReview"]);
assert.deepEqual(normalizeModuleSettings({ disabledModules: settingsToDisabledModules(turnedOn) }), turnedOn, "Stored choices round-trip");
assert.deepEqual(settingsToDisabledModules(normalizeModuleSettings(undefined)), [], "Defaults store nothing");
assert.equal(isModuleEnabled({ disabledModules: ["+procurementReview"] }, "procurementReview"), true);
setDeploymentUnavailableModules({ procurementReview: "No SharePoint here." });
assert.equal(isModuleEnabled({ disabledModules: ["+procurementReview"] }, "procurementReview"), false, "Unavailable on the deployment reads as off");
assert.ok(getModuleAccess("Owner", { disabledModules: ["+procurementReview"] }).find((row) => row.key === "procurementReview")!.notes.includes("No SharePoint here."));
setDeploymentUnavailableModules({});
const memberAccess = getModuleAccess("Member", { disabledModules: ["+procurementReview"] }).find((row) => row.key === "procurementReview")!;
assert.equal(memberAccess.actions.view, true);
assert.equal(memberAccess.actions.manage, false);
assert.equal(getModuleAccess("Admin", undefined).find((row) => row.key === "procurementReview")!.actions.manage, true);
const sharePointEnv = { AUTH_MODE: "convex", PROCUREMENT_SHAREPOINT_TENANT_ID: "11111111-1111-1111-1111-111111111111", PROCUREMENT_SHAREPOINT_CLIENT_ID: "22222222-2222-2222-2222-222222222222", PROCUREMENT_SHAREPOINT_CLIENT_SECRET: "secret", PROCUREMENT_SHAREPOINT_SITE_ID: "site", PROCUREMENT_SHAREPOINT_DRIVE_ID: "drive", PROCUREMENT_SHAREPOINT_TRANSFER_HOSTS: "files.example.test" };
assert.equal(deploymentCapabilities(sharePointEnv).procurementReview, true, "SharePoint configured: available, with or without the gateway");
assert.equal(deploymentCapabilities(Object.fromEntries(Object.entries(sharePointEnv).map(([key, value]) => [key.replace("PROCUREMENT_SHAREPOINT_", "SHAREPOINT_"), value]))).procurementReview, false, "The meeting-file writer never enables the procurement reader");
assert.equal(deploymentCapabilities({ ...sharePointEnv, PROCUREMENT_SHAREPOINT_DRIVE_ID: "" }).procurementReview, false);
assert.equal(LOCAL_RUNTIME_CAPABILITIES.procurementReview, false, "The local runtimes have no route to SharePoint");
assert.equal(STATIC_DEMO_CAPABILITIES.procurementReview, true, "The demo reads the snapshot bundled with the app");
assert.equal(actionPermission("procurementReview:folder", "query"), "documents:read");
assert.equal(actionPermission("procurementReview:setFolder", "mutation"), "settings:write");

// 9. Server: module, membership, permission and deployment checks; the blob route confines paths.
const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./procurementReview.js": () => import("../convex/procurementReview"),
  "./society.js": () => import("../convex/society"),
  "./http.js": () => import("../convex/http"),
} as unknown as Parameters<typeof convexTest>[1]);
process.env.AUTH_MODE = "better-auth";
process.env.SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT = "1";
for (const key of Object.keys(sharePointEnv)) if (key !== "AUTH_MODE") delete process.env[key];
const issuer = betterAuthIssuer();
const { societyId, otherSocietyId } = await native.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Review", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const otherSocietyId = await ctx.db.insert("societies", { name: "Other", isCharity: false, isMemberFunded: false, updatedAt: 0, disabledModules: ["+procurementReview"] });
  for (const [role, subject] of [["Owner", "owner"], ["Admin", "admin"], ["Member", "member"]] as const) {
    await ctx.db.insert("users", { societyId, role, displayName: role, status: "Active", email: `${subject}@example.org`, authIssuer: issuer, authSubject: subject, createdAtISO: new Date().toISOString() });
  }
  return { societyId, otherSocietyId };
});
const workspaceFolder = `Zoer/bc-bid-monitor/${societyId}`;
const admin = native.withIdentity({ issuer, subject: "admin" });
const member = native.withIdentity({ issuer, subject: "member" });
await assert.rejects(admin.mutation(api.procurementReview.setFolder, { societyId, folder: workspaceFolder }), /SharePoint/, "Unavailable without the deployment's SharePoint connection");
Object.assign(process.env, sharePointEnv, { AUTH_MODE: "better-auth" });
await assert.rejects(admin.query(api.procurementReview.folder, { societyId }), /disabled for this workspace/, "Off until the workspace turns it on");
await admin.mutation(api.society.updateModules, { societyId, disabledModules: ["+procurementReview"] });
assert.deepEqual(await member.query(api.procurementReview.folder, { societyId }), { folder: null });
await assert.rejects(member.mutation(api.procurementReview.setFolder, { societyId, folder: workspaceFolder }), /settings:write/);
await assert.rejects(admin.mutation(api.procurementReview.setFolder, { societyId, folder: "Zoer/../other" }), /segments/);
await assert.rejects(admin.query(api.procurementReview.folder, { societyId: otherSocietyId }), /membership|not found|required/i, "Another workspace's folder stays private");
await admin.mutation(api.procurementReview.setFolder, { societyId, folder: ` ${workspaceFolder} ` });
assert.deepEqual(await member.query(api.procurementReview.folder, { societyId }), { folder: workspaceFolder });
const stored = await native.run((ctx) => ctx.db.get(societyId));
assert.equal(stored?.integrationSettings?.procurementReviewFolder, workspaceFolder);
assert.equal(stored?.integrationSettings?.preferredProvider, "existing", "The rest of the storage policy keeps its defaults");
assert.ok(procurementReviewFoldersOverlap("Zoer/A", "zoer/a/sub") && !procurementReviewFoldersOverlap("Zoer/a", "Zoer/ab"));
await native.run((ctx) => ctx.db.patch(otherSocietyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: "Zoer/other" } }));
for (const taken of ["Zoer/other", "zoer/OTHER", "Zoer/other/inner", "Zoer", `Zoer/bc-bid-monitor/${otherSocietyId}`, "Zoer/unclaimed"]) {
  await assert.rejects(admin.mutation(api.procurementReview.setFolder, { societyId, folder: taken }), /workspace's own/, `refuses ${taken}, which overlaps another workspace's folder`);
}
await native.withIdentity({ issuer, subject: "owner" }).mutation(api.society.updateIntegrationSettings, { societyId, integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: "Zoer/other" } });
assert.equal((await native.run((ctx) => ctx.db.get(societyId)))?.integrationSettings?.procurementReviewFolder, workspaceFolder, "Only setFolder changes the folder");

const graphRequests: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  graphRequests.push(url);
  if (url.startsWith("https://login.microsoftonline.com/")) return Response.json({ access_token: "graph-token", token_type: "Bearer", expires_in: 3600 });
  if (url.endsWith(`/root:/${workspaceFolder}/manifest.json:/content`)) return new Response(new TextEncoder().encode('{"ok":true}'));
  return Response.json({ error: { code: "itemNotFound" } }, { status: 404 });
}) as typeof fetch;
try {
  const blob = (path: string, who = member) => who.fetch(`/procurement-review/blob?${new URLSearchParams({ societyId, path })}`, { method: "GET" });
  const ok = await blob("manifest.json");
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '{"ok":true}');
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
  assert.ok(!graphRequests.some((url) => url.includes("..")));
  assert.equal(graphRequests.at(-1), `https://graph.microsoft.com/v1.0/drives/drive/root:/${workspaceFolder}/manifest.json:/content`, "Reads stay under the workspace's folder on the approved drive");
  assert.equal((await blob(`files/${fileSha}`)).status, 404, "A file that isn't published reads as not found");
  graphRequests.length = 0;
  for (const path of ["../manifest.json", "catalog.sqlite", "snapshots/x/catalog.part-000", `files/${fileSha}/../../x`, "%2e%2e/manifest.json"]) {
    assert.equal((await blob(path)).status, 400, `refuses ${path}`);
  }
  assert.deepEqual(graphRequests, [], "Refused paths never reach SharePoint");
  assert.equal((await native.fetch(`/procurement-review/blob?${new URLSearchParams({ societyId, path: "manifest.json" })}`, { method: "GET" })).status, 401, "Signed-in members only");
  assert.equal((await member.fetch(`/procurement-review/blob?${new URLSearchParams({ societyId: otherSocietyId, path: "manifest.json" })}`, { method: "GET" })).status, 403, "Only the member's own workspace");
  await admin.mutation(api.society.updateModules, { societyId, disabledModules: [] });
  assert.equal((await blob("manifest.json")).status, 403, "Turning the module off closes the route");
  await admin.mutation(api.society.updateModules, { societyId, disabledModules: ["+procurementReview"] });
  delete process.env.PROCUREMENT_SHAREPOINT_DRIVE_ID;
  assert.equal((await blob("manifest.json")).status, 503, "No SharePoint connection, no route");
} finally {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(sharePointEnv)) if (key !== "AUTH_MODE") delete process.env[key];
}
rmSync(scratch, { recursive: true, force: true });

// 10. The demo workspace: module on, folder preset, and its bundled snapshot reads like a published folder.
assert.equal(normalizeModuleSettings(demoSociety).procurementReview, true, "The demo workspace turns the module on");
assert.equal(validateProcurementReviewFolder(demoSociety.integrationSettings.procurementReviewFolder), DEMO_PROCUREMENT_REVIEW_FOLDER);
const demoRoot = join(import.meta.dirname, "..", "public", ...DEMO_PROCUREMENT_REVIEW_DIRECTORY.split("/").filter(Boolean));
const demoRequests: string[] = [];
const demoFetch = async (url: string) => {
  demoRequests.push(url);
  const relative = url.slice(`/${DEMO_PROCUREMENT_REVIEW_DIRECTORY}`.length);
  try {
    return new Response(readFileSync(join(demoRoot, ...relative.split("/"))), { status: 200, headers: { "content-type": "application/octet-stream" } });
  } catch {
    return new Response("<!doctype html><title>Societyer</title>", { status: 200, headers: { "content-type": "text/html" } });
  }
};
const demoRead = createDemoBlobReader({ baseUrl: "/", fetch: demoFetch });
await assert.rejects(demoRead("../index.html"), /not part of a published/, "The demo reader stays inside the snapshot layout");
assert.equal(await demoRead(`files/${"0".repeat(64)}`), null, "A static host's app-shell fallback reads as missing");
const demoManifest = await fetchSnapshotManifest(demoRead);
assert.ok(demoManifest, "The demo snapshot is bundled (tsx scripts/build-procurement-review-demo.ts)");
assert.ok(demoRequests.every((url) => url.startsWith(`/${DEMO_PROCUREMENT_REVIEW_DIRECTORY}`)), "The demo never calls the hosted route");
const demoCatalogBytes = (await loadSnapshotCatalog(demoManifest, demoRead)).bytes;
const demoCatalog = await ReadOnlyCatalog.open(await openCatalogDatabase(demoCatalogBytes, { wasmBinary }));
assert.equal((await demoCatalog.workspaceRead({ ids: [] })).primary, true);
assert.deepEqual(Object.fromEntries((await demoCatalog.overview()).counts.map((row) => [row.kind, row.count])), demoManifest.counts);
const demoOpen = await demoCatalog.query("SELECT count(*) AS open FROM records WHERE kind='opportunity' AND lower(json_extract(data,'$.status'))='open'", []);
assert.ok(Number(demoOpen.rows[0].open) >= 25, "Most demo notices are open");
const demoDocuments = await demoCatalog.query("SELECT id, record_id, sha256 FROM documents WHERE status='downloaded' AND length(text)>0 ORDER BY id", []);
assert.ok(demoDocuments.rows.length >= 5);
const demoDetails = await demoCatalog.details(String(demoDocuments.rows[0].record_id));
assert.ok(demoDetails.documents.length >= 1 && demoDetails.record);
const demoDocument = await demoCatalog.document(String(demoDocuments.rows[0].id));
assert.ok(demoDocument);
const demoPdf = await readSnapshotDocument(demoManifest, demoRead, demoDocument.content);
assert.equal(new TextDecoder().decode(demoPdf.subarray(0, 5)), "%PDF-", "Demo documents preview as PDFs");
const demoProfile = await demoCatalog.query("SELECT count(*) AS assessed FROM procurement_assessments WHERE is_current=1 AND profile_version_id=?", ["pv-riverside-1"]);
assert.ok(Number(demoProfile.rows[0].assessed) > 0, "The demo has review workspace assessments for its company profile");
await demoCatalog.close();

console.log("Procurement review checks passed: folder validation and path confinement, manifest and integrity rules, SELECT validator, read-only wa-sqlite catalog, bridge refusals, default-off module, server and blob route access, demo workspace snapshot.");
