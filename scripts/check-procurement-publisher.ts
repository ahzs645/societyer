/**
 * Server-side procurement publishing: the connection string Zoer decodes, the
 * workspace-scoped publisher key and its /procurement-publisher route, and the
 * scripts' endpoint transport end to end over real HTTP on 127.0.0.1.
 *
 * `--bundle DIR` runs dist-procurement-publisher/*.mjs instead of the sources.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { defaultIntegrationSettings } from "../shared/integrationSettings";
import { decodePublisherConnection, encodePublisherConnection, PUBLISHER_CONNECTION_PREFIX } from "../shared/procurementReview/publisherConnection";
import { createPublisherClient, readPublisherKey } from "./procurement/publisher-client";

// --- Connection string (Zoer implements the same decoder; keep this vector stable) ---
const vector = { endpoint: "https://example-123.convex.site/procurement-publisher", key: "0123456789abcdef".repeat(4), societyId: "k17abc", folder: "Zoer/bc-bid-monitor/k17abc" };
const encoded = encodePublisherConnection(vector);
assert.equal(encoded, PUBLISHER_CONNECTION_PREFIX + Buffer.from(JSON.stringify(vector)).toString("base64url"), "base64url of the fixed-order JSON, no padding");
assert.deepEqual(decodePublisherConnection(encoded), vector);
assert.deepEqual(decodePublisherConnection(`  ${encoded}\n`), vector, "Surrounding whitespace from a paste is ignored");
assert.deepEqual(decodePublisherConnection(encodePublisherConnection({ ...vector, endpoint: "http://127.0.0.1:3211/procurement-publisher", folder: "Zoer/bc-bid-monitor/k17abc/DDC North" })).folder, "Zoer/bc-bid-monitor/k17abc/DDC North");
const raw = (value: unknown) => PUBLISHER_CONNECTION_PREFIX + Buffer.from(JSON.stringify(value)).toString("base64url");
for (const [label, text] of [
  ["wrong prefix", encoded.replace("v1", "v2")],
  ["padding", encoded + "="],
  ["not base64url", PUBLISHER_CONNECTION_PREFIX + "abc+/"],
  ["not JSON", PUBLISHER_CONNECTION_PREFIX + Buffer.from("{nope").toString("base64url")],
  ["extra field", raw({ ...vector, extra: "x" })],
  ["missing field", raw({ endpoint: vector.endpoint, key: vector.key, societyId: vector.societyId })],
  ["plain HTTP host", raw({ ...vector, endpoint: "http://example-123.convex.site/procurement-publisher" })],
  ["other path", raw({ ...vector, endpoint: "https://example-123.convex.site/other" })],
  ["query string", raw({ ...vector, endpoint: vector.endpoint + "?x=1" })],
  ["uppercase key", raw({ ...vector, key: vector.key.toUpperCase() })],
  ["short key", raw({ ...vector, key: "ab" })],
  ["foreign folder", raw({ ...vector, folder: "Zoer/bc-bid-monitor/other" })],
] as const) assert.throws(() => decodePublisherConnection(text), Error, label);

// --- Convex functions and the HTTP route ---
for (const key of ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SITE_ID", "DRIVE_ID", "TRANSFER_HOSTS"]) process.env[`PROCUREMENT_SHAREPOINT_${key}`] = "synthetic";
process.env.CONVEX_SITE_URL = "https://publisher-fixture.convex.site";
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./http.js": () => import("../convex/http"), "./authorization.js": () => import("../convex/authorization"),
  "./procurementPublisher.js": () => import("../convex/procurementPublisher"), "./procurementStatus.js": () => import("../convex/procurementStatus"),
  "./procurementCatalog.js": () => import("../convex/procurementCatalog"), "./procurementCatalogOperator.js": () => import("../convex/procurementCatalogOperator"),
} as Record<string, () => Promise<unknown>>);
const api = anyApi, issuer = betterAuthIssuer(), now = Date.now();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const fixture = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Publisher fixture", isCharity: false, isMemberFunded: false, disabledModules: ["+procurementReview"], updatedAt: now });
  const other = await ctx.db.insert("societies", { name: "Other", isCharity: false, isMemberFunded: false, disabledModules: ["+procurementReview"], updatedAt: now });
  const folder = `Zoer/bc-bid-monitor/${societyId}`;
  await ctx.db.patch(societyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: folder } });
  await ctx.db.patch(other, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: `Zoer/bc-bid-monitor/${other}` } });
  const users: Record<string, Id<"users">> = {};
  for (const [subject, role, society] of [["owner", "Owner", societyId], ["viewer", "Viewer", societyId], ["otherOwner", "Owner", other]] as const)
    users[subject] = await ctx.db.insert("users", { societyId: society, email: `${subject}@example.invalid`, displayName: subject, role, status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-11-23" });
  return { societyId, other, folder, users };
});
const owner = t.withIdentity({ subject: "owner", issuer }), viewer = t.withIdentity({ subject: "viewer", issuer }), otherOwner = t.withIdentity({ subject: "otherOwner", issuer });
const scope = { societyId: fixture.societyId }, key1 = "a1".repeat(32), key2 = "b2".repeat(32);
const settings = () => owner.query(api.procurementPublisher.settings, scope);
const post = (key: string | null, body: unknown, raw?: string) => t.fetch("/procurement-publisher", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: raw ?? JSON.stringify(body) });
const call = async (key: string | null, operation: string, data?: unknown) => { const response = await post(key, data === undefined ? { operation } : { operation, data }); return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() as unknown }; };

assert.equal(await settings(), null);
await assert.rejects(viewer.mutation(api.procurementPublisher.configure, { ...scope, keyHash: sha(key1) }), /permission|settings|access/i);
await assert.rejects(t.mutation(api.procurementPublisher.configure, { ...scope, keyHash: sha(key1) }), /sign|auth|identity/i);
await assert.rejects(otherOwner.mutation(api.procurementPublisher.configure, { ...scope, keyHash: sha(key1) }), /access|membership|workspace|bound|permission/i);
await assert.rejects(owner.mutation(api.procurementPublisher.configure, scope), /Create a connection key first/);
await assert.rejects(owner.mutation(api.procurementPublisher.configure, { ...scope, keyHash: "A".repeat(64) }), /Invalid publisher key hash/);
await owner.mutation(api.procurementPublisher.configure, { ...scope, keyHash: sha(key1) });
const created = await settings();
assert.equal(created.enabled, true); assert.equal(created.lastUsedAt, null);
assert.equal(JSON.stringify(created).includes(sha(key1)), false, "The settings query never returns the key hash");
await assert.rejects(otherOwner.mutation(api.procurementPublisher.configure, { societyId: fixture.other, keyHash: sha(key1) }), /different key/);

for (const header of [null, "x".repeat(64), "1".repeat(63), key1.toUpperCase()]) assert.equal((await call(header, "status")).status, 403);
assert.equal((await post(null, null, "Bearer")).status, 403);
assert.deepEqual(await call("9".repeat(64), "status"), { status: 403, cache: "no-store", body: { error: "Access denied." } });
assert.equal((await post("9".repeat(64), null, "{not json")).status, 403, "Unknown keys see 403 even with a malformed body");
const status = await call(key1, "status");
assert.deepEqual(status, { status: 200, cache: "no-store", body: { societyId: fixture.societyId, folder: fixture.folder, catalogSource: "convex", serviceOnlyAllowed: false } });
const used = await settings();
assert.equal(used.lastOperation, "status"); assert.ok(used.lastUsedAt >= now);

const publishedAt = new Date(now - 10_000).toISOString();
const announcement = { schemaVersion: 1, societyId: fixture.societyId, folder: fixture.folder, publicationId: "publisher-source", sourceSnapshotId: "publisher-snapshot", publishedAt, complete: false, coverage: { complete: false, sources: [] }, state: "published", phase: "exporting", heartbeatAt: new Date(now - 9000).toISOString() };
assert.deepEqual(await call(key1, "reportSource", announcement), { status: 200, cache: "no-store", body: { accepted: true, state: "published" } });
const sourceRows = () => t.run(ctx => ctx.db.query("procurementSourcePublications").collect());
assert.equal((await sourceRows()).length, 1);
const rejected = { status: 409, cache: "no-store", body: { error: "Publisher request rejected. Check the workspace, folder and receipt." } };
assert.deepEqual(await call(key1, "reportSource", { ...announcement, societyId: fixture.other, folder: `Zoer/bc-bid-monitor/${fixture.other}`, publicationId: "foreign" }), rejected, "A key reports only for its own workspace");
assert.match((await settings()).lastError, /another workspace/);
assert.deepEqual(await call(key1, "reportSource", { ...announcement, publicationId: "extra", unexpected: true }), rejected, "The existing validator rejects unexpected receipt fields");
assert.deepEqual(await call(key1, "reportSource", { ...announcement, publicationId: "changed", folder: `Zoer/bc-bid-monitor/${fixture.societyId}/elsewhere` }), rejected);
assert.equal((await sourceRows()).length, 1, "Rejected receipts write nothing");
assert.deepEqual(await call(key1, "unknown"), rejected);
assert.deepEqual(await call(key1, "status", ["array"]), rejected);
assert.deepEqual(await call(key1, "status", { $bad: 1 }), rejected, "JSON Convex cannot store is still rejected cleanly");
assert.equal((await post(key1, null, "{not json")).status, 409);
assert.equal((await post(key1, { operation: "status", data: { pad: "x".repeat(70 * 1024) } })).status, 409, "Bodies over 64 KB are refused");
assert.deepEqual(await call(key1, "publicationPolicy"), rejected, "No catalog service is provisioned for this workspace yet");

process.env.PROCUREMENT_CATALOG_URL = "https://catalog.fixture.test"; process.env.PROCUREMENT_CATALOG_ALLOWED_WORKSPACES = fixture.societyId;
assert.deepEqual((await call(key1, "publicationPolicy", { societyId: fixture.societyId })).body, { serviceOnlyAllowed: false, fallbackUntil: null });
assert.deepEqual(await call(key1, "publicationPolicy", { societyId: fixture.other }), rejected);
const receiptJson = JSON.stringify({ schemaVersion: 1, societyId: fixture.societyId, folder: fixture.folder, publicationId: "publisher-source", generation: "publisher-source-reader-v2", inventoryHash: "a".repeat(64), contentHash: "b".repeat(64), sourceSnapshotId: "publisher-snapshot", publishedAt, activatedAt: new Date(now).toISOString(), counts: { opportunity: 1, award: 0 } });
assert.deepEqual(await call(key1, "recordPublication", { receiptJson }), { status: 200, cache: "no-store", body: null });
assert.equal((await call(key1, "recordPublication", { receiptJson })).status, 200, "An exact retry is idempotent");
assert.deepEqual(await call(key1, "recordPublication", { receiptJson: receiptJson.replace('"opportunity":1', '"opportunity":2') }), rejected);
assert.deepEqual(await call(key1, "recordPublication", { receiptJson, extra: 1 }), rejected);
assert.equal((await t.run(ctx => ctx.db.query("procurementServicePublications").collect())).length, 1);
await call(key1, "status"); assert.equal((await settings()).lastError, null, "lastError clears after a success");
await t.run(ctx => ctx.db.patch(fixture.societyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: fixture.folder, procurementCatalogSource: "service" } }));
assert.equal((await call(key1, "reportSource", { ...announcement, state: "ready", phase: "ready", heartbeatAt: new Date(now - 5000).toISOString() })).status, 200, "Ready is accepted once the service publication is recorded");
assert.equal(((await call(key1, "status")).body as { catalogSource: string }).catalogSource, "service");

// Replacing, disabling and removing the key; an owner who loses settings access takes the key with them.
await owner.mutation(api.procurementPublisher.configure, { ...scope, keyHash: sha(key2) });
assert.equal((await call(key1, "status")).status, 403, "The replaced key stops working at once");
assert.equal((await settings()).lastUsedAt, null);
assert.equal((await call(key2, "status")).status, 200);
await owner.mutation(api.procurementPublisher.configure, { ...scope, enabled: false });
assert.equal((await settings()).enabled, false); assert.equal((await call(key2, "status")).status, 403);
await assert.rejects(viewer.mutation(api.procurementPublisher.configure, { ...scope, enabled: true }), /permission|settings|access/i);
await owner.mutation(api.procurementPublisher.configure, { ...scope, enabled: true });
assert.equal((await call(key2, "status")).status, 200);
await t.run(ctx => ctx.db.patch(fixture.users.owner, { role: "Viewer" }));
assert.equal((await call(key2, "status")).status, 403, "The key stops working when its creator loses settings access");
await t.run(ctx => ctx.db.patch(fixture.users.owner, { role: "Owner" }));
await assert.rejects(viewer.mutation(api.procurementPublisher.revoke, scope), /permission|settings|access/i);
await owner.mutation(api.procurementPublisher.revoke, scope);
assert.equal(await settings(), null); assert.equal((await call(key2, "status")).status, 403);

// --- Script transport over real HTTP (127.0.0.1 bridge to the test deployment) ---
await owner.mutation(api.procurementPublisher.configure, { ...scope, keyHash: sha(key1) });
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
  const headers: Record<string, string> = {};
  for (const name of ["authorization", "content-type"]) { const header = request.headers[name]; if (typeof header === "string") headers[name] = header; }
  const result = await t.fetch(request.url ?? "/", { method: request.method, headers, body: Buffer.concat(chunks) });
  response.writeHead(result.status, { "content-type": result.headers.get("content-type") ?? "application/json" }); response.end(Buffer.from(await result.arrayBuffer()));
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/procurement-publisher`;
const directory = mkdtempSync(join(tmpdir(), "procurement-publisher-"));
const bundleIndex = process.argv.indexOf("--bundle"), bundle = bundleIndex < 0 ? null : resolve(process.argv[bundleIndex + 1]);
const runTool = (name: string, args: string[]) => new Promise<{ code: number | null; stdout: string; stderr: string }>(done => {
  const child = spawn(process.execPath, bundle ? [join(bundle, `${name}.mjs`), ...args] : ["--import", "tsx", `scripts/procurement/${name}.ts`, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: directory } });
  let stdout = "", stderr = ""; child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
  child.on("close", code => done({ code, stdout, stderr }));
});
try {
  const keyFile = join(directory, "publisher.key"), loose = join(directory, "loose.key"), input = join(directory, "source.json");
  writeFileSync(keyFile, key1 + "\n", { mode: 0o600 }); chmodSync(keyFile, 0o600);
  writeFileSync(loose, key1, { mode: 0o644 }); chmodSync(loose, 0o644);
  assert.equal(readPublisherKey(keyFile), key1);
  assert.throws(() => readPublisherKey(loose), /0600/);
  assert.throws(() => createPublisherClient("http://example.test/procurement-publisher", keyFile), /HTTPS/);
  const client = createPublisherClient(endpoint, keyFile);
  assert.deepEqual(await client.status(), { societyId: fixture.societyId, folder: fixture.folder, catalogSource: "service", serviceOnlyAllowed: false });
  await assert.rejects(client.run("reportSource", { ...announcement, societyId: fixture.other }), /rejected reportSource \(HTTP 409\)/);

  writeFileSync(input, JSON.stringify({ ...announcement, publicationId: "script-source", sourceSnapshotId: "script-snapshot", heartbeatAt: new Date(Date.now() - 1000).toISOString() }));
  const transport = ["--publisher-endpoint", endpoint, "--publisher-key-file", keyFile];
  const reported = await runTool("report-source-publication", [...transport, "--input", input]);
  assert.equal(reported.code, 0, reported.stderr); assert.deepEqual(JSON.parse(reported.stdout), { accepted: true, state: "published" });
  assert.ok((await sourceRows()).some(row => row.publicationId === "script-source"), "The script's receipt reached Convex through the endpoint");
  const both = await runTool("report-source-publication", [...transport, "--deployment", "industrious-cricket-610", "--input", input]);
  assert.notEqual(both.code, 0); assert.match(both.stderr, /Usage:/);
  const looseRun = await runTool("report-source-publication", ["--publisher-endpoint", endpoint, "--publisher-key-file", loose, "--input", input]);
  assert.notEqual(looseRun.code, 0); assert.match(looseRun.stderr, /0600/);
  const publishUsage = await runTool("publish-catalog-service", ["--input", directory, "--config", input, "--publisher-endpoint", endpoint]);
  assert.notEqual(publishUsage.code, 0); assert.match(publishUsage.stderr, /Usage:.*--publisher-key-file/);
  await owner.mutation(api.procurementPublisher.configure, { ...scope, enabled: false });
  const refused = await runTool("report-source-publication", [...transport, "--input", input]);
  assert.notEqual(refused.code, 0); assert.match(refused.stderr, /publisher key was refused/);
} finally { server.close(); rmSync(directory, { recursive: true, force: true }); }

console.log(`OK: connection string vector and strict decoder, settings-write key management without returning the hash, 403 for unknown/replaced/disabled/orphaned keys, 409 without detail for cross-workspace or invalid requests, 64 KB bound, existing validators reused, and ${bundle ? "the bundled tools" : "the scripts"} reporting over real HTTP with a 0600 key file.`);
