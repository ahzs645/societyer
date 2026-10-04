import { overviewPortable as minuteBookOverview } from "../shared/functions/minuteBook";
import { listPortable as listExpenses } from "../shared/functions/expenseReports";
import { overviewPortable as libraryOverview } from "../shared/functions/library";
import { searchPortable as firmSearch } from "../shared/functions/firm";
import { templateEnginePortable } from "../shared/functions/legalDocuments";
import { listForDocumentPortable as listComments } from "../shared/functions/documentComments";
import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableQueryCtx } from "../shared/portable/ctx";
import { getPortable as getDocument, listPortable, publicDocumentAccessPredicate } from "../shared/functions/documents";
import { getPortable as getVersion, latestPortable, listForDocumentPortable } from "../shared/functions/documentVersions";
import { exportAttachmentPagePortable, exportTablePagePortable } from "../shared/functions/exports";
import { getUrlPortable } from "../shared/functions/files";
import { validateUploadHandle, validateUploadMetadata, verifyUploadBytes } from "../shared/storage/uploadVerification";

const db = new MemoryDb({ seed: {
  societies: [{ _id: "society", name: "Security test" }],
  users: [{ _id: "member", societyId: "society", role: "Member", status: "Active", authIssuer: "https://issuer.test", authSubject: "subject" }],
  documents: [
    { _id: "restricted", societyId: "society", title: "Private", category: "Policy", tags: ["public"], storageId: "private-blob" },
    { _id: "public", societyId: "society", title: "Open", category: "Policy", tags: [] },
    { _id: "foreign", societyId: "other-society", title: "Other tenant", category: "Policy", tags: [] },
  ],
  meetingMaterials: [{ _id: "material", societyId: "society", documentId: "restricted", accessLevel: "restricted", availabilityStatus: "available", accessGrants: [] }],
  documentVersions: [
    { _id: "private-version", societyId: "society", documentId: "restricted", version: 1, storageProvider: "demo", storageKey: "private-key", fileName: "private.pdf", isCurrent: true },
    { _id: "open-v1", societyId: "society", documentId: "public", version: 1, storageProvider: "demo", storageKey: "open-one", fileName: "open.pdf", isCurrent: true },
    { _id: "open-v2", societyId: "society", documentId: "public", version: 2, storageProvider: "demo", storageKey: "open-two", fileName: "open.pdf", isCurrent: false },
    { _id: "corrupt-parent", societyId: "society", documentId: "foreign", version: 1, storageProvider: "demo", storageKey: "foreign", fileName: "foreign.pdf", isCurrent: true },
  ],
  storageOwnership: [{ _id: "ownership", societyId: "society", storageId: "private-blob" }],
} });
let signed = 0;
const ctx: PortableQueryCtx = {
  db, principal: { kind: "user", runtime: "test", assurance: "verified-jwt", subject: "subject", issuer: "https://issuer.test", userId: "member", societyId: "society" },
  capabilities: makeCapabilities({ storage: { generateUploadUrl: async () => ({ url: "unused", storageKey: "unused" }), getDownloadUrl: async () => { signed++; return { url: "https://blob.test/private" }; } } }),
  runQuery: async () => { throw new Error("Unexpected nested query"); },
};

assert.equal(await getDocument(ctx, { id: "restricted" }), null);
assert.deepEqual((await listPortable(ctx, { societyId: "society" })).map((row) => row._id), ["public"]);
await assert.rejects(() => listForDocumentPortable(ctx, { documentId: "restricted" }), /not found/);
await assert.rejects(() => getVersion(ctx, { id: "private-version" }), /not found/);
await assert.rejects(() => getVersion(ctx, { id: "corrupt-parent" }), /membership|not found/);
assert.equal((await latestPortable(ctx, { documentId: "public" }))?._id, "open-v1", "rollback must determine the current version, not the largest number");

await db.insert("expenseReports", { societyId: "society", receiptDocumentId: "restricted", title: "Report", incurredAtISO: "2026-01-01" });
assert.equal((await listExpenses(ctx, { societyId: "society" }))[0].receiptDocument, null, "finance previews cannot disclose a hidden receipt");
assert.ok((await libraryOverview(ctx, { societyId: "society" })).referenceDocuments.every((document) => document._id !== "restricted"));
assert.deepEqual(await firmSearch(ctx, { query: "Private" }), [], "search titles inherit document ACL");
await assert.rejects(() => listComments(ctx, { documentId: "restricted" }), /not found/);
const runId = await db.insert("legalPrecedentRuns", { societyId: "society", dataJson: "private-data" });
const generatedId = await db.insert("generatedLegalDocuments", { societyId: "society", draftDocumentId: "restricted", precedentRunId: runId, dataJson: "private-data" });
await db.insert("legalSigners", { societyId: "society", generatedDocumentId: generatedId, fullName: "Private signer" });
await db.insert("sourceEvidence", { societyId: "society", sourceDocumentId: "restricted", title: "Private evidence", createdAtISO: "2026-01-01" });
await db.insert("minuteBookItems", { societyId: "society", documentIds: ["restricted"], title: "Private binder item", effectiveDate: "2026-01-01" });
const binder = await minuteBookOverview(ctx, { societyId: "society" });
assert.equal(binder.items.length, 0);
assert.equal(binder.sourceEvidence.length, 0);
assert.ok(binder.documents.every((document: any) => document._id !== "restricted"), "limited binder previews must deny before projection");
const templateEngine = await templateEnginePortable(ctx, { societyId: "society" });
assert.equal(templateEngine.generatedDocuments.length, 0);
assert.equal(templateEngine.runs.length, 0);
assert.equal(templateEngine.signers.length, 0);
assert.equal((await publicDocumentAccessPredicate(ctx, "society"))(await db.get("restricted")), false, "public tags cannot override linked restricted material");
const paginationOpts = { numItems: 100, cursor: null };
for (const table of ["documents", "documentVersions"]) {
  const page = await exportTablePagePortable(ctx, { societyId: "society", table, paginationOpts });
  assert.ok(page.page.every((row) => table === "documents" ? row._id === "public" : row.documentId === "public"), "metadata export must inherit the document ACL");
}
for (const table of ["generatedLegalDocuments", "legalPrecedentRuns", "legalSigners", "sourceEvidence", "minuteBookItems"]) {
  assert.equal((await exportTablePagePortable(ctx, { societyId: "society", table, paginationOpts })).page.length, 0);
}
const attachments = await exportAttachmentPagePortable(ctx, { societyId: "society", source: "documentVersions", paginationOpts });
assert.equal(attachments.page.length, 2);
await assert.rejects(() => getUrlPortable(ctx, { storageId: "private-blob" }), /not found/);
assert.equal(signed, 0, "deny before a blob download URL is generated");

await db.patch("material", { accessGrants: [{ subjectType: "user", subjectId: "member", subjectLabel: "Member", access: "view" }] });
assert.equal((await getVersion(ctx, { id: "private-version" }))._id, "private-version");
await db.patch("material", { expiresAtISO: "2000-01-01T00:00:00.000Z" });
assert.equal(await getDocument(ctx, { id: "restricted" }), null, "expired grants cannot authorize document delivery");
await assert.rejects(() => getVersion(ctx, { id: "private-version" }), /not found/);
await assert.rejects(() => getDocument({ ...ctx, principal: { kind: "anonymous", runtime: "test", assurance: "none" } }, { id: "public" }), /membership|Authentication/);

// Committee access must use stable person IDs and current appointment dates.
await db.patch("member", { memberId: "member-person", email: "matching@committee.test", displayName: "Same name" });
const committeeDocument = await db.insert("documents", { societyId: "society", title: "Committee private", category: "Other", tags: [], committeeId: "committee-a" });
const unrelatedDocument = await db.insert("documents", { societyId: "society", title: "Other committee", category: "Other", tags: [], committeeId: "committee-b" });
const appointment = await db.insert("committeeMembers", { societyId: "society", committeeId: "committee-a", name: "Same name", email: "matching@committee.test", joinedAt: "2000-01-01" });
assert.equal(await getDocument(ctx, { id: committeeDocument }), null, "matching names and email are review hints, not grants");
await db.patch(appointment, { memberId: "member-person", joinedAt: "2999-01-01" });
assert.equal(await getDocument(ctx, { id: committeeDocument }), null, "future appointments do not grant access");
await db.patch(appointment, { joinedAt: "2000-01-01" });
assert.equal((await getDocument(ctx, { id: committeeDocument }))?._id, committeeDocument);
assert.equal(await getDocument(ctx, { id: unrelatedDocument }), null, "one committee appointment cannot authorize another committee");
await db.patch(appointment, { leftAt: "2001-01-01" });
assert.equal(await getDocument(ctx, { id: committeeDocument }), null, "ended appointments revoke future delivery");

const valid = { societyId: "society", documentId: "public", actorUserId: "member", status: "verified", expiresAtISO: new Date(Date.now() + 60000).toISOString() };
const bound = { societyId: "society", documentId: "public", actorUserId: "member" };
validateUploadHandle(valid, bound, "verified");
for (const patch of [{ actorUserId: "attacker" }, { societyId: "other" }, { documentId: "restricted" }, { status: "consumed" }, { expiresAtISO: "invalid" }, { expiresAtISO: "2000-01-01" }]) {
  assert.throws(() => validateUploadHandle({ ...valid, ...patch }, bound, "verified"), /invalid, expired or already used/);
}
validateUploadMetadata({ fileName: "sample.pdf", fileSizeBytes: 3 });
for (const size of [-1, 1.5, 33 * 1024 * 1024, undefined]) assert.throws(() => validateUploadMetadata({ fileName: "sample.pdf", fileSizeBytes: size }), /known size/);
const bytes = new TextEncoder().encode("abc").buffer;
assert.equal(await verifyUploadBytes(bytes, 3), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
await assert.rejects(() => verifyUploadBytes(bytes, 4), /size does not match/);
console.log("Document security checks passed: same-tenant restricted reads, inherited version/export ACL, expired grants, current-version rollback, bound upload handles and authoritative checksums.");
