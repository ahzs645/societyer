import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvexClient";
import { society } from "../src/lib/staticConvexFixtures";

// Exercise the public local client, not just the fallback helper. Permissions
// permit these domains for the fixture owner; only exact API declarations and
// the intended handlers may decide which writes are valid.
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
  console.log("PASS local write dispatch: exact declared methods and invocation kinds, no invented receipt/evidence CRUD or shadow table, retained legacy upload/action support and portable receipt immutability.");
} finally {
  await client.close();
}
