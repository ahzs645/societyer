import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./documentVersions.js": () => import("../convex/documentVersions"),
};
const test = convexTest(schema, modules);
const issuer = "https://upload.test";
const seeded = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Upload test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const actorUserId = await ctx.db.insert("users", { societyId, email: "owner@upload.test", displayName: "Upload owner", role: "Owner", status: "Active", authSubject: "owner", authIssuer: issuer, createdAtISO: new Date().toISOString() });
  const documentId = await ctx.db.insert("documents", { societyId, title: "Test", category: "Other", tags: [], createdAtISO: new Date().toISOString(), flaggedForDeletion: false });
  await ctx.db.insert("users", { societyId, email: "other@upload.test", displayName: "Other owner", role: "Owner", status: "Active", authSubject: "other", authIssuer: issuer, createdAtISO: new Date().toISOString() });
  return { societyId, actorUserId, documentId };
});
const owner = test.withIdentity({ issuer, subject: "owner" });
const other = test.withIdentity({ issuer, subject: "other" });
const envKeys = ["RUSTFS_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY", "SOCIETYER_DISABLE_NATIVE_FILE_STORAGE", "SOCIETYER_STORAGE_PROVIDER", "R2_ENDPOINT", "R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const bytes = new TextEncoder().encode("abc");
let sealedUrl = "";
let written: Uint8Array | undefined;
process.env.RUSTFS_ENDPOINT = "https://storage.test";
process.env.RUSTFS_ACCESS_KEY = "test-access";
process.env.RUSTFS_SECRET_KEY = "test-secret";
delete process.env.SOCIETYER_DISABLE_NATIVE_FILE_STORAGE;
globalThis.fetch = async (input, init) => {
  if (init?.method === "PUT") {
    sealedUrl = String(input);
    written = init.body as Uint8Array;
    return new Response(null, { status: 200 });
  }
  return new Response(bytes, { status: 200, headers: { "content-length": "3" } });
};
try {
  for (const provider of ["rustfs", "r2"] as const) {
    process.env.SOCIETYER_STORAGE_PROVIDER = provider;
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_BUCKET = "test-bucket";
    process.env.R2_ACCESS_KEY_ID = "test-r2-access";
    process.env.R2_SECRET_ACCESS_KEY = "test-r2-secret";
  const upload = await owner.action(api.documentVersions.beginUpload, { societyId: seeded.societyId, documentId: seeded.documentId, fileName: "sample.txt", fileSizeBytes: 3, mimeType: "text/plain" });
  await assert.rejects(() => other.action(api.documentVersions.completeUpload, { uploadHandleId: upload.uploadHandleId }), /invalid, expired or already used/);
  await owner.action(api.documentVersions.completeUpload, { uploadHandleId: upload.uploadHandleId });
  assert.deepEqual(written, bytes);
  assert.ok(sealedUrl.includes("sealed-"));
  assert.ok(!upload.presigned.url.includes("sealed-"), "client PUT permission must not target the committed object");
  const recorded = await owner.mutation(api.documentVersions.recordUploadedVersion, {
    societyId: seeded.societyId, documentId: seeded.documentId,
    uploadHandleId: upload.uploadHandleId, storageProvider: "sharepoint", storageKey: "foreign-object", fileName: "forged.bin", fileSizeBytes: 99, sha256: "forged",
  } as any);
  const version = await owner.query(api.documentVersions.get, { id: recorded.versionId });
  assert.equal(version.storageProvider, provider);
  assert.equal(version.fileName, "sample.txt");
  assert.equal(version.fileSizeBytes, 3);
  assert.equal(version.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.ok(version.storageKey.includes("sealed-"));
  assert.notEqual(version.storageKey, upload.presigned.key);
  const download = new URL(await owner.action(api.documentVersions.getDownloadUrl, { versionId: recorded.versionId }));
  assert.equal(download.hostname, provider === "r2" ? "test-account.r2.cloudflarestorage.com" : "storage.test");
  assert.ok(download.searchParams.get("X-Amz-Credential")?.includes(provider === "r2" ? "/auto/s3/" : "/us-east-1/s3/"));
  await assert.rejects(() => owner.mutation(api.documentVersions.recordUploadedVersion, { societyId: seeded.societyId, documentId: seeded.documentId, uploadHandleId: upload.uploadHandleId, storageProvider: "rustfs", storageKey: version.storageKey, fileName: "sample.txt" }), /invalid, expired or already used/);
  await assert.rejects(() => owner.mutation(api.documentVersions.recordUploadedVersion, { societyId: seeded.societyId, documentId: seeded.documentId, storageProvider: "rustfs", storageKey: "arbitrary", fileName: "sample.txt" }), /server-verified upload handle/);
  const concurrent = await Promise.all(["first.txt", "second.txt"].map((fileName) => owner.action(api.documentVersions.beginUpload, { societyId: seeded.societyId, documentId: seeded.documentId, fileName, fileSizeBytes: 3 })));
  await Promise.all(concurrent.map((entry) => owner.action(api.documentVersions.completeUpload, { uploadHandleId: entry.uploadHandleId })));
  const committed = await Promise.all(concurrent.map((entry) => owner.mutation(api.documentVersions.recordUploadedVersion, { societyId: seeded.societyId, documentId: seeded.documentId, uploadHandleId: entry.uploadHandleId, storageProvider: provider, storageKey: "ignored", fileName: "ignored" })));
  assert.notEqual(committed[0].version, committed[1].version, "concurrent commits allocate distinct authoritative version numbers");
  assert.equal((await owner.query(api.documentVersions.listForDocument, { documentId: seeded.documentId })).filter((row: any) => row.isCurrent).length, 1);
  const mismatch = await owner.action(api.documentVersions.beginUpload, { societyId: seeded.societyId, documentId: seeded.documentId, fileName: "wrong.txt", fileSizeBytes: 4 });
  await assert.rejects(() => owner.action(api.documentVersions.completeUpload, { uploadHandleId: mismatch.uploadHandleId }), /size does not match/);
  const handle = await test.run((ctx) => ctx.db.get(mismatch.uploadHandleId));
  assert.equal(handle?.status, "verifying", "failed verification must not authorize recording");
  }
  console.log("RustFS and R2 upload binding checks passed: authenticated handle, server byte verification, isolated committed key, ignored forged metadata, single-use registration and size mismatch rejection.");
} finally {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
}
