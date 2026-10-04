import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";

// The portable registry must enforce the same explicit scope and permissions,
// and surface missing storage rather than returning a successful null upload.
const portableDb = new MemoryDb({ seed: {
  societies: [{ _id: "workspace", name: "Portable upload" }, { _id: "foreign-workspace", name: "Foreign" }],
  users: ["Owner", "Admin", "Director", "Member", "Viewer"].map(role => ({ _id: role, societyId: "workspace", role, status: "Active", authIssuer: "https://portable-upload.test", authSubject: role })),
} });
let portableCalls = 0;
function portableActor(subject: string, available = true) {
  return new PortableRuntime({ db: portableDb,
    principalProvider: () => ({ kind: "user", runtime: "test", assurance: "verified-jwt", issuer: "https://portable-upload.test", subject }),
    capabilities: makeCapabilities(available ? { storage: {
      createUploadUrl: async () => { portableCalls++; return { uploadUrl: "https://uploads.test/scoped", storageKey: "" }; },
      getDownloadUrl: async () => ({ url: null }), delete: async () => {},
    } } : {}),
  }).registerAll(PORTABLE_FUNCTIONS);
}
const portableUpload = (role: string, args: any = { societyId: "workspace" }) => portableActor(role).runMutation("files:generateUploadUrl", args);
assert.equal(await portableUpload("Director", { societyId: "workspace", purpose: "meeting" }), "https://uploads.test/scoped");
assert.equal(await portableUpload("Admin", { societyId: "workspace", purpose: "asset" }), "https://uploads.test/scoped");
const allowedCalls = portableCalls;
for (const [role, args] of [["Viewer", { societyId: "workspace" }], ["Member", { societyId: "workspace" }], ["Owner", {}], ["Owner", { societyId: "foreign-workspace" }], ["Director", { societyId: "workspace", purpose: "inventory" }], ["Owner", { societyId: "workspace", purpose: "toString" }]] as const) {
  await assert.rejects(() => portableUpload(role, args), /permission|workspace|membership|purpose/i);
}
assert.equal(portableCalls, allowedCalls, "denied uploads never reach the storage capability");
await assert.rejects(() => portableActor("Director").runMutation("files:generateLogoUploadUrl", { societyId: "workspace" }), /society:write/);
await assert.rejects(() => portableActor("Owner", false).runMutation("files:generateUploadUrl", { societyId: "workspace" }), /CAPABILITY_UNAVAILABLE: storage/);
console.log("Portable upload parity passed: explicit scope, purpose permissions, denial before capability and structured unavailable storage.");

const modules = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./assets.js": () => import("../convex/assets"),
  "./inventoryHub.js": () => import("../convex/inventoryHub"),
  "./files.js": () => import("../convex/files"),
  "./society.js": () => import("../convex/society"),
  "./documentVersions.js": () => import("../convex/documentVersions"),
};
const test = convexTest(schema, modules);
const issuer = "https://upload.test";
const seeded = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Upload test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const actorUserId = await ctx.db.insert("users", { societyId, email: "owner@upload.test", displayName: "Upload owner", role: "Owner", status: "Active", authSubject: "owner", authIssuer: issuer, createdAtISO: new Date().toISOString() });
  const documentId = await ctx.db.insert("documents", { societyId, title: "Test", category: "Other", tags: [], createdAtISO: new Date().toISOString(), flaggedForDeletion: false });
  await ctx.db.insert("users", { societyId, email: "other@upload.test", displayName: "Other owner", role: "Owner", status: "Active", authSubject: "other", authIssuer: issuer, createdAtISO: new Date().toISOString() });
  const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign upload test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignDocumentId = await ctx.db.insert("documents", { societyId: foreignSocietyId, title: "Foreign", category: "Other", tags: [], createdAtISO: new Date().toISOString(), flaggedForDeletion: false });
  for (const role of ["Admin", "Director", "Member", "Viewer"]) {
    await ctx.db.insert("users", { societyId, email: `${role}@upload.test`, displayName: role, role, status: "Active", authSubject: role, authIssuer: issuer, createdAtISO: new Date().toISOString() });
  }
  await ctx.db.insert("users", { societyId: foreignSocietyId, email: "foreign@upload.test", displayName: "Foreign", role: "Owner", status: "Active", authSubject: "foreign", authIssuer: issuer, createdAtISO: new Date().toISOString() });
  await ctx.db.insert("users", { societyId, email: "disabled@upload.test", displayName: "Disabled", role: "Owner", status: "Disabled", authSubject: "disabled", authIssuer: issuer, createdAtISO: new Date().toISOString() });
  const meetingId = await ctx.db.insert("meetings", { societyId, type: "Board", title: "ACL fixture", scheduledAt: "2026-10-01", electronic: false, status: "Scheduled", attendeeIds: [] });
  const restrictedDocumentId = await ctx.db.insert("documents", { societyId, title: "Restricted", category: "Other", tags: [], createdAtISO: new Date().toISOString(), flaggedForDeletion: false });
  await ctx.db.insert("meetingMaterials", { societyId, meetingId, documentId: restrictedDocumentId, order: 0, requiredForMeeting: false, accessLevel: "restricted", accessGrants: [], availabilityStatus: "available", createdAtISO: new Date().toISOString() });
  return { societyId, actorUserId, documentId, foreignSocietyId, foreignDocumentId, restrictedDocumentId };
});
const owner = test.withIdentity({ issuer, subject: "owner" });
const other = test.withIdentity({ issuer, subject: "other" });
const envKeys = ["RUSTFS_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY", "SOCIETYER_DISABLE_NATIVE_FILE_STORAGE", "SOCIETYER_STORAGE_PROVIDER", "R2_ENDPOINT", "R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "AUTH_MODE", "VITE_AUTH_MODE", "BETTER_AUTH_BASE_URL", "CLERK_JWT_ISSUER_DOMAIN"];
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
  for (const broker of ["better-auth", "clerk"] as const) {
    process.env.AUTH_MODE = broker;
    process.env.VITE_AUTH_MODE = broker;
    process.env.BETTER_AUTH_BASE_URL = broker === "clerk" ? "https://signer.upload.test" : issuer;
    process.env.CLERK_JWT_ISSUER_DOMAIN = issuer;
  // Invoke the production authorized handlers with verified broker identities.
  // Deliberately no client userId or society context in the principal.
  const actor = (subject: string) => test.withIdentity({ issuer, subject });
  const uploadArgs = { societyId: seeded.societyId };
  await assert.rejects(() => owner.mutation(api.files.generateUploadUrl, {} as any), /societyId|workspace|validator/i);
  for (const subject of ["Member", "Viewer", "foreign", "disabled"]) {
    await assert.rejects(() => actor(subject).mutation(api.files.generateUploadUrl, uploadArgs), /permission|membership|disabled/i);
    await assert.rejects(() => actor(subject).mutation(api.files.generateLogoUploadUrl, uploadArgs), /permission|membership|disabled/i);
  }
  await assert.rejects(() => test.mutation(api.files.generateUploadUrl, uploadArgs), /authentication/i);
  await assert.rejects(() => test.withIdentity({ issuer: "https://untrusted.test", subject: "owner" }).mutation(api.files.generateUploadUrl, uploadArgs), /authentication|membership/i);
  for (const purpose of ["document", "meeting", "asset", "inventory"] as const) {
    assert.equal(typeof await owner.mutation(api.files.generateUploadUrl, { ...uploadArgs, purpose }), "string");
    await assert.rejects(() => actor("foreign").mutation(api.files.generateUploadUrl, { ...uploadArgs, purpose }), /membership/i);
  }
  assert.equal(typeof await actor("Director").mutation(api.files.generateUploadUrl, { ...uploadArgs, purpose: "meeting" }), "string");
  await assert.rejects(() => actor("Director").mutation(api.files.generateUploadUrl, { ...uploadArgs, purpose: "asset" }), /financials:write/i);
  await assert.rejects(() => actor("Director").mutation(api.files.generateLogoUploadUrl, uploadArgs), /society:write/i);
  assert.equal(typeof await actor("Admin").mutation(api.files.generateUploadUrl, { ...uploadArgs, purpose: "inventory" }), "string");
  await assert.rejects(() => owner.mutation(api.files.generateUploadUrl, { ...uploadArgs, purpose: "unknown" } as any), /purpose|validator/i);
  process.env.SOCIETYER_DISABLE_NATIVE_FILE_STORAGE = "true";
  await assert.rejects(() => owner.mutation(api.files.generateUploadUrl, uploadArgs), /Native file storage is disabled/);
  assert.equal(typeof await owner.mutation(api.files.generateLogoUploadUrl, uploadArgs), "string", "branding remains available with native document storage disabled");
  const storageId = await test.run(ctx => ctx.storage.store(new Blob([bytes], { type: "text/plain" })));
  const assetArgs = { societyId: seeded.societyId, assetTag: `UPLOAD-${broker}`, name: "Guarded asset", category: "Program equipment", condition: "Good", status: "Available", capitalized: false };
  const imageLessAsset = await owner.mutation(api.assets.create, assetArgs);
  await assert.rejects(() => owner.mutation(api.assets.create, { ...assetArgs, assetTag: `${assetArgs.assetTag}-image`, imageStorageId: storageId }), /Native file storage is disabled/);
  await assert.rejects(() => owner.mutation(api.assets.update, { id: imageLessAsset, patch: { imageStorageId: storageId } }), /Native file storage is disabled/);
  await assert.rejects(() => owner.mutation(api.inventoryHub.upsertItem, { societyId: seeded.societyId, name: "Blocked image", category: "Program equipment", itemType: "asset", unitOfMeasure: "each", imageStorageId: storageId }), /Native file storage is disabled/);
  await owner.mutation(api.assets.update, { id: imageLessAsset, patch: { imageUrl: "https://images.test/external.png" } });
  await test.run(ctx => ctx.db.patch(imageLessAsset, { imageStorageId: storageId }));
  await owner.mutation(api.assets.update, { id: imageLessAsset, patch: { imageStorageId: storageId, name: "Metadata remains editable" } });
  const imageLessItem = await owner.mutation(api.inventoryHub.upsertItem, { societyId: seeded.societyId, name: "Item metadata", category: "Program equipment", itemType: "asset", unitOfMeasure: "each" });
  await test.run(ctx => ctx.db.patch(imageLessItem, { imageStorageId: storageId }));
  await owner.mutation(api.inventoryHub.upsertItem, { id: imageLessItem, societyId: seeded.societyId, name: "Metadata remains editable", category: "Program equipment", itemType: "asset", unitOfMeasure: "each", imageStorageId: storageId });

  await assert.rejects(() => owner.mutation(api.files.attachUploadedFileToDocument, { documentId: seeded.documentId, storageId, fileName: "blocked.txt" }), /Native file storage is disabled/);
  delete process.env.SOCIETYER_DISABLE_NATIVE_FILE_STORAGE;
  await owner.mutation(api.assets.create, { ...assetArgs, assetTag: `${assetArgs.assetTag}-allowed-image`, imageStorageId: storageId });
  await assert.rejects(() => actor("foreign").mutation(api.assets.create, { ...assetArgs, societyId: seeded.foreignSocietyId, assetTag: `${assetArgs.assetTag}-foreign-image`, imageStorageId: storageId }), /storageOwnership not found/i);
  await owner.mutation(api.inventoryHub.upsertItem, { societyId: seeded.societyId, name: "Allowed image", category: "Program equipment", itemType: "asset", unitOfMeasure: "each", imageStorageId: storageId });
  await assert.rejects(() => actor("foreign").mutation(api.inventoryHub.upsertItem, { societyId: seeded.foreignSocietyId, name: "Foreign image", category: "Program equipment", itemType: "asset", unitOfMeasure: "each", imageStorageId: storageId }), /storageOwnership not found/i);
  const attachment = { documentId: seeded.documentId, storageId, fileName: "native.txt", fileSizeBytes: 999, mimeType: "forged/type" };
  await assert.rejects(() => actor("foreign").mutation(api.files.attachUploadedFileToDocument, attachment), /membership/i);
  await assert.rejects(() => actor("Viewer").mutation(api.files.attachUploadedFileToDocument, attachment), /permission/i);
  await assert.rejects(() => actor("Director").mutation(api.files.attachUploadedFileToDocument, { ...attachment, documentId: seeded.restrictedDocumentId }), /documents not found/i);
  await owner.mutation(api.files.attachUploadedFileToDocument, attachment);
  await owner.mutation(api.files.attachUploadedFileToDocument, attachment);
  const native = await test.run(ctx => ctx.db.get(seeded.documentId));
  assert.equal(native?.fileSizeBytes, bytes.length);
  const storageMetadata = await test.run(ctx => ctx.db.system.get(storageId));
  assert.equal(native?.mimeType, storageMetadata?.contentType, "native metadata comes from stored bytes");
  assert.notEqual(native?.mimeType, "forged/type");
  assert.equal((await test.run(ctx => ctx.db.query("storageOwnership").withIndex("by_storage", q => q.eq("storageId", storageId)).collect())).length, 1, "reattaching the same blob keeps one workspace claim");
  await assert.rejects(() => actor("foreign").mutation(api.files.attachUploadedFileToDocument, { ...attachment, documentId: seeded.foreignDocumentId }), /storageOwnership not found/i);
  await assert.rejects(() => actor("Viewer").query(api.files.getUrl, { storageId }), /storageOwnership not found/i);
  console.log(`Native scoped uploads under ${broker} passed: workspace and purpose permissions, branding exception, storage switch, authoritative bytes, ACL, idempotent ownership and foreign denial.`);
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
  }
  console.log("RustFS and R2 upload binding under Better Auth and Clerk passed: authenticated handle, server byte verification, isolated committed key, ignored forged metadata, single-use registration and size mismatch rejection.");
} finally {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
}
