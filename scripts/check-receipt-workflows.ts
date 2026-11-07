import assert from "node:assert/strict";
import { mock } from "node:test";
import { LocalStoreDb, MemoryDb, MemoryRowStore, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities, type TransactionalDb } from "../shared/portable/index";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import { receiptIssuePortable, receiptFinalizeOfficialPortable, receiptVoidPortable, receiptRemovePortable, receiptsListPortable, receiptRecordRegistrationPortable, receiptRegistrationHistoryPortable, receiptEvidenceForReviewPortable, nextReceiptSerial } from "../shared/functions/receipts";
import { fundingSourcesRollup } from "../shared/functions/fundingSources";
import { overviewPortable, matchPortable } from "../shared/functions/reconciliation";
import { assessCharityRegistration, charityRegistrationAtDate, projectCharityRegistrationHistory } from "../shared/receipting/registration";
import { recordedDonationGifts } from "../shared/receipting/policy";
import { buildDonationReceiptDocument } from "../src/lib/donationReceiptDocument";

mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-07T20:00:00Z") });
const date = "2026-11-07";
const societyId = "receipt-workspace";
const organization = { _id: societyId, name: "Synthetic society", registeredOfficeAddress: "100 Synthetic Road, Victoria BC", entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act__british_columbia_", isCharity: false, isMemberFunded: false };
const document = (id: string, extra: Record<string, unknown> = {}) => ({ _id: id, societyId, title: id, category: "Other", createdAtISO: `${date}T12:00:00Z`, flaggedForDeletion: false, tags: [], ...extra });
const version = (id: string, documentId: string, extra: Record<string, unknown> = {}) => ({ _id: id, societyId, documentId, version: 1, isCurrent: true, storageProvider: "local-indexeddb", storageKey: `${id}.pdf`, fileName: `${id}.pdf`, mimeType: "application/pdf", sha256: "a".repeat(64), fileSizeBytes: 123, uploadedAtISO: `${date}T12:00:00Z`, ...extra });
const legacy = { _id: "legacy", societyId, receiptNumber: "000041", charityNumber: "unverified old number", donorName: "Legacy donor", amountCents: 500, eligibleAmountCents: 500, receivedOnISO: "2025-01-01", issuedAtISO: "2025-01-01T20:00:00Z", location: "Victoria", isNonCash: false };
const acknowledgement = { societyId, documentKind: "acknowledgement", idempotencyKey: "ack", donorName: "Synthetic donor", donorAddress: "200 Example Street, Victoria BC", amountCents: 10000, eligibleAmountCents: 9999, receivedOnISO: date, location: "Victoria", isNonCash: false };
const official = { ...acknowledgement, documentKind: "official_tax_receipt", idempotencyKey: "official", intendedIssueDate: date, eligibleAmountCents: 10000, advantageAmountCents: 0, giftEligibilityConfirmed: true };
const registration = { societyId, status: "registered", evidenceReviewed: true, charityNumber: "123456789RR0001", registeredName: "Registered synthetic charity", registeredAddress: "300 Registered Road, Victoria BC", effectiveFrom: "2026-01-01", evidenceDocumentIds: ["authority-proof"] };

function runtime(db: TransactionalDb, subject = portableTestPrincipal().subject) {
  return new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({ ...portableTestPrincipal(), subject }) })
    .register(definePortableQuery({ name: "receipts:list", handler: receiptsListPortable }))
    .register(definePortableQuery({ name: "receipts:registrationHistory", handler: receiptRegistrationHistoryPortable }))
    .register(definePortableQuery({ name: "receipts:evidenceForReview", handler: receiptEvidenceForReviewPortable }))
    .register(definePortableMutation({ name: "receipts:recordRegistration", handler: receiptRecordRegistrationPortable }))
    .register(definePortableMutation({ name: "receipts:issue", handler: receiptIssuePortable }))
    .register(definePortableMutation({ name: "receipts:finalizeOfficial", handler: receiptFinalizeOfficialPortable }))
    .register(definePortableMutation({ name: "receipts:voidReceipt", handler: receiptVoidPortable }))
    .register(definePortableMutation({ name: "receipts:remove", handler: receiptRemovePortable }))
    .register(definePortableQuery({ name: "fundingSources:rollup", handler: fundingSourcesRollup }))
    .register(definePortableQuery({ name: "reconciliation:overview", handler: overviewPortable }))
    .register(definePortableMutation({ name: "reconciliation:match", handler: matchPortable }));
}

for (const backend of ["memory", "local"] as const) {
  const membership = portableTestSeed(societyId);
  const seed = {
    ...membership,
    societies: [organization, { _id: "foreign-workspace", name: "Foreign" }],
    users: [...membership.users, { ...membership.users[0], _id: "viewer", role: "Viewer", authSubject: "receipt-viewer" }, { ...membership.users[0], _id: "director", role: "Director", authSubject: "receipt-director" }],
    documents: [document("authority-proof", { content: "Synthetic retained CRA registration decision." }), document("signed"), document("metadata-only"), document("external"), document("foreign-proof", { societyId: "foreign-workspace", content: "Foreign evidence" }), document("private-proof", { content: "Restricted evidence" })],
    documentVersions: [version("signed-v1", "signed"), version("external-v1", "external", { storageProvider: "external", storageKey: "https://example.invalid/receipt.pdf" })],
    meetingMaterials: [{ _id: "private-link", societyId, documentId: "private-proof", accessLevel: "restricted", availabilityStatus: "available" }],
    donationReceipts: [legacy, { ...legacy, _id: "mixed", receiptNumber: "IMPORTED-A-900" }],
    financialTransactions: [{ _id: "bank-gift", societyId, date, amountCents: 10000, counterparty: "Synthetic donor" }],
  };
  const db = backend === "memory" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed));
  const rt = runtime(db);
  const issue = (args: Record<string, unknown>) => rt.runMutation<string>("receipts:issue", args);
  const saveRegistration = (args: Record<string, unknown>) => rt.runMutation<string>("receipts:recordRegistration", args);
  const proof = async (ids = ["authority-proof"], requireFile = false) => rt.runQuery<any[]>("receipts:evidenceForReview", { societyId, documentIds: ids, requireFile });
  const registrationProof = await proof();
  const reviewed = { ...registration, expectedEvidenceFingerprints: registrationProof.map(({ documentId, fingerprint }) => ({ documentId, fingerprint })) };
  const initial = await issue(acknowledgement);
  const ack = (await db.get(initial, "donationReceipts"))!;
  assert.equal(ack.receiptNumber, "000042", `${backend}: mixed import identifiers do not replace the numeric maximum`);
  assert.equal(ack.eligibleAmountCents, 0);
  assert.equal(ack.charityNumber, "");
  assert.equal(ack.issueStatus, "issued");
  assert.equal(ack.giftRecordId, initial);
  assert.equal(await issue(acknowledgement), initial, "retry does not allocate another number");
  await assert.rejects(issue({ ...acknowledgement, amountCents: 11000 }), /different receipt/);
  await assert.rejects(runtime(db, "receipt-viewer").runMutation("receipts:issue", { ...acknowledgement, idempotencyKey: "viewer" }), /permission|access|required|not allowed/i);
  await assert.rejects(issue({ ...official, charityNumber: "999999999RR9999" }), /registration/i);
  await assert.rejects(saveRegistration({ ...reviewed, charityNumber: "<script>123456789RR0001</script>" }), /full CRA/);
  await assert.rejects(saveRegistration({ ...registration, evidenceDocumentIds: ["foreign-proof"], expectedEvidenceFingerprints: [{ documentId: "foreign-proof", fingerprint: "a".repeat(64) }] }), /not found|belong|workspace/i);
  const privateProof = await runtime(db, "receipt-director").runQuery<any[]>("receipts:evidenceForReview", { societyId, documentIds: ["private-proof"] });
  assert.equal(privateProof[0].fingerprint, "");
  assert.match(privateProof[0].reviewIssue, /not found/);
  assert.match((await proof(["metadata-only"]))[0].reviewIssue, /retained file|source text/);
  assert.match((await proof(["external"], true))[0].reviewIssue, /retained uploaded file/);

  const pending = await saveRegistration({ societyId, status: "applied", evidenceReviewed: false, authorityReference: "Synthetic application reference" });
  await assert.rejects(issue(official), /application|registration|pending/i);
  const unreviewed = await saveRegistration({ ...registration, evidenceReviewed: false, expectedRevisionId: pending });
  await assert.rejects(issue(official), /review/i);
  await assert.rejects(saveRegistration({ ...reviewed, expectedRevisionId: pending }), /changed while/);
  const future = await saveRegistration({ ...reviewed, expectedRevisionId: unreviewed, effectiveFrom: "2026-12-01" });
  await assert.rejects(issue(official), /effective|date|registration/i);
  const active = await saveRegistration({ ...reviewed, expectedRevisionId: future });
  const history: any = await rt.runQuery("receipts:registrationHistory", { societyId });
  assert.equal(history.assessment.readiness, "ready");
  assert.equal(history.current._id, active);
  assert.equal(history.current.reviewedByUserId, `${societyId}_owner`);
  assert.equal((await db.get(societyId, "societies"))?.isCharity, false, "dated reviews do not rewrite legacy claims");
  assert.doesNotMatch(JSON.stringify(projectCharityRegistrationHistory(history.history)), /evidenceDocumentIds|registeredAddress|charityNumber|reviewedByUserId/);
  assert.equal(charityRegistrationAtDate(history.history, "2025-12-31").status, "not_registered");
  const beforeInvalid = await db.query("donationReceipts").collect();
  for (const change of [{ amountCents: 0 }, { amountCents: 1.5 }, { amountCents: Number.MAX_SAFE_INTEGER + 1 }, { eligibleAmountCents: 10001 }, { receivedOnISO: "2026-02-30" }, { receivedOnISO: "2026-11-08" }, { receivedOnISO: "2025-12-31" }, { intendedIssueDate: "2026-11-06", receivedOnISO: "2026-11-05" }, { isNonCash: true }, { advantageAmountCents: 1 }, { giftEligibilityConfirmed: false }, { charityNumber: "999999999RR9999" }]) {
    await assert.rejects(issue({ ...official, ...change }));
  }
  assert.deepEqual(await db.query("donationReceipts").collect(), beforeInvalid, "gift/date failures allocate no numbers or partial records");
  await db.transaction(() => db.patch(societyId, { legalSubtype: "member_funded_society" }));
  await assert.rejects(issue(official), /member-funded claim/);
  await db.transaction(() => db.patch(societyId, { legalSubtype: undefined, actFormedUnder: "business_corporations_act__british_columbia_" }));
  await assert.rejects(issue(official), /governing Act does not match/);
  await db.transaction(() => db.patch(societyId, { actFormedUnder: organization.actFormedUnder }));

  const preparationInput = { ...official, sourceAcknowledgementId: initial };
  const preparedId = await issue(preparationInput);
  const prepared = (await db.get(preparedId, "donationReceipts"))!;
  assert.equal(prepared.receiptNumber, "000043");
  assert.equal(prepared.issueStatus, "prepared");
  assert.equal(prepared.issuedAtISO, undefined);
  assert.equal(prepared.issuerSnapshot.name, reviewed.registeredName);
  assert.equal(prepared.issuerSnapshot.registrationRevisionId, active);
  assert.equal(prepared.giftRecordId, initial);
  assert.equal(await issue(preparationInput), preparedId);
  await assert.rejects(issue({ ...preparationInput, idempotencyKey: "duplicate-official" }), /active official/);
  await assert.rejects(rt.runMutation("reconciliation:match", { txnId: "bank-gift", matchedKind: "receipt", matchedId: preparedId }), /unsigned/);
  const unsigned = buildDonationReceiptDocument(prepared);
  assert.match(unsigned.bodyHtml, /Prepared for authorized signature/);
  assert.match(unsigned.bodyHtml, /Canada Revenue Agency/);
  assert.match(unsigned.bodyHtml, /Authorized signature/);
  assert.match(unsigned.bodyHtml, /Eligible amount/);
  await db.transaction(() => db.patch(societyId, { name: "Renamed organization" }));
  assert.doesNotMatch(buildDonationReceiptDocument(prepared).bodyHtml, /Renamed organization/);

  const signedProof = (await proof(["signed"], true))[0];
  const finalizeArgs = { id: preparedId, signedCopyDocumentId: "signed", expectedSignedCopyRevision: signedProof.fingerprint, signedOn: date, signatoryName: "Authorized synthetic signer", authorityConfirmed: true };
  const finalize = (changes: Record<string, unknown> = {}) => rt.runMutation<string>("receipts:finalizeOfficial", { ...finalizeArgs, ...changes });
  await assert.rejects(finalize({ authorityConfirmed: false }), /authority/);
  await assert.rejects(finalize({ signedOn: "2026-11-06" }), /printed/);
  await assert.rejects(finalize({ signedCopyDocumentId: "foreign-proof" }), /not found|workspace/i);
  await assert.rejects(finalize({ signedCopyDocumentId: "metadata-only" }), /PDF/);
  await assert.rejects(finalize({ expectedSignedCopyRevision: "b".repeat(64) }), /changed after review/);
  assert.equal((await db.get(preparedId, "donationReceipts"))?.issueStatus, "prepared");
  assert.equal(await finalize(), preparedId);
  assert.equal(await finalize(), preparedId, "finalization retry preserves first actor/time/file");
  await assert.rejects(finalize({ signatoryName: "Someone else" }), /already issued/);
  const issued = (await db.get(preparedId, "donationReceipts"))!;
  assert.equal(issued.signedCopySnapshot.documentVersionId, "signed-v1");
  assert.equal(issued.issuedByUserId, `${societyId}_owner`);
  assert.equal(issued.issuedOn, date);
  assert.deepEqual(issued.issuerSnapshot, prepared.issuerSnapshot);
  assert.match(buildDonationReceiptDocument(issued).bodyHtml, /retained signed paper receipt is the original/);
  assert.equal(recordedDonationGifts([ack, issued]).length, 1);
  const rollup: any = await rt.runQuery("fundingSources:rollup", { societyId, from: date, to: date });
  assert.equal(rollup.rows.find((row: any) => row.name === acknowledgement.donorName).receivedCents, 10000, "financial rollup counts a linked acknowledgement and tax receipt once");
  const overview: any = await rt.runQuery("reconciliation:overview", { societyId });
  assert.deepEqual(overview.rows[0].candidates.filter((row: any) => row.kind === "receipt").map((row: any) => row.id), [initial]);
  await assert.rejects(rt.runMutation("reconciliation:match", { txnId: "bank-gift", matchedKind: "receipt", matchedId: preparedId }), /active acknowledgement/);
  await assert.rejects(rt.runMutation("receipts:remove", { id: preparedId }), /cannot be deleted/);
  await assert.rejects(rt.runMutation("receipts:remove", { id: "legacy" }), /cannot be deleted/);

  await rt.runMutation("receipts:voidReceipt", { id: preparedId, reason: "Synthetic correction" });
  await rt.runMutation("receipts:voidReceipt", { id: preparedId, reason: "Repeated request" });
  assert.equal((await db.get(preparedId, "donationReceipts"))?.voidReason, "Synthetic correction");
  await assert.rejects(issue({ ...official, idempotencyKey: "drop-gift-link", replacesReceiptId: preparedId }), /Keep an acknowledgement/);
  const replacementId = await issue({ ...preparationInput, idempotencyKey: "replacement", replacesReceiptId: preparedId });
  assert.equal((await db.get(replacementId, "donationReceipts"))?.giftRecordId, initial);
  assert.equal((await db.get(preparedId, "donationReceipts"))?.replacementReceiptId, replacementId);
  await rt.runMutation("receipts:voidReceipt", { id: initial, reason: "Synthetic acknowledgement correction" });
  await assert.rejects(issue({ ...acknowledgement, idempotencyKey: "replacement-ack", replacesReceiptId: initial }), /active official/);
  await rt.runMutation("receipts:voidReceipt", { id: replacementId, reason: "Replace source acknowledgement first" });
  const secondAck = await issue({ ...acknowledgement, idempotencyKey: "replacement-ack", replacesReceiptId: initial });
  const secondOfficial = await issue({ ...official, idempotencyKey: "replacement-official-2", sourceAcknowledgementId: secondAck, replacesReceiptId: replacementId });
  assert.equal((await db.get(secondOfficial, "donationReceipts"))?.giftRecordId, initial);
  await assert.rejects(issue({ ...official, idempotencyKey: "third-official", sourceAcknowledgementId: secondAck }), /active official/);

  // A new source version cannot silently become evidence of the earlier review.
  await db.transaction(() => db.patch("authority-proof", { content: "Changed synthetic decision after review." }));
  await assert.rejects(issue({ ...official, idempotencyKey: "changed-proof" }), /Registration evidence changed/);
  await assert.rejects(saveRegistration({ ...reviewed, expectedRevisionId: active }), /evidence changed|not reviewed/i);
  const changedProof = await proof();
  const revised = await saveRegistration({ ...reviewed, expectedRevisionId: active, expectedEvidenceFingerprints: changedProof.map(({ documentId, fingerprint }) => ({ documentId, fingerprint })), notes: "Reviewed revised source" });
  await assert.rejects(rt.runMutation("receipts:finalizeOfficial", { ...finalizeArgs, id: secondOfficial }), /Registration evidence changed/);
  const inactive = await saveRegistration({ ...reviewed, status: "inactive", expectedRevisionId: revised, expectedEvidenceFingerprints: changedProof.map(({ documentId, fingerprint }) => ({ documentId, fingerprint })), effectiveTo: "2026-10-31", notes: "Synthetic revocation decision" });
  const inactiveHistory: any = await rt.runQuery("receipts:registrationHistory", { societyId });
  assert.equal(inactiveHistory.current._id, inactive);
  assert.equal(charityRegistrationAtDate(inactiveHistory.history, "2026-10-01").status, "registered", "historical supplies use the reviewed active period");
  assert.equal(charityRegistrationAtDate(inactiveHistory.history, date).status, "not_registered");
  assert.notEqual(assessCharityRegistration(inactiveHistory.history, { onDate: "2026-10-01" }).readiness, "ready", "inactive registration cannot authorize a new receipt");
  await assert.rejects(issue({ ...official, idempotencyKey: "inactive" }), /inactive|registration/i);
  assert.equal((await db.get("legacy", "donationReceipts"))?.documentKind, undefined);
  assert.equal((await db.get("legacy", "donationReceipts"))?.eligibleAmountCents, 500);
  const historicalOutput = buildDonationReceiptDocument((await db.get("legacy", "donationReceipts"))!);
  assert.equal(historicalOutput.title, "Historical donation record");
  assert.match(historicalOutput.bodyHtml, /does not establish tax-receipt eligibility/);
  const acknowledgementOutput = buildDonationReceiptDocument({ ...ack, donorName: "<script>unsafe</script>" });
  assert.doesNotMatch(acknowledgementOutput.bodyHtml, /<script>|Eligible amount|123456789RR0001/);
  assert.match(acknowledgementOutput.bodyHtml, /&lt;script&gt;/);
  const listing: any[] = await rt.runQuery("receipts:list", { societyId });
  assert.ok(listing.every(row => row.requestFingerprint === undefined), "request payload identity stays internal");
  await db.transaction(() => db.insert("donationReceipts", { ...legacy, _id: undefined, receiptNumber: "000150" }));
  const importedId = await issue({ ...acknowledgement, idempotencyKey: "after-late-import" });
  assert.equal((await db.get(importedId, "donationReceipts"))?.receiptNumber, "000151", "later imports also advance the serial safely");
}

assert.equal(nextReceiptSerial(["000009", "import-100", "3", "000041"]), 42);
assert.throws(() => nextReceiptSerial([String(Number.MAX_SAFE_INTEGER)]), /needs review/);
const overflowSeed = { ...portableTestSeed(societyId), societies: [organization], donationReceipts: Array.from({ length: 5001 }, (_, index) => ({ ...legacy, _id: `import-${index}`, receiptNumber: String(index + 1) })) };
const overflowDb = new MemoryDb({ seed: overflowSeed });
await assert.rejects(runtime(overflowDb).runMutation("receipts:issue", acknowledgement), /reviewed sequence migration/);
assert.equal((await overflowDb.query("donationReceipts").collect()).length, 5001);
assert.deepEqual(await overflowDb.query("donationReceiptSequences").collect(), []);
console.log("PASS portable receipt workflows on MemoryDb and LocalStoreDb: registration history and evidence, gift/date/identity policy, actor/tenant ACL, signatures, retries, stable gift replacements, immutable output and financial deduplication.");
mock.timers.reset();
