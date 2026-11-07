import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { LocalStoreDb, MemoryDb, MemoryRowStore, makeCapabilities, type PortableMutationCtx } from "../shared/portable/index";
import { archivePortable, mergeConnectorDocumentMetadataPortable, removePortable, updateDraftContentPortable } from "../shared/functions/documents";
import { getPortable as getDocumentVersion, rollbackPortable } from "../shared/functions/documentVersions";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import { getUrlPortable } from "../shared/functions/files";
import { clearLogoPortable, setLogoPortable } from "../shared/functions/society";

for (const backend of ["memory", "local"] as const) {
  const societyId = "evidence-workspace";
  const document = (id: string, extra: Record<string, unknown> = {}) => ({
    _id: id, societyId, title: id, category: "Other", fileName: `${id}.pdf`, mimeType: "application/pdf",
    fileSizeBytes: 30, createdAtISO: "2026-11-01T12:00:00Z", flaggedForDeletion: false, ...extra,
  });
  const version = (id: string, documentId: string, extra: Record<string, unknown> = {}) => ({
    _id: id, societyId, documentId, version: 1, isCurrent: true, fileName: `${documentId}.pdf`,
    mimeType: "application/pdf", fileSizeBytes: 30, sha256: "a".repeat(64), storageProvider: "local", storageKey: `${id}.pdf`, ...extra,
  });
  const seed = {
    ...portableTestSeed(societyId),
    users: [...portableTestSeed(societyId).users, { _id: "member", societyId, role: "Member", status: "Active", authSubject: "member" }],
    documents: [document("signed"), document("inline-proof", { content: "Reviewed authority decision" }), document("versioned-proof"), document("legacy-signed", { storageId: "legacy-blob" }), document("legacy-proof", { storageId: "proof-blob", tags: ["public"] }), document("ordinary")],
    storageOwnership: [{ _id: "legacy-owner", societyId, storageId: "legacy-blob" }, { _id: "proof-owner", societyId, storageId: "proof-blob" }],
    meetingMaterials: [{ _id: "restricted-proof", societyId, documentId: "legacy-signed", accessLevel: "restricted", availabilityStatus: "available", accessGrants: [] }],
    documentVersions: [version("signed-v1", "signed"), version("proof-v1", "versioned-proof")],
    donationReceipts: [
      { _id: "voided-receipt", societyId, documentKind: "official_tax_receipt", issuanceStatus: "issued", voidedAtISO: "2026-11-02T12:00:00Z", signedCopyDocumentId: "signed", signedCopySnapshot: { documentId: "signed", documentVersionId: "signed-v1", fileName: "signed.pdf", mimeType: "application/pdf", sha256: "a".repeat(64) } },
      { _id: "legacy-receipt", societyId, signedCopyDocumentId: "legacy-signed", signedCopySnapshot: { documentId: "legacy-signed", storageId: "legacy-blob", fileName: "legacy-signed.pdf", mimeType: "application/pdf" } },
    ],
    organizationTaxRegistrations: [
      { _id: "reviewed-revision", societyId, registrationType: "CA-CRA-CHARITY", revisionNumber: 1, evidenceDocumentIds: ["inline-proof", "versioned-proof", "legacy-proof"], evidenceSnapshots: [
        { documentId: "inline-proof", fingerprint: "b".repeat(64) },
        { documentId: "versioned-proof", documentVersionId: "proof-v1", fileName: "versioned-proof.pdf", mimeType: "application/pdf", fingerprint: "c".repeat(64) },
        { documentId: "legacy-proof", storageId: "proof-blob", fileName: "legacy-proof.pdf", mimeType: "application/pdf", fingerprint: "d".repeat(64) },
      ] },
      // Removing a reference in a later revision cannot remove the older proof.
      { _id: "latest-revision", societyId, registrationType: "CA-CRA-CHARITY", revisionNumber: 2, supersedesId: "reviewed-revision", evidenceDocumentIds: [] },
    ],
  };
  const db = backend === "memory" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed));
  const downloads: string[] = [];
  const deletedBlobs: string[] = [];
  const ctx: PortableMutationCtx = {
    db, capabilities: makeCapabilities({ storage: {
      getDownloadUrl: async ({ storageKey }) => { downloads.push(storageKey); return { url: `https://files.example/${storageKey}` }; },
      delete: async ({ storageKey }) => { deletedBlobs.push(storageKey); },
    } }), principal: portableTestPrincipal(),
    runQuery: async () => { throw new Error("Unexpected nested query"); },
    runMutation: async () => { throw new Error("Unexpected nested mutation"); },
  };
  for (const id of ["signed", "inline-proof", "versioned-proof", "legacy-signed", "legacy-proof"]) {
    await assert.rejects(removePortable(ctx, { id }), /Archive it instead of deleting/);
    assert.ok(await db.get(id, "documents"), `${backend}: retained parent survives deletion`);
  }
  const before = { documents: await db.query("documents").collect(), versions: await db.query("documentVersions").collect() };
  for (const documentId of ["signed", "versioned-proof", "legacy-signed"]) {
    for (const change of [{ fileName: "altered.pdf" }, { mimeType: "image/png" }, { fileSizeBytes: 300 }, { sha256: "d".repeat(64) }]) {
      await assert.rejects(mergeConnectorDocumentMetadataPortable(ctx, { documentId, title: "Should not partially write", ...change }), /recorded evidence unchanged/);
    }
  }
  assert.deepEqual(await db.query("documents").collect(), before.documents, "guards run before parent metadata writes even without a surrounding transaction");
  assert.deepEqual(await db.query("documentVersions").collect(), before.versions, "file names, types, sizes and hashes remain pinned");
  await assert.rejects(updateDraftContentPortable(ctx, { id: "inline-proof", title: "Changed title", content: "Changed authority decision" }), /recorded evidence unchanged/);
  assert.equal((await db.get("inline-proof", "documents"))?.content, "Reviewed authority decision");
  assert.deepEqual(await db.query("activity").collect(), [], "rejected evidence edits create no activity or partial changes");

  await db.transaction(async () => {
    await mergeConnectorDocumentMetadataPortable(ctx, { documentId: "signed", title: "Scanned signed copy", tags: ["retained"] });
    await archivePortable(ctx, { id: "signed", reason: "Superseded receipt; keep the evidence" });
    assert.ok((await db.get("signed", "documents"))?.archivedAtISO);
    assert.equal((await getDocumentVersion(ctx, { id: "signed-v1" })).sha256, "a".repeat(64), "archiving preserves retrieval of the exact signed version");

    // Uploading a newer file and switching the current pointer does not mutate
    // the receipt's pinned copy; a later current version remains editable.
    await db.patch("signed-v1", { isCurrent: false });
    const { _id: _fixtureId, ...newerVersion } = version("unused", "signed", { version: 2, fileName: "new.pdf", storageKey: "new.pdf" });
    const newerId = await db.insert("documentVersions", newerVersion);
    await mergeConnectorDocumentMetadataPortable(ctx, { documentId: "signed", fileName: "newer-label.pdf", sha256: "e".repeat(64) });
    assert.equal((await getDocumentVersion(ctx, { id: "signed-v1" })).sha256, "a".repeat(64));
    assert.equal((await getDocumentVersion(ctx, { id: newerId })).fileName, "newer-label.pdf");
    await rollbackPortable(ctx, { versionId: "signed-v1" });
    await assert.rejects(mergeConnectorDocumentMetadataPortable(ctx, { documentId: "signed", sha256: "f".repeat(64) }), /recorded evidence unchanged/, "a rollback cannot make the pinned version mutable");

    await removePortable(ctx, { id: "ordinary" });
    assert.equal(await db.get("ordinary", "documents"), null, "unreferenced documents remain removable");

    // Version uploads clear the legacy parent pointer, but a retained snapshot
    // still authorizes the exact old blob through its original document ACL.
    for (const [documentId, storageId] of [["legacy-signed", "legacy-blob"], ["legacy-proof", "proof-blob"]]) {
      await db.patch(documentId, { storageId: undefined, fileName: "later-version.pdf" });
      assert.equal(await getUrlPortable(ctx, { storageId }), `https://files.example/${storageId}`);
      await setLogoPortable(ctx, { societyId, storageId });
      await clearLogoPortable(ctx, { societyId });
      assert.equal(await getUrlPortable(ctx, { storageId }), `https://files.example/${storageId}`);
    }
    assert.deepEqual(deletedBlobs, [], "branding alias reuse cannot delete a signed copy or historical registration proof");
    await setLogoPortable(ctx, { societyId, storageId: "ordinary-branding" });
    await clearLogoPortable(ctx, { societyId });
    assert.deepEqual(deletedBlobs, ["ordinary-branding"], "unreferenced branding can still be cleaned up");
    await db.insert("documents", { societyId, title: "Unrelated public alias", category: "Other", tags: ["public"], storageId: "legacy-blob" });
    const privateAliasId = await db.insert("documents", { societyId, title: "Unrelated private alias", category: "Other", storageId: "proof-blob" });
    await db.insert("meetingMaterials", { societyId, documentId: privateAliasId, accessLevel: "restricted", availabilityStatus: "available", accessGrants: [] });
  });

  const downloadsBeforeDenial = downloads.length;
  const memberCtx = { ...ctx, principal: { ...portableTestPrincipal(), subject: "member" } } as PortableMutationCtx;
  await assert.rejects(getUrlPortable(memberCtx, { storageId: "legacy-blob" }), /storageOwnership not found/, "an unrelated public alias cannot bypass the retained original document ACL");
  const foreignCtx: PortableMutationCtx = { ...ctx, principal: { kind: "user", runtime: "test", assurance: "verified-jwt", subject: "foreign", issuer: "https://foreign.example" } };
  await assert.rejects(getUrlPortable(foreignCtx, { storageId: "proof-blob" }), /storageOwnership not found/, "a retained blob does not grant access to another workspace");
  assert.equal(downloads.length, downloadsBeforeDenial, "denied reads never mint a blob URL");
  assert.equal(await getUrlPortable(memberCtx, { storageId: "proof-blob" }), "https://files.example/proof-blob", "an unrelated private alias cannot suppress access granted by the retained original document");

  const overflowSeed = {
    ...portableTestSeed(societyId), documents: [document("ordinary")],
    organizationTaxRegistrations: Array.from({ length: 201 }, (_, index) => ({ _id: `revision-${index}`, societyId, evidenceDocumentIds: [] })),
  };
  const overflowDb = backend === "memory" ? new MemoryDb({ seed: overflowSeed }) : new LocalStoreDb(new MemoryRowStore(overflowSeed));
  const overflowCtx = { ...ctx, db: overflowDb };
  await assert.rejects(removePortable(overflowCtx, { id: "ordinary" }), /Archive the document instead/, "unreviewably large evidence histories fail closed");
  await overflowDb.transaction(() => archivePortable(overflowCtx, { id: "ordinary", reason: "Retained pending history review" }));
  assert.ok((await overflowDb.get("ordinary", "documents"))?.archivedAtISO);
}

console.log("Receipt evidence retention checks passed on both portable databases: historical proof, voided signed copies, immutable file metadata, archive access, retained native downloads, branding aliases and inherited ACLs.");

// The hosted attachment handler must run the retention guard before claiming
// or attaching a replacement blob; a UI-only restriction would not suffice.
const hosted = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./files.js": () => import("../convex/files"),
  "./society.js": () => import("../convex/society"),
  "./documentVersions.js": () => import("../convex/documentVersions"),
});
const issuer = "https://retained-evidence.test";
const environmentKeys = ["AUTH_MODE", "VITE_AUTH_MODE", "BETTER_AUTH_BASE_URL", "SOCIETYER_DISABLE_NATIVE_FILE_STORAGE"];
const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
process.env.AUTH_MODE = "better-auth";
process.env.VITE_AUTH_MODE = "better-auth";
process.env.BETTER_AUTH_BASE_URL = issuer;
delete process.env.SOCIETYER_DISABLE_NATIVE_FILE_STORAGE;
try {
  const fixture = await hosted.run(async ctx => {
    const societyId = await ctx.db.insert("societies", { name: "Retained evidence test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
    for (const [subject, role] of [["owner", "Owner"], ["member", "Member"]]) {
      await ctx.db.insert("users", { societyId, email: `${subject}@retained-evidence.test`, displayName: subject, role, status: "Active", authSubject: subject, authIssuer: issuer, createdAtISO: "2026-11-01T12:00:00Z" });
    }
    const documentId = await ctx.db.insert("documents", { societyId, title: "Retained signed copy", category: "Other", tags: [], createdAtISO: "2026-11-01T12:00:00Z", flaggedForDeletion: false });
    const meetingId = await ctx.db.insert("meetings", { societyId, type: "Board", title: "Private evidence", scheduledAt: "2026-11-01", electronic: false, status: "Scheduled", attendeeIds: [] });
    await ctx.db.insert("meetingMaterials", { societyId, meetingId, documentId, order: 0, requiredForMeeting: false, accessLevel: "restricted", accessGrants: [], availabilityStatus: "available", createdAtISO: "2026-11-01T12:00:00Z" });
    const storageId = await ctx.storage.store(new Blob(["retained signed bytes"], { type: "application/pdf" }));
    const replacementStorageId = await ctx.storage.store(new Blob(["different bytes"], { type: "application/pdf" }));
    return { societyId, documentId, storageId, replacementStorageId };
  });
  const owner = hosted.withIdentity({ subject: "owner", issuer });
  const attachment = { documentId: fixture.documentId, storageId: fixture.storageId, fileName: "signed.pdf" };
  await owner.mutation(api.files.attachUploadedFileToDocument, attachment);
  await hosted.run(ctx => ctx.db.insert("donationReceipts", {
    societyId: fixture.societyId, documentKind: "official_tax_receipt", issueStatus: "issued", charityNumber: "123456789RR0001", receiptNumber: "000001", donorName: "Donor", amountCents: 100, eligibleAmountCents: 100,
    receivedOnISO: "2026-11-01", location: "Vancouver", isNonCash: false, voidedAtISO: "2026-11-02T12:00:00Z",
    signedCopyDocumentId: fixture.documentId, signedCopySnapshot: { documentId: fixture.documentId, storageId: fixture.storageId, fileName: "signed.pdf", mimeType: "application/pdf", fingerprint: "a".repeat(64) },
  }));
  await owner.mutation(api.files.attachUploadedFileToDocument, attachment);
  const originalDocument = await hosted.run(ctx => ctx.db.get(fixture.documentId));
  await assert.rejects(owner.mutation(api.files.attachUploadedFileToDocument, { ...attachment, fileName: "renamed.pdf" }), /recorded evidence unchanged/);
  await assert.rejects(owner.mutation(api.files.attachUploadedFileToDocument, { ...attachment, storageId: fixture.replacementStorageId }), /recorded evidence unchanged/);
  assert.deepEqual(await hosted.run(ctx => ctx.db.get(fixture.documentId)), originalDocument);
  assert.equal((await hosted.run(ctx => ctx.db.query("storageOwnership").withIndex("by_storage", q => q.eq("storageId", fixture.replacementStorageId)).collect())).length, 0, "rejected native replacement does not claim the new blob");

  const laterVersionId = await hosted.run(ctx => ctx.db.insert("documentVersions", {
    societyId: fixture.societyId, documentId: fixture.documentId, version: 2, storageProvider: "demo", storageKey: "later-file", fileName: "later.pdf", uploadedAtISO: "2026-11-03T12:00:00Z", isCurrent: false,
  }));
  await owner.mutation(api.documentVersions.rollback, { versionId: laterVersionId });
  assert.equal((await hosted.run(ctx => ctx.db.get(fixture.documentId)))?.storageId, undefined, "a version switch clears the current legacy pointer");
  assert.equal(typeof await owner.query(api.files.getUrl, { storageId: fixture.storageId }), "string", "retained snapshot still resolves the original bytes");
  await assert.rejects(hosted.withIdentity({ subject: "member", issuer }).query(api.files.getUrl, { storageId: fixture.storageId }), /storageOwnership not found/);
  await assert.rejects(hosted.withIdentity({ subject: "stranger", issuer }).query(api.files.getUrl, { storageId: fixture.storageId }), /not found|membership|permission|identity/i);
  await owner.mutation(api.society.setLogo, { societyId: fixture.societyId, storageId: fixture.storageId });
  await owner.mutation(api.society.clearLogo, { societyId: fixture.societyId });
  const retainedText = await hosted.run(async ctx => (await ctx.storage.get(fixture.storageId))?.text());
  assert.equal(retainedText, "retained signed bytes", "clearing a branding alias leaves the actual historical evidence bytes intact");
  assert.equal(typeof await owner.query(api.files.getUrl, { storageId: fixture.storageId }), "string");
  console.log("Hosted retention checks passed: authorized native attachment guard, no partial blob claim, original ACL after version switch, and actual signed bytes surviving branding cleanup.");
} finally {
  for (const key of environmentKeys) {
    const value = previousEnvironment[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
