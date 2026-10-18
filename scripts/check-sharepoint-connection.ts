import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { createSharePointTokenSupplier, decodeSharePointLocator, encodeSharePointLocator, readBoundedSharePointUpload, sharePointDeployment } from "../shared/storage/sharePointDeployment";
import { isSharePointBrokerUrl } from "../shared/storage/sharePointBrokerUrl";

process.env.AUTH_MODE = "convex";
process.env.VITE_AUTH_MODE = "convex";
process.env.CONVEX_SITE_URL = "https://sharepoint-test.convex.site";
process.env.SITE_URL = "https://app.example.test";
process.env.BETTER_AUTH_SECRET = "sharepoint-test-not-a-real-deployment-secret-1234";
process.env.SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS = "ddcnorth.com";
process.env.SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT = "1";
process.env.SOCIETYER_DISABLE_NATIVE_FILE_STORAGE = "1";
process.env.SOCIETYER_STORAGE_PROVIDER = "sharepoint";
Object.assign(process.env, {
  SHAREPOINT_TENANT_ID: "11111111-1111-1111-1111-111111111111", SHAREPOINT_CLIENT_ID: "22222222-2222-2222-2222-222222222222",
  SHAREPOINT_CLIENT_SECRET: "fixture-secret-not-for-use", SHAREPOINT_SITE_ID: "approved-site", SHAREPOINT_DRIVE_ID: "approved-drive", SHAREPOINT_TRANSFER_HOSTS: "files.example.test",
});
const connection = sharePointDeployment(process.env);
const locator = { provider: "sharepoint" as const, tenantId: connection.tenantId, siteId: connection.siteId, driveId: connection.driveId, itemId: "test-item" };
assert.deepEqual(decodeSharePointLocator(encodeSharePointLocator(locator), connection), locator);
assert.throws(() => decodeSharePointLocator(encodeSharePointLocator({ ...locator, driveId: "foreign" }), connection), /outside/);
assert.throws(() => decodeSharePointLocator("sharepoint:null", connection), /outside/);
assert.equal(isSharePointBrokerUrl("https://sharepoint-test.convex.site/document-storage/sharepoint/upload", process.env.CONVEX_SITE_URL!), true);
for (const target of ["https://evil.test/document-storage/sharepoint/upload", "https://sharepoint-test.convex.site/api/auth/token", "https://user:pass@sharepoint-test.convex.site/document-storage/sharepoint/upload", "https://files.example.test/file"]) assert.equal(isSharePointBrokerUrl(target, process.env.CONVEX_SITE_URL!), false);
await assert.rejects(() => readBoundedSharePointUpload(new Request("https://test", { method: "PUT", body: new Uint8Array([1, 2, 3]) }), 2, 8), /size/);
await assert.rejects(() => readBoundedSharePointUpload(new Request("https://test", { method: "PUT", body: new Uint8Array([1]) }), 2, 8), /size/);
let tokenRequests = 0;
const token = createSharePointTokenSupplier(process.env, async (url, init) => {
  tokenRequests++;
  assert.equal(String(url), `https://login.microsoftonline.com/${connection.tenantId}/oauth2/v2.0/token`);
  assert.equal(new URLSearchParams(init?.body as URLSearchParams).get("scope"), "https://graph.microsoft.com/.default");
  return Response.json({ access_token: "fixture-graph-token", token_type: "Bearer", expires_in: 3600 });
});
const binding = { tenantId: connection.tenantId, authorizationMode: "application", audience: "https://graph.microsoft.com" };
assert.equal(await token(binding), "fixture-graph-token"); await token(binding); assert.equal(tokenRequests, 1);
await assert.rejects(() => token({ ...binding, tenantId: "foreign" }), /outside/);

const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"), "./documentVersions.js": () => import("../convex/documentVersions"),
  "./http.js": () => import("../convex/http"), "./files.js": () => import("../convex/files"),
} as any);
const seeded = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "SharePoint test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const documentId = await ctx.db.insert("documents", { societyId, title: "Bound file", category: "Other", tags: [], createdAtISO: new Date().toISOString(), flaggedForDeletion: false });
  const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const [subject, role, workspace] of [["owner", "Owner", societyId], ["other", "Owner", societyId], ["viewer", "Viewer", societyId], ["foreign", "Owner", foreignSocietyId]] as const) {
    await ctx.db.insert("users", { societyId: workspace, displayName: subject, email: `${subject}@ddcnorth.com`, authIssuer: process.env.CONVEX_SITE_URL, authSubject: subject, role, status: "Active", createdAtISO: new Date().toISOString() });
  }
  return { societyId, documentId };
});
const actor = (subject: string) => test.withIdentity({ issuer: process.env.CONVEX_SITE_URL, subject, email: `${subject}@ddcnorth.com`, emailVerified: true });
const owner = actor("owner"); const realFetch = globalThis.fetch;
const contents = new Map<string, Uint8Array>(); const graphPaths: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === "login.microsoftonline.com") return Response.json({ access_token: "fixture-graph-token", token_type: "Bearer", expires_in: 3600 });
  if (url.hostname === "files.example.test") {
    assert.equal(new Headers(init?.headers).has("authorization"), false, "Graph tokens must not follow redirects");
    return new Response(contents.get(url.pathname.slice(1)) as BodyInit);
  }
  assert.equal(url.origin, "https://graph.microsoft.com"); graphPaths.push(url.pathname);
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-graph-token");
  if (init?.method === "PUT") {
    assert.equal(new Headers(init.headers).get("If-None-Match"), "*");
    const id = `item-${contents.size + 1}`; const bytes = new Uint8Array(init.body as Uint8Array); contents.set(id, bytes);
    return Response.json({ id, name: "file.pdf", size: bytes.byteLength, eTag: "etag", parentReference: { driveId: connection.driveId } });
  }
  const match = url.pathname.match(/\/items\/([^/]+)\/content$/); assert.ok(match);
  return new Response(null, { status: 302, headers: { Location: `https://files.example.test/${match[1]}?temporary-secret` } });
};
try {
  const args = { ...seeded, fileName: "record.pdf", mimeType: "application/pdf", fileSizeBytes: 3 };
  await assert.rejects(() => owner.mutation(api.files.generateUploadUrl, { societyId: seeded.societyId }), /disabled/i);
  for (const subject of ["viewer", "foreign"]) await assert.rejects(() => actor(subject).action(api.documentVersions.beginUpload, args), /permission|membership|Role/i);
  const upload = await owner.action(api.documentVersions.beginUpload, args);
  assert.equal(upload.presigned.provider, "sharepoint"); assert.ok(!JSON.stringify(upload).includes(process.env.SHAREPOINT_CLIENT_SECRET!));
  const path = new URL(upload.presigned.url).pathname + new URL(upload.presigned.url).search;
  const put = { method: "PUT", headers: { origin: process.env.SITE_URL! }, body: new Uint8Array([1, 2, 3]) };
  assert.equal((await test.fetch(path, put)).status, 401);
  assert.equal((await actor("other").fetch(path, put)).status, 400);
  assert.equal((await owner.fetch(path, { ...put, headers: { origin: "https://evil.test" } })).status, 403);
  assert.equal(graphPaths.length, 0, "Denials happen before Microsoft API calls");
  const transferred = await owner.fetch(path, put); assert.equal(transferred.status, 200, await transferred.text());
  assert.equal((await owner.fetch(path, put)).status, 400, "A transfer handle cannot overwrite committed content");
  await owner.action(api.documentVersions.completeUpload, { uploadHandleId: upload.uploadHandleId });
  const recorded = await owner.mutation(api.documentVersions.recordUploadedVersion, { ...args, uploadHandleId: upload.uploadHandleId, storageProvider: "r2", storageKey: "forged-by-client" });
  const version = await owner.query(api.documentVersions.get, { id: recorded.versionId });
  assert.equal(version.storageProvider, "sharepoint"); assert.ok(version.storageKey.startsWith("sharepoint:")); assert.match(version.sha256!, /^[a-f\d]{64}$/);
  const target = await owner.action(api.documentVersions.getDownloadTarget, { versionId: recorded.versionId });
  assert.ok(isSharePointBrokerUrl(target.url, process.env.CONVEX_SITE_URL!)); assert.ok(!JSON.stringify(target).includes("temporary-secret"));
  const downloadPath = new URL(target.url).pathname + new URL(target.url).search;
  assert.equal((await actor("foreign").fetch(downloadPath)).status, 403);
  const response = await owner.fetch(downloadPath); assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  contents.set("item-1", new Uint8Array([9, 9, 9])); assert.equal((await owner.fetch(downloadPath)).status, 403, "An administrator's out-of-band edit must fail checksum verification");
  await test.run(async ctx => { const user = await ctx.db.query("users").withIndex("by_auth_subject", q => q.eq("authSubject", "owner")).first(); await ctx.db.patch(user!._id, { status: "Disabled" }); });
  assert.equal((await owner.fetch(downloadPath)).status, 403, "A fresh request honors membership revocation");
  assert.equal((await test.run(ctx => ctx.db.system.query("_storage").collect())).length, 0, "No file bytes were stored in Convex");
} finally { globalThis.fetch = realFetch; }
console.log("SharePoint connection passed: scoped tokens, bounded bodies, ACL/actor/origin checks, native-storage denial, sealed metadata, checksum delivery, replay and revocation denial; no Convex blobs.");
