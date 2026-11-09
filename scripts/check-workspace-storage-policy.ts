/**
 * Per-workspace storage policy on one shared deployment: a DDC-like workspace
 * (SharePoint, native uploads disabled) next to a First Form-like workspace
 * (native). Every native upload path is exercised through the production
 * handlers; the deployment ceiling always wins.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { effectiveWorkspaceStorage } from "../shared/workspaceStoragePolicy";
import { encodeSharePointLocator } from "../shared/storage/sharePointDeployment";

const issuer = "https://storage-policy.clerk.test";
const site = "https://shared.example.test";
const sharePointEnv = {
  SHAREPOINT_TENANT_ID: "11111111-1111-1111-1111-111111111111", SHAREPOINT_CLIENT_ID: "22222222-2222-2222-2222-222222222222",
  SHAREPOINT_CLIENT_SECRET: "fixture-secret-not-for-use", SHAREPOINT_SITE_ID: "approved-site", SHAREPOINT_DRIVE_ID: "approved-drive", SHAREPOINT_TRANSFER_HOSTS: "files.example.test",
};

// Pure resolver: no row keeps today's deployment behaviour; the flag is a ceiling.
assert.deepEqual(effectiveWorkspaceStorage(null, {}), { nativeUploads: true, documentVersionProvider: "native" });
assert.deepEqual(effectiveWorkspaceStorage(null, { SOCIETYER_STORAGE_PROVIDER: "sharepoint" }), { nativeUploads: true, documentVersionProvider: "sharepoint" });
assert.deepEqual(effectiveWorkspaceStorage(null, { SOCIETYER_DISABLE_NATIVE_FILE_STORAGE: "1" }), { nativeUploads: false, documentVersionProvider: "native" });
assert.deepEqual(effectiveWorkspaceStorage({ nativeUploads: "allowed", documentVersionProvider: "native" }, { SOCIETYER_DISABLE_NATIVE_FILE_STORAGE: "true" }), { nativeUploads: false, documentVersionProvider: "native" }, "ceiling wins over the row");
assert.deepEqual(effectiveWorkspaceStorage({ nativeUploads: "allowed", documentVersionProvider: "sharepoint" }, {}), { nativeUploads: false, documentVersionProvider: "sharepoint" }, "a SharePoint workspace never writes native storage");
assert.deepEqual(effectiveWorkspaceStorage({ nativeUploads: "disabled", documentVersionProvider: "deployment-default" }, { SOCIETYER_STORAGE_PROVIDER: "rustfs" }), { nativeUploads: false, documentVersionProvider: "native" });
assert.deepEqual(effectiveWorkspaceStorage({ nativeUploads: "allowed", documentVersionProvider: "native" }, { SOCIETYER_STORAGE_PROVIDER: "sharepoint" }), { nativeUploads: true, documentVersionProvider: "native" });

const envKeys = ["AUTH_MODE", "VITE_AUTH_MODE", "CLERK_JWT_ISSUER_DOMAIN", "BETTER_AUTH_BASE_URL", "SITE_URL", "CONVEX_SITE_URL", "SOCIETYER_STORAGE_PROVIDER", "SOCIETYER_DISABLE_NATIVE_FILE_STORAGE", "RUSTFS_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY", "OFFLINE_MEETING_PREPARATION_ENABLED", ...Object.keys(sharePointEnv)];
const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  AUTH_MODE: "clerk", VITE_AUTH_MODE: "clerk", CLERK_JWT_ISSUER_DOMAIN: issuer, BETTER_AUTH_BASE_URL: "https://signer.storage-policy.test",
  SITE_URL: site, CONVEX_SITE_URL: "https://storage-policy.convex.site", OFFLINE_MEETING_PREPARATION_ENABLED: "1",
  RUSTFS_ENDPOINT: "https://rustfs.example.test", RUSTFS_ACCESS_KEY: "fixture-access", RUSTFS_SECRET_KEY: "fixture-secret",
});
delete process.env.SOCIETYER_DISABLE_NATIVE_FILE_STORAGE;
delete process.env.SOCIETYER_STORAGE_PROVIDER;
for (const key of Object.keys(sharePointEnv)) delete process.env[key];

const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./workspaceStoragePolicies.js": () => import("../convex/workspaceStoragePolicies"),
  "./files.js": () => import("../convex/files"),
  "./assets.js": () => import("../convex/assets"),
  "./inventoryHub.js": () => import("../convex/inventoryHub"),
  "./offlineMeetings.js": () => import("../convex/offlineMeetings"),
  "./paperless.js": () => import("../convex/paperless"),
  "./transcripts.js": () => import("../convex/transcripts"),
  "./documentVersions.js": () => import("../convex/documentVersions"),
  "./http.js": () => import("../convex/http"),
});
const seeded = await test.run(async (ctx) => {
  const workspace = async (name: string) => {
    const societyId = await ctx.db.insert("societies", { name, isCharity: false, isMemberFunded: false, updatedAt: 0 });
    const userId = await ctx.db.insert("users", { societyId, email: "owner@example.test", displayName: "Owner", role: "Owner", status: "Active", authSubject: "owner", authIssuer: issuer, createdAtISO: new Date().toISOString() });
    const documentId = await ctx.db.insert("documents", { societyId, title: `${name} file`, category: "Other", tags: [], createdAtISO: new Date().toISOString(), flaggedForDeletion: false });
    return { societyId, userId, documentId };
  };
  const ddc = await workspace("DDC North");
  const ff = await workspace("First Form");
  const storageId = await ctx.storage.store(new Blob(["abc"], { type: "text/plain" }));
  return { ddc, ff, storageId };
});
const owner = test.withIdentity({ issuer, subject: "owner" });
const stranger = test.withIdentity({ issuer, subject: "stranger" });
const set = (societyId: string, nativeUploads: "allowed" | "disabled", documentVersionProvider: "deployment-default" | "native" | "sharepoint", reason = "fixture") =>
  test.mutation(internal.workspaceStoragePolicies.set, { societyId: societyId as never, nativeUploads, documentVersionProvider, reason });

const realFetch = globalThis.fetch;
const graphCalls: string[] = [];
globalThis.fetch = async (input) => { graphCalls.push(String(input)); throw new Error("No provider network in this test."); };
try {
  // Operator validation.
  await assert.rejects(set(seeded.ddc.societyId, "disabled", "sharepoint", "  "), /reason/);
  await assert.rejects(set(seeded.ddc.societyId, "disabled", "sharepoint"), /SharePoint is not configured/);
  Object.assign(process.env, sharePointEnv, { SOCIETYER_STORAGE_PROVIDER: "sharepoint" });
  await assert.rejects(set(seeded.ddc.societyId, "allowed", "sharepoint"), /must set nativeUploads to disabled/);
  assert.deepEqual(await set(seeded.ddc.societyId, "disabled", "sharepoint", "DDC keeps files in SharePoint"), { nativeUploads: false, documentVersionProvider: "sharepoint" });
  assert.deepEqual(await set(seeded.ff.societyId, "allowed", "native", "First Form uses native storage"), { nativeUploads: true, documentVersionProvider: "native" });
  assert.equal((await test.query(internal.workspaceStoragePolicies.audit, {})).ok, true);
  assert.equal((await test.query(internal.workspaceStoragePolicies.list, {})).length, 2);

  // Member query.
  assert.deepEqual(await owner.query(api.workspaceStoragePolicies.forWorkspace, { societyId: seeded.ddc.societyId }), { nativeUploads: false, documentVersionProvider: "sharepoint" });
  assert.deepEqual(await owner.query(api.workspaceStoragePolicies.forWorkspace, { societyId: seeded.ff.societyId }), { nativeUploads: true, documentVersionProvider: "native" });
  await assert.rejects(stranger.query(api.workspaceStoragePolicies.forWorkspace, { societyId: seeded.ff.societyId }), /membership/i);
  await assert.rejects(test.query(api.workspaceStoragePolicies.forWorkspace, { societyId: seeded.ff.societyId }), /authentication|membership/i);

  // DDC-like workspace: every native path is refused.
  const disabled = /Native file storage is disabled/;
  const ddc = seeded.ddc;
  const assetArgs = (societyId: string, assetTag: string) => ({ societyId: societyId as never, assetTag, name: "Asset", category: "Program equipment", condition: "Good", status: "Available", capitalized: false });
  const itemArgs = (societyId: string) => ({ societyId: societyId as never, name: "Item", category: "Program equipment", itemType: "asset", unitOfMeasure: "each" });
  await assert.rejects(owner.mutation(api.files.generateUploadUrl, { societyId: ddc.societyId }), disabled);
  await assert.rejects(owner.mutation(api.files.attachUploadedFileToDocument, { documentId: ddc.documentId, storageId: seeded.storageId, fileName: "x.txt" }), disabled);
  await assert.rejects(owner.mutation(api.assets.create, { ...assetArgs(ddc.societyId, "DDC-1"), imageStorageId: seeded.storageId }), disabled);
  const ddcAsset = await owner.mutation(api.assets.create, assetArgs(ddc.societyId, "DDC-2"));
  await assert.rejects(owner.mutation(api.assets.update, { id: ddcAsset, patch: { imageStorageId: seeded.storageId } }), disabled);
  await assert.rejects(owner.mutation(api.inventoryHub.upsertItem, { ...itemArgs(ddc.societyId), imageStorageId: seeded.storageId }), disabled);
  await assert.rejects(owner.mutation(api.offlineMeetings.prepareFileUpload, { societyId: ddc.societyId }), disabled);
  await assert.rejects(owner.mutation(api.offlineMeetings.commitFile, { societyId: ddc.societyId, meetingUuid: "m", storageId: seeded.storageId }), disabled);
  await assert.rejects(owner.action(api.paperless.pullSourceDocument, { societyId: ddc.societyId, documentId: ddc.documentId, externalId: "paperless:1" }), disabled);
  await assert.rejects(owner.mutation(api.paperless.recordPulledSourceDocument, { societyId: ddc.societyId, documentId: ddc.documentId, storageId: seeded.storageId, externalId: "paperless:1", fileName: "x.pdf" }), disabled);
  await assert.rejects(owner.mutation(internal.transcripts._claimPipelineStorage, { societyId: ddc.societyId, storageId: seeded.storageId }), disabled);
  await assert.rejects(owner.mutation(api.documentVersions.createDemoVersion, { societyId: ddc.societyId, documentId: ddc.documentId, fileName: "demo.txt" }), disabled);
  assert.equal(typeof await owner.mutation(api.files.generateLogoUploadUrl, { societyId: ddc.societyId }), "string", "branding uploads stay available");
  // Document versions go to SharePoint, never native storage.
  const ddcUpload = await owner.action(api.documentVersions.beginUpload, { societyId: ddc.societyId, documentId: ddc.documentId, fileName: "record.pdf", mimeType: "application/pdf", fileSizeBytes: 3 });
  assert.equal(ddcUpload.presigned.provider, "sharepoint");
  assert.ok(ddcUpload.presigned.url.startsWith("https://storage-policy.convex.site/document-storage/sharepoint/upload?"));
  assert.equal((await owner.query(api.documentVersions.storageCapabilities, { societyId: ddc.societyId })).activeProvider, "sharepoint");

  // First Form-like workspace on the same deployment: native paths work.
  const ff = seeded.ff;
  assert.equal(typeof await owner.mutation(api.files.generateUploadUrl, { societyId: ff.societyId }), "string");
  await owner.mutation(api.files.attachUploadedFileToDocument, { documentId: ff.documentId, storageId: seeded.storageId, fileName: "native.txt" });
  await owner.mutation(api.assets.create, { ...assetArgs(ff.societyId, "FF-1"), imageStorageId: seeded.storageId });
  await owner.mutation(api.inventoryHub.upsertItem, { ...itemArgs(ff.societyId), imageStorageId: seeded.storageId });
  assert.equal(typeof await owner.mutation(api.offlineMeetings.prepareFileUpload, { societyId: ff.societyId }), "string");
  await owner.mutation(internal.transcripts._claimPipelineStorage, { societyId: ff.societyId, storageId: seeded.storageId });
  const ffUpload = await owner.action(api.documentVersions.beginUpload, { societyId: ff.societyId, documentId: ff.documentId, fileName: "native.pdf", mimeType: "application/pdf", fileSizeBytes: 3 });
  assert.equal(ffUpload.presigned.provider, "rustfs", "a native workspace uses native storage even where SharePoint is the deployment default");
  assert.ok(ffUpload.presigned.url.startsWith("https://rustfs.example.test/"));
  assert.equal((await owner.query(api.documentVersions.storageCapabilities, { societyId: ff.societyId })).activeProvider, "rustfs");
  // A handle allocated for one provider is void once the workspace switches.
  await set(ff.societyId, "disabled", "sharepoint", "moving to SharePoint");
  await assert.rejects(owner.action(api.documentVersions.completeUpload, { uploadHandleId: ffUpload.uploadHandleId }), /different storage provider/);
  await set(ff.societyId, "allowed", "native", "back to native");

  // SharePoint broker routes refuse a workspace whose provider isn't SharePoint.
  const pendingHandle = (societyId: string, documentId: string, actorUserId: string) => test.run((ctx) => ctx.db.insert("documentUploadHandles", {
    societyId: societyId as never, documentId: documentId as never, actorUserId: actorUserId as never, provider: "sharepoint", stagingKey: "staging", fileName: "x.pdf",
    fileSizeBytes: 3, expiresAtISO: new Date(Date.now() + 600_000).toISOString(), status: "pending",
  }));
  const put = (handleId: string) => owner.fetch(`/document-storage/sharepoint/upload?uploadHandleId=${handleId}`, { method: "PUT", headers: { Origin: site }, body: new Uint8Array([1, 2, 3]) });
  const ffHandle = await pendingHandle(ff.societyId, ff.documentId, ff.userId);
  const refused = await put(ffHandle);
  assert.equal(refused.status, 403, await refused.clone().text());
  assert.equal(graphCalls.length, 0, "no Microsoft request for a native workspace");
  assert.equal((await put(ddcUpload.uploadHandleId)).status, 400, "the DDC handle passes the policy gate and reaches Microsoft (stubbed to fail)");
  assert.ok(graphCalls.length > 0);
  const locator = encodeSharePointLocator({ provider: "sharepoint", tenantId: sharePointEnv.SHAREPOINT_TENANT_ID, siteId: "approved-site", driveId: "approved-drive", itemId: "item-1" });
  const version = (societyId: string, documentId: string, userId: string) => test.run((ctx) => ctx.db.insert("documentVersions", {
    societyId: societyId as never, documentId: documentId as never, version: 1, storageProvider: "sharepoint", storageKey: locator, fileName: "x.pdf",
    fileSizeBytes: 3, sha256: "a".repeat(64), uploadedByUserId: userId as never, uploadedAtISO: new Date().toISOString(), isCurrent: true,
  }));
  const before = graphCalls.length;
  const ffDownload = await owner.fetch(`/document-storage/sharepoint/download?versionId=${await version(ff.societyId, ff.documentId, ff.userId)}`, { headers: { Origin: site } });
  assert.equal(ffDownload.status, 403);
  assert.equal(graphCalls.length, before, "the download broker refuses before contacting Microsoft");
  await owner.fetch(`/document-storage/sharepoint/download?versionId=${await version(ddc.societyId, ddc.documentId, ddc.userId)}`, { headers: { Origin: site } });
  assert.ok(graphCalls.length > before, "the SharePoint workspace reaches the broker");

  // Deployment ceiling wins: no workspace can allow native uploads above it.
  process.env.SOCIETYER_DISABLE_NATIVE_FILE_STORAGE = "1";
  assert.deepEqual(await owner.query(api.workspaceStoragePolicies.forWorkspace, { societyId: ff.societyId }), { nativeUploads: false, documentVersionProvider: "native" });
  await assert.rejects(owner.mutation(api.files.generateUploadUrl, { societyId: ff.societyId }), disabled);
  await assert.rejects(owner.action(api.documentVersions.beginUpload, { societyId: ff.societyId, documentId: ff.documentId, fileName: "native.pdf", fileSizeBytes: 3 }), disabled);
  await assert.rejects(set(ff.societyId, "allowed", "native"), /disabled on this deployment/);
  await assert.rejects(set(ff.societyId, "disabled", "native"), /disabled on this deployment/);
  assert.ok((await test.query(internal.workspaceStoragePolicies.audit, {})).issues.some((issue) => issue.kind === "native-above-ceiling"));
  assert.equal((await owner.action(api.documentVersions.beginUpload, { societyId: ddc.societyId, documentId: ddc.documentId, fileName: "record.pdf", fileSizeBytes: 3 })).presigned.provider, "sharepoint");
  delete process.env.SOCIETYER_DISABLE_NATIVE_FILE_STORAGE;

  // Two policy rows for one workspace are refused rather than guessed.
  await test.run((ctx) => ctx.db.insert("workspaceStoragePolicies", { societyId: ff.societyId, nativeUploads: "allowed", documentVersionProvider: "native", updatedAtISO: "", reason: "duplicate" }));
  await assert.rejects(owner.mutation(api.files.generateUploadUrl, { societyId: ff.societyId }), /more than one storage policy/);
  await set(ff.societyId, "allowed", "native", "collapse duplicates");
  assert.equal(typeof await owner.mutation(api.files.generateUploadUrl, { societyId: ff.societyId }), "string");

  console.log("Workspace storage policy passed: deployment ceiling, SharePoint-only DDC workspace refused on every native path, native First Form workspace on the same deployment, provider-bound upload handles, workspace-gated SharePoint broker routes, member-only policy reads and operator validation.");
} finally {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
