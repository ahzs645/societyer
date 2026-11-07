import assert from "node:assert/strict";
import { mock } from "node:test";
import { PDFDocument } from "pdf-lib";
import { StaticConvexClient } from "../src/lib/staticConvexClient";
import { society } from "../src/lib/staticConvexFixtures";

// Exercise the public local client, not just the fallback helper. Permissions
// permit these domains for the fixture owner; only exact API declarations and
// the intended handlers may decide which writes are valid.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-07T20:00:00Z") });
const client = new StaticConvexClient();
try {
  const societyId = society._id;
  const documentId = await client.mutation("documents:create", {
    societyId, title: "Synthetic dispatch integrity evidence", category: "Finance", tags: ["synthetic_fixture"],
  });
  const uploaded = await client.mutation("documentVersions:createDemoVersion", {
    societyId, documentId, fileName: "synthetic-evidence.pdf", mimeType: "application/pdf", fileSizeBytes: 32,
  });
  assert.ok(uploaded.versionId, "a declared legacy upload mutation remains available");
  const download = await client.action("documentVersions:getDownloadTarget", { versionId: uploaded.versionId });
  assert.equal(download.kind, "url", "a declared legacy action remains available");
  assert.match(download.url, /^demo:/);

  const acknowledgementId = await client.mutation("receipts:issue", {
    societyId, documentKind: "acknowledgement", idempotencyKey: "synthetic-dispatch-acknowledgement",
    donorName: "Synthetic donor", amountCents: 1000, eligibleAmountCents: 0,
    receivedOnISO: "2026-01-01", location: "Synthetic place", isNonCash: false,
  });
  const before = await client.exportLocalWorkspaceSnapshotAsync();
  const protectedTables = ["documents", "documentVersions", "donationReceipts", "organizationTaxRegistrations", "donationReceiptSequences"] as const;
  const protectedRecords = (snapshot: typeof before) => Object.fromEntries(protectedTables.map(table => [table, snapshot.tables[table] ?? []]));

  for (const [name, args] of [
    ["documents:update", { id: documentId, patch: { content: "Synthetic unreviewed replacement" } }],
    ["documents:updateCategory:undeclared", { id: documentId, patch: { content: "Synthetic alternate method" } }],
    ["documentVersions:update", { id: uploaded.versionId, patch: { sha256: "f".repeat(64), storageKey: "synthetic-replacement" } }],
    ["documentVersions:removeUnsafe", { id: uploaded.versionId }],
    ["receipts:update", { id: acknowledgementId, patch: { eligibleAmountCents: 1000, documentKind: "official_tax_receipt" } }],
    ["receipts:issueUnsafe", { societyId, documentKind: "official_tax_receipt", eligibleAmountCents: 1000 }],
    ["documentVersions:markUploadVerified", { societyId }],
  ] as const) {
    await assert.rejects(() => client.mutation(name, args), /Unknown local write function/);
  }
  await assert.rejects(() => client.action("documents:updateDraftContent", { id: documentId, content: "Synthetic alternate invocation" }), /requires mutation\(\)/);
  await assert.rejects(() => client.action("receipts:remove", { id: acknowledgementId }), /requires mutation\(\)/);
  await assert.rejects(() => client.mutation("documentVersions:getDownloadTarget", { versionId: uploaded.versionId }), /requires action\(\)/);

  const after = await client.exportLocalWorkspaceSnapshotAsync();
  assert.deepEqual(protectedRecords(after), protectedRecords(before), "rejected calls cannot mutate receipts, retained evidence, registrations or serials");
  assert.equal(after.tables.receipts, undefined, "the public receipt alias cannot create a shadow table with a duplicate receipt ID");
  await assert.rejects(() => client.mutation("receipts:remove", { id: acknowledgementId }), /cannot be deleted/, "the declared portable handler still enforces receipt immutability");
  assert.ok((await client.query("receipts:list", { societyId })).some((row: any) => row._id === acknowledgementId));

  // Match the browser receipt walkthrough: uploaded authority proof is reviewed,
  // then a separate signed PDF is uploaded and finalized. Every upload happens
  // in the same fixed millisecond so a time-only version ID cannot replace an
  // earlier document's evidence. Store real synthetic bytes and checksums.
  const uploadPdf = async (title: string, existingDocumentId?: string) => {
    const documentId = existingDocumentId ?? await client.mutation("documents:create", { societyId, title, category: "Finance", tags: ["synthetic_fixture"] });
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(`Synthetic test evidence: ${title}`);
    const bytes = await pdf.save();
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
    const blob = new Blob([bytes], { type: "application/pdf" });
    await client.saveLocalWorkspaceFile(blob, sha256);
    const uploaded = await client.mutation("documentVersions:recordUploadedVersion", {
      societyId, documentId, storageProvider: "local-indexeddb", storageKey: `local-indexeddb:${sha256}:${documentId}`,
      fileName: "synthetic-receipt-evidence.pdf", mimeType: "application/pdf", fileSizeBytes: bytes.length, sha256,
    });
    await client.saveLocalWorkspaceFile(blob, sha256, [`version:${uploaded.versionId}`, `document:${documentId}`]);
    return { documentId, versionId: uploaded.versionId, version: uploaded.version };
  };
  const authority = await uploadPdf("Reviewed registration authority");
  const authorityProof = (await client.query("receipts:evidenceForReview", { societyId, documentIds: [authority.documentId], requireFile: true }))[0];
  assert.ok(authorityProof.fingerprint);
  await client.mutation("receipts:recordRegistration", {
    societyId, status: "registered", evidenceReviewed: true, charityNumber: "123456789RR0001",
    registeredName: "Synthetic registered charity", registeredAddress: "100 Synthetic Street, Victoria BC",
    effectiveFrom: "2026-01-01", evidenceDocumentIds: [authority.documentId],
    expectedEvidenceFingerprints: [{ documentId: authority.documentId, fingerprint: authorityProof.fingerprint }],
  });
  const officialId = await client.mutation("receipts:issue", {
    societyId, documentKind: "official_tax_receipt", idempotencyKey: "synthetic-dispatch-official",
    sourceAcknowledgementId: acknowledgementId, donorName: "Synthetic donor", donorAddress: "200 Synthetic Street, Victoria BC",
    amountCents: 1000, eligibleAmountCents: 1000, advantageAmountCents: 0,
    receivedOnISO: "2026-01-01", intendedIssueDate: "2026-11-07", location: "Synthetic place", isNonCash: false, giftEligibilityConfirmed: true,
  });
  const signed = await uploadPdf("Signed paper receipt");
  assert.notEqual(signed.versionId, authority.versionId, "uploads in one millisecond must retain distinct document versions");
  assert.equal((await client.query("documentVersions:get", { id: authority.versionId })).documentId, authority.documentId);
  const retainedAuthority = (await client.query("receipts:evidenceForReview", { societyId, documentIds: [authority.documentId], requireFile: true }))[0];
  assert.equal(retainedAuthority.fingerprint, authorityProof.fingerprint, "uploading a signed copy cannot replace the registration evidence");
  const signedProof = (await client.query("receipts:evidenceForReview", { societyId, documentIds: [signed.documentId], requireFile: true }))[0];
  await client.mutation("receipts:finalizeOfficial", {
    id: officialId, signedCopyDocumentId: signed.documentId, expectedSignedCopyRevision: signedProof.fingerprint,
    signedOn: "2026-11-07", signatoryName: "Synthetic authorized signer", authorityConfirmed: true,
  });
  const issued = (await client.query("receipts:list", { societyId })).find((row: any) => row._id === officialId);
  assert.equal(issued.issueStatus, "issued");
  assert.equal(issued.signedCopySnapshot.documentVersionId, signed.versionId);
  assert.equal(issued.issuerSnapshot.evidenceSnapshots[0].documentVersionId, authority.versionId);
  const laterSigned = await uploadPdf("Later file, not the issued original", signed.documentId);
  assert.notEqual(laterSigned.versionId, signed.versionId);
  assert.equal(laterSigned.version, 2);
  assert.equal((await client.query("documentVersions:get", { id: signed.versionId })).sha256, signedProof.sha256, "a later upload retains the pinned signed original");
  console.log("PASS local write dispatch: exact declared methods and invocation kinds, no invented receipt/evidence CRUD or shadow table, retained legacy upload/action support and portable receipt immutability.");
  console.log("PASS local receipt upload lifecycle: distinct same-millisecond version IDs, unchanged reviewed registration, finalized signed issue and retained older signed version.");
} finally {
  await client.close();
  mock.timers.reset();
}
