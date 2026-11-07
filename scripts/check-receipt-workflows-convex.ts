import assert from "node:assert/strict";
import { mock } from "node:test";
import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-07T20:00:00Z") });
const api: any = anyApi;
const date = "2026-11-07";
const issuer = betterAuthIssuer();
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./receipts.js": () => import("../convex/receipts"),
} as any);
const ids = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Hosted synthetic society", entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act__british_columbia_", isCharity: true, isMemberFunded: false, updatedAt: 0 });
  const otherId = await ctx.db.insert("societies", { name: "Other synthetic society", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  let ownerId = "";
  for (const [subject, role] of [["receipt-owner", "Owner"], ["receipt-viewer", "Viewer"], ["receipt-director", "Director"]]) {
    const id = await ctx.db.insert("users", { societyId, email: `${subject}@example.invalid`, displayName: subject, role, status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: `${date}T00:00:00Z` });
    if (role === "Owner") ownerId = id;
  }
  const base = { category: "Other", createdAtISO: `${date}T00:00:00Z`, flaggedForDeletion: false, tags: [] };
  const evidenceId = await ctx.db.insert("documents", { ...base, societyId, title: "Synthetic authority decision", content: "Synthetic retained registration decision." });
  const foreignEvidenceId = await ctx.db.insert("documents", { ...base, societyId: otherId, title: "Foreign authority decision", content: "Foreign source" });
  const signedId = await ctx.db.insert("documents", { ...base, societyId, title: "Signed receipt" });
  const emptyId = await ctx.db.insert("documents", { ...base, societyId, title: "Empty metadata", mimeType: "application/pdf" });
  const signedVersionId = await ctx.db.insert("documentVersions", { societyId, documentId: signedId, version: 1, isCurrent: true, fileName: "signed-receipt.pdf", mimeType: "application/pdf", storageProvider: "r2", storageKey: "synthetic/immutable-signed-receipt.pdf", fileSizeBytes: 321, sha256: "a".repeat(64), uploadedAtISO: `${date}T00:00:00Z` });
  const legacyId = await ctx.db.insert("donationReceipts", { societyId, charityNumber: "historical unverified", receiptNumber: "000099", donorName: "Historical donor", amountCents: 100, eligibleAmountCents: 100, receivedOnISO: "2025-11-07", issuedAtISO: "2025-11-07T20:00:00Z", location: "Victoria", isNonCash: false });
  return { societyId, otherId, ownerId, evidenceId, foreignEvidenceId, signedId, emptyId, signedVersionId, legacyId };
});
const owner = t.withIdentity({ subject: "receipt-owner", issuer });
const viewer = t.withIdentity({ subject: "receipt-viewer", issuer });
const director = t.withIdentity({ subject: "receipt-director", issuer });
const ackInput = { societyId: ids.societyId, documentKind: "acknowledgement", idempotencyKey: "hosted-ack", donorName: "Synthetic donor", donorAddress: "100 Synthetic Street, Victoria BC", amountCents: 2000, receivedOnISO: date, location: "Victoria", isNonCash: false };
const officialInput = { ...ackInput, documentKind: "official_tax_receipt", idempotencyKey: "hosted-official", intendedIssueDate: date, eligibleAmountCents: 2000, advantageAmountCents: 0, giftEligibilityConfirmed: true };
const recordInput = { societyId: ids.societyId, status: "registered", evidenceReviewed: true, charityNumber: "123456789RR0001", registeredName: "Registered hosted charity", registeredAddress: "200 Registered Street, Victoria BC", effectiveFrom: "2026-01-01", evidenceDocumentIds: [ids.evidenceId] };
const proof = (documentIds = [ids.evidenceId], requireFile = false) => owner.query(api.receipts.evidenceForReview, { societyId: ids.societyId, documentIds, requireFile });
const reviewedProof = (await proof()).map(({ documentId, fingerprint }: any) => ({ documentId, fingerprint }));
await assert.rejects(() => viewer.mutation(api.receipts.issue, ackInput), /permission|access|required|allowed/i);
await assert.rejects(() => owner.mutation(api.receipts.issue, { ...ackInput, societyId: ids.otherId }), /workspace|member|access|allowed/i);
await assert.rejects(() => owner.mutation(api.receipts.recordRegistration, { ...recordInput, expectedEvidenceFingerprints: reviewedProof, reviewedByUserId: "forged-reviewer" }), /extra field|unexpected|validator|Validation/i);
await assert.rejects(() => owner.mutation(api.receipts.issue, { ...officialInput, charityNumber: "123456789RR0001" }), /review.*registration|registration.*evidence/i, "a legacy isCharity flag and a user-supplied number cannot enable an official receipt");
const ackId = await owner.mutation(api.receipts.issue, ackInput);
let acknowledgement: any = await t.run(ctx => ctx.db.get(ackId));
assert.equal(acknowledgement.receiptNumber, "000100");
assert.equal(acknowledgement.eligibleAmountCents, 0);
assert.equal(acknowledgement.issuedByUserId, ids.ownerId);
assert.equal(await owner.mutation(api.receipts.issue, ackInput), ackId);
await assert.rejects(() => owner.mutation(api.receipts.issue, { ...ackInput, amountCents: 3000 }), /different receipt/);
assert.equal((await proof([ids.foreignEvidenceId]))[0].fingerprint, "");
assert.equal((await director.query(api.receipts.evidenceForReview, { societyId: ids.societyId, documentIds: [ids.foreignEvidenceId] }))[0].fingerprint, "");
await assert.rejects(() => owner.mutation(api.receipts.recordRegistration, { ...recordInput, evidenceDocumentIds: [ids.foreignEvidenceId], expectedEvidenceFingerprints: reviewedProof }), /not found|workspace|belong/i);
await assert.rejects(() => owner.mutation(api.receipts.recordRegistration, { ...recordInput, charityNumber: "123456789RR0001<script>", expectedEvidenceFingerprints: reviewedProof }), /full CRA/);
const pending = await owner.mutation(api.receipts.recordRegistration, { societyId: ids.societyId, status: "applied", evidenceReviewed: false, authorityReference: "Synthetic application receipt" });
await assert.rejects(() => owner.mutation(api.receipts.issue, officialInput), /pending/);
const current = await owner.mutation(api.receipts.recordRegistration, { ...recordInput, expectedRevisionId: pending, expectedEvidenceFingerprints: reviewedProof });
await assert.rejects(() => owner.mutation(api.receipts.recordRegistration, { ...recordInput, expectedRevisionId: pending, expectedEvidenceFingerprints: reviewedProof }), /changed while/);
let registration: any = await owner.query(api.receipts.registrationHistory, { societyId: ids.societyId });
assert.equal(registration.assessment.readiness, "ready");
assert.equal(registration.current.reviewedByUserId, ids.ownerId);
assert.equal(registration.current.evidenceSnapshots[0].fingerprint, reviewedProof[0].fingerprint);
const before = await t.run(async ctx => ({ rows: await ctx.db.query("donationReceipts").collect(), counters: await ctx.db.query("donationReceiptSequences").collect() }));
for (const change of [{ charityNumber: "999999999RR9999" }, { isNonCash: true }, { advantageAmountCents: 1 }, { amountCents: 1.25 }, { amountCents: 0 }, { eligibleAmountCents: 3000 }, { receivedOnISO: "2025-12-31" }, { receivedOnISO: "2026-11-08" }, { giftEligibilityConfirmed: false }]) {
  await assert.rejects(() => owner.mutation(api.receipts.issue, { ...officialInput, ...change }));
}
assert.deepEqual(await t.run(async ctx => ({ rows: await ctx.db.query("donationReceipts").collect(), counters: await ctx.db.query("donationReceiptSequences").collect() })), before, "hosted rejection writes neither receipt nor sequence");
const input = { ...officialInput, sourceAcknowledgementId: ackId };
const retries = await Promise.all([owner.mutation(api.receipts.issue, input), owner.mutation(api.receipts.issue, input)]);
assert.equal(retries[0], retries[1], "concurrent retries resolve to one serial and one preparation");
const preparedId = retries[0];
let prepared: any = await t.run(ctx => ctx.db.get(preparedId));
assert.equal(prepared.receiptNumber, "000101");
assert.equal(prepared.issueStatus, "prepared");
assert.equal(prepared.issuedAtISO, undefined);
assert.equal(prepared.issuerSnapshot.registrationRevisionId, current);
assert.equal(prepared.giftRecordId, ackId);
await assert.rejects(() => owner.mutation(api.receipts.issue, { ...input, idempotencyKey: "hosted-duplicate" }), /active official/);

let signedProof = (await proof([ids.signedId], true))[0];
const finalizeArgs = { id: preparedId, signedCopyDocumentId: ids.signedId, expectedSignedCopyRevision: signedProof.fingerprint, signedOn: date, signatoryName: "Synthetic authorized signer", authorityConfirmed: true };
await assert.rejects(() => viewer.mutation(api.receipts.finalizeOfficial, finalizeArgs), /permission|access|required|allowed/i);
await assert.rejects(() => owner.mutation(api.receipts.finalizeOfficial, { ...finalizeArgs, signedOn: "2026-11-06" }), /printed/);
await assert.rejects(() => owner.mutation(api.receipts.finalizeOfficial, { ...finalizeArgs, authorityConfirmed: false }), /authority/);
await assert.rejects(() => owner.mutation(api.receipts.finalizeOfficial, { ...finalizeArgs, signedCopyDocumentId: ids.foreignEvidenceId }), /not found|belong|workspace/i);
await assert.rejects(() => owner.mutation(api.receipts.finalizeOfficial, { ...finalizeArgs, signedCopyDocumentId: ids.emptyId }), /retained file|source text/);

// Uploading a different current file after the reviewer checked v1 must fail.
const secondSignedVersion = await t.run(async ctx => {
  const prior = (await ctx.db.get(ids.signedVersionId))!;
  await ctx.db.patch(ids.signedVersionId, { isCurrent: false });
  const { _id, _creationTime, ...fields } = prior;
  return ctx.db.insert("documentVersions", { ...fields, version: 2, fileName: "signed-receipt-v2.pdf", storageKey: "synthetic/signed-receipt-v2.pdf", sha256: "b".repeat(64) });
});
await assert.rejects(() => owner.mutation(api.receipts.finalizeOfficial, finalizeArgs), /changed after review/);
assert.equal((await t.run(ctx => ctx.db.get(preparedId)))?.issueStatus, "prepared");
await t.run(ctx => ctx.db.patch(secondSignedVersion, { sha256: undefined }));
assert.match((await proof([ids.signedId], true))[0].reviewIssue, /checksum/);
await t.run(ctx => ctx.db.patch(secondSignedVersion, { sha256: "b".repeat(64) }));
signedProof = (await proof([ids.signedId], true))[0];
const finalReviewed = { ...finalizeArgs, expectedSignedCopyRevision: signedProof.fingerprint };
assert.equal(await owner.mutation(api.receipts.finalizeOfficial, finalReviewed), preparedId);
assert.equal(await owner.mutation(api.receipts.finalizeOfficial, finalReviewed), preparedId);
const issued: any = await t.run(ctx => ctx.db.get(preparedId));
assert.equal(issued.signedCopySnapshot.documentVersionId, secondSignedVersion);
assert.equal(issued.signedCopySnapshot.fingerprint, signedProof.fingerprint);
assert.equal(issued.issuedByUserId, ids.ownerId);
assert.equal(issued.issuedOn, date);
assert.deepEqual(issued.issuerSnapshot, prepared.issuerSnapshot);
await t.run(ctx => ctx.db.patch(ids.societyId, { name: "Renamed hosted organization", isCharity: false }));
assert.equal((await t.run(ctx => ctx.db.get(preparedId)))?.issuerSnapshot?.name, "Registered hosted charity");
await assert.rejects(() => owner.mutation(api.receipts.remove, { id: preparedId }), /cannot be deleted/);
await assert.rejects(() => owner.mutation(api.receipts.remove, { id: ids.legacyId }), /cannot be deleted/);
await owner.mutation(api.receipts.voidReceipt, { id: preparedId, reason: "Synthetic correction" });
await assert.rejects(() => owner.mutation(api.receipts.issue, { ...officialInput, idempotencyKey: "drop-source", replacesReceiptId: preparedId }), /Keep an acknowledgement/);
const replacementId = await owner.mutation(api.receipts.issue, { ...input, idempotencyKey: "hosted-replacement", replacesReceiptId: preparedId });
assert.equal((await t.run(ctx => ctx.db.get(replacementId)))?.giftRecordId, ackId);
await owner.mutation(api.receipts.voidReceipt, { id: ackId, reason: "Synthetic source correction" });
await assert.rejects(() => owner.mutation(api.receipts.issue, { ...ackInput, idempotencyKey: "hosted-ack-replacement", replacesReceiptId: ackId }), /active official/);

// Concurrent reviewers cannot both append onto the same expected head.
const reviews = await Promise.allSettled([
  owner.mutation(api.receipts.recordRegistration, { ...recordInput, expectedRevisionId: current, expectedEvidenceFingerprints: reviewedProof, notes: "Reviewer one" }),
  owner.mutation(api.receipts.recordRegistration, { ...recordInput, expectedRevisionId: current, expectedEvidenceFingerprints: reviewedProof, notes: "Reviewer two" }),
]);
assert.equal(reviews.filter(result => result.status === "fulfilled").length, 1);
assert.equal(reviews.filter(result => result.status === "rejected").length, 1);
registration = await owner.query(api.receipts.registrationHistory, { societyId: ids.societyId });
assert.equal(registration.history.length, 3);
await assert.rejects(() => owner.mutation(api.receipts.finalizeOfficial, { ...finalReviewed, id: replacementId }), /Registration evidence changed/);
await t.run(ctx => ctx.db.patch(ids.evidenceId, { content: "Synthetic later source content." }));
await assert.rejects(() => owner.mutation(api.receipts.issue, { ...officialInput, idempotencyKey: "source-changed" }), /Registration evidence changed/);
assert.equal((await t.run(ctx => ctx.db.get(ids.legacyId)))?.documentKind, undefined);
assert.equal((await t.run(ctx => ctx.db.get(ids.legacyId)))?.eligibleAmountCents, 100);
assert.deepEqual((await t.run(ctx => ctx.db.get(preparedId)))?.signedCopySnapshot, issued.signedCopySnapshot, "voids and later reviews retain the original signed issue");
console.log("PASS hosted receipt schema and handlers: legacy rows, tenant/actor permissions, registration proof and concurrent revision guards, atomic retries/serials, gift linkage, signature review fingerprints and immutable signed issue history.");
mock.timers.reset();
