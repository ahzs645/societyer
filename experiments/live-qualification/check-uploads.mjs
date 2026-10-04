/** Real production upload endpoints, broker sessions, native HTTP storage and ACL delivery. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const config = JSON.parse(readFileSync(new URL(".env.accounts.local", import.meta.url), "utf8"));
if (config.convexUrl !== "http://127.0.0.1:43230" || config.authUrl !== "http://127.0.0.1:43487") throw new Error("Isolated qualification endpoints required.");
const ref = name => makeFunctionReference(name);
const clients = {};
for (const account of config.accounts) {
  const response = await fetch(`${config.authUrl}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: config.issuer }, body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(response.ok, true, `Real login for ${account.key}`);
  const cookies = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.ok(cookies, `Real session for ${account.key}`);
  const authResponse = await fetch(`${config.authUrl}/api/auth/token`, { headers: { Cookie: cookies } });
  assert.equal(authResponse.ok, true, `Broker-issued JWT for ${account.key}`);
  const { token } = await authResponse.json();
  assert.ok(token);
  const client = new ConvexHttpClient(config.convexUrl, { logger: false });
  client.setAuth(token); clients[account.key] = client;
}
clients.anonymous = new ConvexHttpClient(config.convexUrl, { logger: false });
const owner = clients["owner-a"], admin = clients["admin-a"], director = clients["director-a"], foreign = clients["owner-b"];
const societyId = config.fixture.societyA;
const roles = ["owner-a", "admin-a", "director-a", "member-a", "viewer-a"];
const hostile = ["owner-b", "disabled-a", "invited-a", "anonymous"];
const run = randomUUID();
const bytes = Buffer.from(`Live production native upload ${run}\n`);
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
const results = [];
async function check(name, body) {
  try { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`); }
}
const denial = /permission|membership|not found|disabled|not active|authentication|authorized/i;
const mutation = (client, name, args) => client.mutation(ref(name), args);
const query = (client, name, args) => client.query(ref(name), args);
async function mustDeny(client, name, args) { await assert.rejects(() => mutation(client, name, args), denial); }
async function upload(client, purpose, content = bytes, mime = "text/plain") {
  const uploadUrl = await mutation(client, "files:generateUploadUrl", { societyId, purpose });
  assert.equal(new URL(uploadUrl).origin, config.convexUrl, "Upload capability must target this isolated backend");
  const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mime }, body: content });
  assert.equal(response.ok, true, "Native storage HTTP upload must succeed");
  const { storageId } = await response.json(); assert.ok(storageId); return storageId;
}
await check("All upload purposes enforce real current roles and hostile principal denial", async () => {
  for (const purpose of ["document", "meeting", "asset", "inventory"]) {
    for (const key of roles) {
      const allowed = ["owner-a", "admin-a"].includes(key) || key === "director-a" && ["document", "meeting"].includes(purpose);
      if (allowed) assert.equal(typeof await mutation(clients[key], "files:generateUploadUrl", { societyId, purpose }), "string");
      else await mustDeny(clients[key], "files:generateUploadUrl", { societyId, purpose });
    }
    for (const key of hostile) await mustDeny(clients[key], "files:generateUploadUrl", { societyId, purpose });
  }
});
await check("Production uploads require an explicit workspace and validate the supplied purpose", async () => {
  await assert.rejects(() => mutation(owner, "files:generateUploadUrl", {}), /societyId|validator/i);
  await assert.rejects(() => mutation(owner, "files:generateUploadUrl", { societyId, purpose: "unknown" }), /purpose|validator/i);
  await mustDeny(owner, "files:generateUploadUrl", { societyId: config.fixture.societyB });
});
await check("Logo capabilities use the same Owner/Admin policy as branding sinks", async () => {
  for (const key of roles) {
    if (["owner-a", "admin-a"].includes(key)) assert.equal(typeof await mutation(clients[key], "files:generateLogoUploadUrl", { societyId }), "string");
    else await mustDeny(clients[key], "files:generateLogoUploadUrl", { societyId });
  }
  for (const key of hostile) await mustDeny(clients[key], "files:generateLogoUploadUrl", { societyId });
  await assert.rejects(() => mutation(owner, "files:generateLogoUploadUrl", {}), /societyId|validator/i);
});
let storageId, documentId;
await check("Actual bytes attach using authoritative storage metadata and download unchanged", async () => {
  storageId = await upload(director, "document");
  documentId = await mutation(director, "documents:create", { societyId, title: `Live upload ${run}`, category: "Other", tags: [] });
  await mutation(director, "files:attachUploadedFileToDocument", { documentId, storageId, fileName: "live.txt", fileSizeBytes: 999, mimeType: "forged/type" });
  const document = await query(owner, "documents:get", { id: documentId });
  assert.equal(document.storageId, storageId); assert.equal(document.fileSizeBytes, bytes.length); assert.equal(document.mimeType, "text/plain");
  const downloadUrl = await query(owner, "files:getUrl", { storageId });
  const response = await fetch(downloadUrl); assert.equal(response.ok, true);
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(downloaded, bytes);
  assert.equal(createHash("sha256").update(downloaded).digest("hex"), createHash("sha256").update(bytes).digest("hex"));
});
await check("Repeated attachment is safe; cross-workspace storage rebinding is denied", async () => {
  assert.ok(documentId); assert.ok(storageId);
  await mutation(director, "files:attachUploadedFileToDocument", { documentId, storageId, fileName: "live.txt" });
  const foreignId = await mutation(foreign, "documents:create", { societyId: config.fixture.societyB, title: `Foreign upload ${run}`, category: "Other", tags: [] });
  await assert.rejects(() => mutation(foreign, "files:attachUploadedFileToDocument", { documentId: foreignId, storageId, fileName: "stolen.txt" }), /storageOwnership not found/i);
  await mustDeny(foreign, "files:attachUploadedFileToDocument", { documentId, storageId, fileName: "stolen.txt" });
});
await check("Denied document readers and writers cannot use guessed blob identifiers", async () => {
  for (const key of ["member-a", "viewer-a", ...hostile]) {
    await assert.rejects(() => query(clients[key], "files:getUrl", { storageId }), denial);
    await mustDeny(clients[key], "files:attachUploadedFileToDocument", { documentId, storageId, fileName: "forged.txt" });
  }
});
await check("Asset photo writes and persisted native image delivery obey financial roles", async () => {
  const photo = await upload(admin, "asset", imageBytes, "image/png");
  const assetId = await mutation(admin, "assets:create", { societyId, assetTag: `UPLOAD-${run}`, name: `Upload asset ${run}`, category: "Program equipment", condition: "Good", status: "Available", capitalized: false, imageStorageId: photo });
  const bundle = await query(owner, "assets:bundle", { id: assetId });
  assert.equal(bundle.asset.imageStorageId, photo); assert.ok(bundle.asset.imageUrl);
  assert.deepEqual(Buffer.from(await (await fetch(bundle.asset.imageUrl)).arrayBuffer()), imageBytes);
  for (const key of ["member-a", ...hostile]) await assert.rejects(() => query(clients[key], "assets:bundle", { id: assetId }), denial);
  for (const key of ["director-a", "member-a", "viewer-a", ...hostile]) await mustDeny(clients[key], "assets:update", { id: assetId, patch: { imageStorageId: photo } });
  await mustDeny(foreign, "assets:create", { societyId: config.fixture.societyB, assetTag: `FOREIGN-UPLOAD-${run}`, name: "Foreign photo claim", category: "Program equipment", condition: "Good", status: "Available", capitalized: false, imageStorageId: photo });
});
await check("Inventory photo writes and persisted native image delivery obey financial roles", async () => {
  const photo = await upload(admin, "inventory", imageBytes, "image/png");
  const itemId = await mutation(admin, "inventoryHub:upsertItem", { societyId, name: `Upload inventory ${run}`, category: "Program equipment", itemType: "asset", unitOfMeasure: "each", imageStorageId: photo });
  const items = await query(owner, "inventoryHub:items", { societyId });
  const item = items.find(value => value._id === itemId);
  assert.equal(item.imageStorageId, photo); assert.ok(item.imageUrl);
  assert.deepEqual(Buffer.from(await (await fetch(item.imageUrl)).arrayBuffer()), imageBytes);
  for (const key of ["member-a", ...hostile]) await assert.rejects(() => query(clients[key], "inventoryHub:items", { societyId }), denial);
  for (const key of ["director-a", "member-a", "viewer-a", ...hostile]) await mustDeny(clients[key], "inventoryHub:upsertItem", { id: itemId, societyId, name: item.name, category: item.category, itemType: item.itemType, unitOfMeasure: item.unitOfMeasure, imageStorageId: photo });
  await mustDeny(foreign, "inventoryHub:upsertItem", { societyId: config.fixture.societyB, name: "Foreign photo claim", category: "Program equipment", itemType: "asset", unitOfMeasure: "each", imageStorageId: photo });
});
const failed = results.filter(row => !row.passed).length;
writeFileSync(new URL("../../artifacts/offline/live-upload-results.json", import.meta.url), JSON.stringify({ completedAt: new Date().toISOString(), endpoint: config.convexUrl, auth: "Real Better Auth email sessions and broker JWTs verified by actual self-hosted Convex", passed: results.length - failed, failed, results, limitations: ["Actual Better Auth broker exercised live; Clerk JWT principal parity tested through native oracle.", "Native storage off and logo exception tested in isolated native oracle; shared live backend storage configuration remained unchanged.", "External RustFS/R2 byte verification tested with deterministic HTTP adapters; no production external storage endpoint configured.", "PowerSync replication and browser viewport qualification are separate suites."] }, null, 2) + "\n");
if (failed) process.exitCode = 1;
