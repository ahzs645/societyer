import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { tables, society } from "../src/lib/staticConvexFixtures";
import { assessTax, defaultTaxAnswers, taxAssessmentRates } from "../shared/tax";
import { assessTaxForOrganization, organizationTaxFacts, organizationTaxProblems, prefillOrganizationTaxAnswers } from "../shared/tax/organizationFacts";
import { assessCharityRegistration, charityRegistrationAtDate, projectCharityRegistrationHistory, type CharityRegistrationRevision } from "../shared/receipting/registration";
import { receiptEvidenceFingerprint } from "../shared/receipting/evidence";
import { loadOrganizationTaxContext } from "../shared/functions/organizationTaxFacts";
import { validateEntitySetup } from "../shared/entitySetup";
import * as invoices from "../shared/functions/invoices";
import * as billingDocuments from "../shared/functions/billingDocuments";
import { DEFAULT_INVOICE_TEMPLATE } from "../shared/invoiceCommerce";

const date = "2026-11-06";
const ordinary = {
  ...defaultTaxAnswers("transaction", date), jurisdictionCode: "CA-BC", itemCategory: "goods", sellerKind: "business", scopeConfirmed: "yes",
  federalException: "none", gstRegistration: "registered", provincialException: "category", pstRegistration: "registered", customerRelief: "none",
};
const charity = { ...ordinary, sellerKind: "charity", charityEvidence: "Synthetic review of this charity's ordinary taxable equipment supply" };
const evidenceDocumentId = "private-evidence-document";
const evidenceContent = "Synthetic authority decision retained for the supplier-facts regression fixture.";
const registration: CharityRegistrationRevision = {
  _id: "reviewed-registration", societyId: "synthetic-society", registrationType: "CA-CRA-CHARITY", revisionNumber: 1,
  status: "registered", evidenceReviewed: true, charityNumber: "123456789RR0001",
  registeredName: "Synthetic private registered name", registeredAddress: "Synthetic private address",
  effectiveFrom: "2026-01-01", evidenceDocumentIds: [evidenceDocumentId], authorityReference: "Private authority reference",
  evidenceSnapshots: [{ documentId: evidenceDocumentId, fingerprint: await receiptEvidenceFingerprint({ documentId: evidenceDocumentId, content: evidenceContent }) }],
  notes: "Private reviewer note", recordedByUserId: "private-recorder", recordedAtISO: `${date}T12:00:00Z`,
  reviewedByUserId: "private-reviewer", reviewedAtISO: `${date}T12:00:00Z`,
};
const registeredProfile = { isCharity: false, charityStatus: "not_applied", charityRegistrations: [registration] };
assert.equal(organizationTaxFacts({ isCharity: false }, date).charityRegistrationStatus, "unknown", "a default false flag is not proof of nonregistration");
assert.equal(prefillOrganizationTaxAnswers(defaultTaxAnswers("transaction", date), { isCharity: false }).sellerKind, "unknown", "non-charity legal or legacy data does not establish tax NPO status");
assert.equal(prefillOrganizationTaxAnswers(defaultTaxAnswers("transaction", date), registeredProfile).sellerKind, "charity");
const unsnapshotted = { charityRegistrations: [{ ...registration, evidenceSnapshots: undefined }] };
assert.equal(organizationTaxFacts(unsnapshotted, date).charityRegistrationStatus, "unknown", "a positive row without retained evidence fingerprints is an unverified claim");
assert.equal(assessTaxForOrganization(charity, unsnapshotted, true).confirmed, false);
assert.equal(projectCharityRegistrationHistory(unsnapshotted.charityRegistrations)[0].registrationComplete, false);
assert.equal(assessTaxForOrganization(ordinary, registeredProfile, true).confirmed, false, "reviewed charity status cannot be bypassed with an ordinary supplier answer");
const checkedCharity = assessTaxForOrganization(charity, registeredProfile, true);
assert.equal(checkedCharity.confirmed, true, "dated reviewed evidence governs over stale legacy false/default claims");
assert.deepEqual(organizationTaxProblems(checkedCharity.answers, registeredProfile), []);
for (const profile of [{ isCharity: true }, { isCharity: false, charityStatus: "registered" }]) {
  assert.equal(assessTaxForOrganization(ordinary, profile, true).confirmed, false);
  assert.equal(assessTaxForOrganization(charity, profile, true).confirmed, false, "legacy charity claims still need registration evidence");
}
assert.equal(assessTaxForOrganization(ordinary, { isCharity: false, charityStatus: "not_applied" }, true).confirmed, true);
assert.equal(assessTaxForOrganization(charity, { isCharity: false, charityStatus: "application_pending" }, true).confirmed, false);
assert.equal(assessTaxForOrganization(ordinary, { isCharity: false, charityRegistrations: [{ ...registration, status: "applied", evidenceReviewed: false }] }, true).confirmed, true, "an initial pending application without prior positive history still permits operator supplier classification");
assert.throws(() => validateEntitySetup({ isCharity: false, charityStatus: "registered" }), /flag says no/);
for (const charityStatus of ["application_pending", "not_applied", "revoked"]) {
  assert.throws(() => validateEntitySetup({ isCharity: true, charityStatus }), /conflicts/);
}
assert.doesNotThrow(() => validateEntitySetup({ isCharity: false, charityStatus: "unknown" }));
assert.doesNotThrow(() => validateEntitySetup({ isCharity: true, charityStatus: "registered" }));

const projection = projectCharityRegistrationHistory([registration]);
assert.deepEqual(organizationTaxFacts({ charityRegistrations: projection }, date).charityRegistrationStatus, "registered");
assert.doesNotMatch(JSON.stringify(projection), /private|charityNumber|registeredName|registeredAddress|evidenceDocumentIds|reviewedBy|authorityReference|notes/i);
const closed = { ...registration, _id: "closed-registration", revisionNumber: 2, supersedesId: registration._id, status: "inactive" as const, effectiveTo: "2026-10-31" };
const historical = { charityRegistrations: [registration, closed] };
assert.equal(assessTaxForOrganization({ ...charity, supplyDate: "2026-10-30" }, historical, true).confirmed, true);
assert.equal(assessTaxForOrganization(charity, historical, true).confirmed, false, "an inactive interval cannot establish charity rules after its last date");
assert.equal(organizationTaxFacts({ charityRegistrations: [registration, { ...closed, supersedesId: "wrong" }] }, date).needsReview, true);

// This first implementation assesses one period and its revisions. A later
// disjoint registration cannot silently turn an earlier charitable supply into
// a business/NPO supply; ordinary closure and overlapping corrections still work.
const januaryStart = { ...registration, _id: "january-start", effectiveFrom: "2027-01-01" };
const juneEnd = { ...closed, _id: "june-end", supersedesId: januaryStart._id, effectiveFrom: "2027-01-01", effectiveTo: "2027-06-30" };
const septemberStart = { ...registration, _id: "september-start", revisionNumber: 3, supersedesId: juneEnd._id, effectiveFrom: "2027-09-01" };
const multiplePeriods = [januaryStart, juneEnd, septemberStart];
const multiProfile = { isCharity: false, charityStatus: "not_applied", charityRegistrations: multiplePeriods };
const mayDate = "2027-05-15";
assert.equal(charityRegistrationAtDate([januaryStart, juneEnd], "2027-06-30").status, "registered");
assert.equal(charityRegistrationAtDate([januaryStart, juneEnd], "2027-07-01").status, "not_registered", "a same-period end date supersedes the old open end");
assert.equal(charityRegistrationAtDate(multiplePeriods, mayDate).status, "conflict");
assert.equal(organizationTaxFacts(multiProfile, mayDate).needsReview, true, "the recorded historical conflict blocks review even when legacy charity flags are false");
for (const sellerKind of ["business", "nonprofit"]) {
  assert.equal(assessTaxForOrganization({ ...ordinary, sellerKind, supplyDate: mayDate }, multiProfile, true).confirmed, false);
}
for (const onDate of [mayDate, "2027-07-01", "2027-09-01", "2027-11-06"]) {
  const full = charityRegistrationAtDate(multiplePeriods, onDate);
  const projected = charityRegistrationAtDate(projectCharityRegistrationHistory(multiplePeriods), onDate);
  assert.equal(projected.status, full.status);
  assert.deepEqual(projected.reasons, full.reasons);
}
assert.equal(charityRegistrationAtDate(multiplePeriods, "2027-07-01").status, "not_registered");
assert.equal(charityRegistrationAtDate(multiplePeriods, "2027-09-01").status, "registered");
assert.equal(charityRegistrationAtDate(multiplePeriods, "2027-11-06").status, "registered");
const correctedStart = { ...januaryStart, _id: "corrected-start", revisionNumber: 2, supersedesId: januaryStart._id, effectiveFrom: "2027-02-01" };
assert.equal(charityRegistrationAtDate([januaryStart, correctedStart], "2027-01-15").status, "not_registered", "overlapping revisions may correct the same period's start date");
assert.equal(charityRegistrationAtDate([januaryStart, correctedStart], mayDate).status, "registered");
assert.equal(assessCharityRegistration(multiplePeriods, { onDate: "2027-11-06", receivedOn: mayDate }).readiness, "needs_review");
assert.equal(assessCharityRegistration(multiplePeriods, { onDate: "2027-11-06", receivedOn: mayDate }).reasons[0].code, "REGISTRATION_MULTIPLE_PERIODS");

// Exercise the actual portable publishing and first-settlement handlers. Run
// them directly (without a rollback wrapper) to prove checks precede writes.
const seed: Record<string, any[]> = structuredClone(tables);
seed.societies = [{ ...structuredClone(society), isCharity: false, charityStatus: "not_applied" }];
seed.organizationTaxRegistrations = [];
seed.documents.push({ _id: evidenceDocumentId, societyId: society._id, title: "Synthetic retained supplier evidence", category: "Finance", content: evidenceContent, createdAtISO: `${date}T00:00:00Z`, flaggedForDeletion: false, tags: [] });
seed.organizationIdentifiers = [
  { _id: "supplier-gst", societyId: society._id, kind: "gst", number: "123456789RT0001", status: "active", registeredAt: "2026-01-01" },
  { _id: "supplier-pst", societyId: society._id, kind: "pst", number: "PST-1234-5678", jurisdiction: "CA-BC", status: "active", registeredAt: "2026-01-01" },
];
const db = new MemoryDb({ seed });
const societyId = society._id, ownerId = seed.users.find(user => user.societyId === societyId && user.role === "Owner")._id;
const ctx: any = {
  db, principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `test:${ownerId}`, societyId, userId: ownerId },
  capabilities: makeCapabilities({}), runQuery: async () => { throw new Error("Unexpected query"); },
};
const lineFor = (taxAssessment: ReturnType<typeof assessTax>) => ({ key: "taxable", item: "Synthetic equipment", quantity: 1, unitPriceCents: 10000, taxAssessment, ...taxAssessmentRates(taxAssessment) });
const input = { societyId, partyKind: "custom" as const, billToName: "Synthetic buyer", issueDate: date, terms: "net_30", currency: "CAD" };
const legacyOrdinaryLine = lineFor(assessTax(ordinary, true));
const beforeHistory = await invoices.upsertPortable(ctx, { ...input, lines: [legacyOrdinaryLine] });
await invoices.markSentPortable(ctx, { societyId, ids: [beforeHistory] });
const earlierSnapshot = structuredClone((await db.get(beforeHistory))!.issuerTaxRegistrationsSnapshot);
const staleDraft = await invoices.upsertPortable(ctx, { ...input, lines: [legacyOrdinaryLine] });
const firstId = await db.insert("organizationTaxRegistrations", {
  societyId, registrationType: "CA-CRA-CHARITY", revisionNumber: 1, status: "applied", evidenceReviewed: false,
  evidenceDocumentIds: [], recordedByUserId: ownerId, recordedAtISO: `${date}T12:00:00Z`,
});
await assert.rejects(() => invoices.markSentPortable(ctx, { societyId, ids: [staleDraft] }), /supplier facts changed|not been confirmed/);
const { _id: _registrationId, ...registrationFields } = registration;
const registeredId = await db.insert("organizationTaxRegistrations", { ...registrationFields, societyId, revisionNumber: 2, supersedesId: firstId });
const activeContext = await loadOrganizationTaxContext(ctx, societyId);
const goodLine = lineFor(assessTaxForOrganization(charity, activeContext, true));
const goodDraft = await invoices.upsertPortable(ctx, { ...input, lines: [goodLine] });
const badDraft = await invoices.upsertPortable(ctx, { ...input, lines: [legacyOrdinaryLine] });
const beforeWrites = () => JSON.stringify({ entries: db.dump("journalEntries"), lines: db.dump("journalLines"), accounts: db.dump("financialAccounts"), transactions: db.dump("financialTransactions") });
const ledgerBefore = beforeWrites();
await assert.rejects(() => invoices.markSentPortable(ctx, { societyId, ids: [goodDraft, badDraft] }), /reviewed registration identifies a registered charity/);
assert.equal((await db.get(goodDraft))!.status, "draft", "one invalid row prevents any batch publication");
assert.equal((await db.get(badDraft))!.status, "draft");
assert.equal(beforeWrites(), ledgerBefore, "batch validation precedes every ledger or account write");
await assert.rejects(() => invoices.recordPaymentPortable(ctx, { id: badDraft, date, amountCents: 1000 }), /reviewed registration identifies a registered charity/);
assert.deepEqual((await db.get(badDraft))!.payments, []);
assert.equal(beforeWrites(), ledgerBefore, "first-settlement rejection cannot leave bookkeeping behind");
const quoteId = await billingDocuments.upsertQuotePortable(ctx, { societyId, fields: { ...input, validUntil: "2099-12-31", lines: [legacyOrdinaryLine], documentTemplate: DEFAULT_INVOICE_TEMPLATE } as any });
await assert.rejects(() => billingDocuments.setQuoteStatusPortable(ctx, { id: quoteId, status: "sent" }), /reviewed registration identifies a registered charity/);
assert.equal((await db.get(quoteId))!.status, "draft");
await invoices.markSentPortable(ctx, { societyId, ids: [goodDraft] });
const issued = (await db.get(goodDraft))!;
assert.equal(issued.issuerTaxRegistrationsSnapshot.supplierFacts.charityRegistrationRevisionId, registeredId);
assert.equal(issued.issuerTaxRegistrationsSnapshot.supplierFacts.charityRegistrationStatus, "registered");
const frozen = structuredClone(issued.issuerTaxRegistrationsSnapshot);

// A revised source requires new confirmation even when the supplier remains a
// charity. Published records keep the revision used when they were issued.
const changedDraft = await invoices.upsertPortable(ctx, { ...input, lines: [goodLine] });
const revisedId = await db.insert("organizationTaxRegistrations", { ...registrationFields, societyId, revisionNumber: 3, supersedesId: registeredId, authorityReference: "Revised authority evidence" });
await assert.rejects(() => invoices.markSentPortable(ctx, { societyId, ids: [changedDraft] }), /supplier facts changed/);
await invoices.markSentPortable(ctx, { societyId, ids: [goodDraft, beforeHistory] });
assert.deepEqual((await db.get(goodDraft))!.issuerTaxRegistrationsSnapshot, frozen);
assert.deepEqual((await db.get(beforeHistory))!.issuerTaxRegistrationsSnapshot, earlierSnapshot);
const workspace: any = await invoices.workspacePortable(ctx, { societyId });
assert.equal(workspace.organization.charityRegistrations.at(-1)._id, revisedId);
assert.doesNotMatch(JSON.stringify(workspace.organization.charityRegistrations), /private|charityNumber|registeredName|registeredAddress|evidenceDocumentIds|reviewedBy|authorityReference|notes/i);
const refreshedLine = lineFor(assessTaxForOrganization(charity, await loadOrganizationTaxContext(ctx, societyId), true));
const staleEvidenceDraft = await invoices.upsertPortable(ctx, { ...input, lines: [refreshedLine] });
const staleEvidenceQuote = await billingDocuments.upsertQuotePortable(ctx, { societyId, fields: { ...input, validUntil: "2099-12-31", lines: [refreshedLine], documentTemplate: DEFAULT_INVOICE_TEMPLATE } as any });
await db.patch(evidenceDocumentId, { content: "Synthetic replacement source that has not been reviewed." });
const ledgerBeforeChangedEvidence = beforeWrites();
await assert.rejects(() => invoices.markSentPortable(ctx, { societyId, ids: [staleEvidenceDraft] }), /Registration evidence changed/);
await assert.rejects(() => invoices.recordPaymentPortable(ctx, { id: staleEvidenceDraft, date, amountCents: 1000 }), /Registration evidence changed/);
await assert.rejects(() => billingDocuments.setQuoteStatusPortable(ctx, { id: staleEvidenceQuote, status: "sent" }), /Registration evidence changed/);
assert.equal((await db.get(staleEvidenceDraft))!.status, "draft");
assert.deepEqual((await db.get(staleEvidenceDraft))!.payments, []);
assert.equal((await db.get(staleEvidenceQuote))!.status, "draft");
assert.equal(beforeWrites(), ledgerBeforeChangedEvidence, "changed source evidence cannot cause any invoice, payment, quote or ledger publication");
const manual = await invoices.upsertPortable(ctx, { ...input, lines: [{ key: "manual", item: "Explicit manual rates", quantity: 1, unitPriceCents: 1000, taxRatePercent: 5, taxLabel: "GST" }] });
await invoices.markSentPortable(ctx, { societyId, ids: [manual] });
assert.equal((await db.get(manual))!.issuerTaxRegistrationsSnapshot.supplierFacts, undefined, "manual rates do not gain an assessed supplier claim");

// Direct API clients cannot bypass the historical-period review with a fully
// confirmed ordinary/nonprofit rule-pack result or the current facts key.
const endedId = await db.insert("organizationTaxRegistrations", { ...registrationFields, societyId, revisionNumber: 4, supersedesId: revisedId, status: "inactive", effectiveFrom: "2027-01-01", effectiveTo: "2027-06-30" });
const restartedId = await db.insert("organizationTaxRegistrations", { ...registrationFields, societyId, revisionNumber: 5, supersedesId: endedId, effectiveFrom: "2027-09-01" });
const multiContext = await loadOrganizationTaxContext(ctx, societyId);
const historyConflict = organizationTaxFacts(multiContext, mayDate);
assert.equal(historyConflict.charityRegistrationStatus, "conflict");
for (const sellerKind of ["business", "nonprofit"]) {
  const bypassAssessment = assessTax({ ...ordinary, sellerKind, supplyDate: mayDate, organizationFactsKey: historyConflict.factsKey }, true);
  assert.equal(bypassAssessment.confirmed, true, "the base rule-pack decision alone cannot establish organization facts");
  const historicalDraft = await invoices.upsertPortable(ctx, { ...input, issueDate: mayDate, lines: [lineFor(bypassAssessment)] });
  const beforeHistoricalPublication = beforeWrites();
  await assert.rejects(() => invoices.markSentPortable(ctx, { societyId, ids: [historicalDraft] }), /earlier reviewed registration in a separate period/);
  assert.equal((await db.get(historicalDraft))!.status, "draft");
  assert.equal(beforeWrites(), beforeHistoricalPublication);
}
await db.insert("organizationTaxRegistrations", {
  societyId, registrationType: "CA-CRA-CHARITY", revisionNumber: 6, supersedesId: restartedId,
  status: "unknown", evidenceReviewed: false, evidenceDocumentIds: [], recordedByUserId: ownerId, recordedAtISO: `${date}T12:00:00Z`,
});
const downgradedContext = await loadOrganizationTaxContext(ctx, societyId);
const downgradedFacts = organizationTaxFacts(downgradedContext, date);
assert.equal(downgradedFacts.charityRegistrationStatus, "unknown");
assert.equal(downgradedFacts.needsReview, true, "unknown cannot erase prior positive registration history when legacy isCharity is false");
assert.equal(assessTaxForOrganization(ordinary, downgradedContext, true).confirmed, false);
const downgradedDraft = await invoices.upsertPortable(ctx, { ...input, lines: [lineFor(assessTax({ ...ordinary, organizationFactsKey: downgradedFacts.factsKey }, true))] });
const beforeDowngradedPublication = beforeWrites();
await assert.rejects(() => invoices.markSentPortable(ctx, { societyId, ids: [downgradedDraft] }), /history claims charity registration/);
assert.equal((await db.get(downgradedDraft))!.status, "draft");
assert.equal(beforeWrites(), beforeDowngradedPublication);
assert.deepEqual((await db.get(goodDraft))!.issuerTaxRegistrationsSnapshot, frozen, "period changes cannot rewrite an issued supplier snapshot");
console.log("PASS organization tax facts: dated retained evidence, one-period history conflicts, legacy uncertainty, review/source invalidation, server batch/payment/quote gates before ledger writes, private projection, immutable snapshots and manual compatibility.");
