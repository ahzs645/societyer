import assert from "node:assert/strict";
import { mock } from "node:test";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { assessTax, defaultTaxAnswers, taxAssessmentRates } from "../shared/tax";
import { assessTaxForOrganization } from "../shared/tax/organizationFacts";
import { receiptEvidenceFingerprint } from "../shared/receipting/evidence";
import { DEFAULT_INVOICE_TEMPLATE } from "../shared/invoiceCommerce";

mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-06T20:00:00Z") });

const api: any = anyApi;
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./invoices.js": () => import("../convex/invoices"),
  "./billingDocuments.js": () => import("../convex/billingDocuments"),
} as any);
const issuer = betterAuthIssuer();
const ids = await t.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Synthetic tax organization", entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act__british_columbia_", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const otherId = await ctx.db.insert("societies", { name: "Other synthetic organization", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const [subject, role] of [["tax-owner", "Owner"], ["tax-viewer", "Viewer"]]) await ctx.db.insert("users", { societyId, email: `${subject}@example.invalid`, displayName: subject, role, status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-11-06T00:00:00Z" });
  for (const [kind, number] of [["gst", "123456789RT0001"], ["pst", "PST-1234-5678"]]) await ctx.db.insert("organizationIdentifiers", { societyId, kind, number, jurisdiction: "british_columbia", registeredAt: "2026-01-01", status: "active", accessLevel: "internal", createdAtISO: "2026-01-01T00:00:00Z", updatedAtISO: "2026-01-01T00:00:00Z" });
  const foreignCatalogId = await ctx.db.insert("invoiceCatalogItems", { societyId: otherId, name: "Foreign item", unitPriceCents: 10000, active: true, createdAtISO: "2026-11-06T00:00:00Z", updatedAtISO: "2026-11-06T00:00:00Z" });
  return { societyId, otherId, foreignCatalogId };
});
const owner = t.withIdentity({ subject: "tax-owner", issuer });
const viewer = t.withIdentity({ subject: "tax-viewer", issuer });
const answers = { ...defaultTaxAnswers("transaction", "2026-11-06"), jurisdictionCode: "CA-BC", itemCategory: "goods", sellerKind: "business", scopeConfirmed: "yes", federalException: "none", gstRegistration: "registered", provincialException: "category", pstRegistration: "registered", customerRelief: "none" };
const assessment = assessTax(answers, true);
const catalogAssessment = assessTax({ ...answers, scope: "catalog" }, true);
const catalogArgs = { societyId: ids.societyId, name: "Synthetic equipment", kind: "item", unitPriceCents: 10000, currency: "CAD", taxAssessment: catalogAssessment, ...taxAssessmentRates(catalogAssessment) };
const catalogItemId = await owner.mutation(api.invoices.upsertCatalogItem, catalogArgs);
assert.equal((await t.run((ctx) => ctx.db.get(catalogItemId)))?.taxAssessment?.rulePackId, assessment.rulePackId);
await assert.rejects(() => viewer.mutation(api.invoices.upsertCatalogItem, catalogArgs), /permission|not allowed|access/i);
await assert.rejects(() => owner.mutation(api.invoices.upsertCatalogItem, { ...catalogArgs, taxAssessment: assessment }), /catalog assessment/);
await assert.rejects(() => owner.mutation(api.invoices.upsertCatalogItem, { ...catalogArgs, taxRatePercent: 1 }), /match/);
const changedCatalogId = await owner.mutation(api.invoices.upsertCatalogItem, { ...catalogArgs, name: "Catalog identity review" });
await owner.mutation(api.invoices.upsertCatalogItem, { ...catalogArgs, id: changedCatalogId, name: "Different supply identity" });
assert.equal((await t.run((ctx) => ctx.db.get(changedCatalogId)))?.taxAssessment?.confirmed, false, "catalog identity edits require renewed confirmation");

const line = { key: "line1", catalogItemId, item: "Synthetic equipment", quantity: 1, unitPriceCents: 10000, taxAssessment: assessment, ...taxAssessmentRates(assessment) };
const input = { societyId: ids.societyId, partyKind: "custom", billToName: "Synthetic buyer", issueDate: "2026-11-06", terms: "net_30", currency: "CAD", lines: [line] };
const invoiceId = await owner.mutation(api.invoices.upsert, input);
let invoice: any = await t.run((ctx) => ctx.db.get(invoiceId));
assert.equal(invoice.totalCents, 11200);
assert.equal(invoice.lines[0].taxAssessment.confirmed, true);
assert.equal(invoice.lines[0].additionalTaxes[0].label, "PST");
await owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [invoiceId] });
invoice = await t.run((ctx) => ctx.db.get(invoiceId));
assert.equal(invoice.status, "sent");
await assert.rejects(() => owner.mutation(api.invoices.upsert, { ...input, id: invoiceId, billToName: "Another recipient" }), /fixed to their recipient/);
await assert.rejects(() => owner.mutation(api.invoices.upsert, { ...input, id: invoiceId, lines: [{ ...line, item: "Different supply" }] }), /Issued tax decisions/);
await assert.rejects(() => owner.mutation(api.invoices.upsert, { ...input, id: invoiceId, lines: [{ ...line, taxAssessment: undefined, taxRatePercent: 0, taxLabel: undefined, additionalTaxes: undefined }] }), /Issued tax decisions/);
await assert.rejects(() => owner.mutation(api.invoices.upsert, { ...input, lines: [{ ...line, catalogItemId: ids.foreignCatalogId }] }), /not found|workspace|belong/i);

const pending = await owner.mutation(api.invoices.upsert, { ...input, lines: [{ ...line, taxAssessment: assessTax({ ...answers, customerRelief: "unknown" }) }] });
await assert.rejects(() => owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [pending] }), /Complete and confirm/);
assert.equal((await t.run((ctx) => ctx.db.get(pending)))?.status, "draft");
const wrongRate = await owner.mutation(api.invoices.upsert, { ...input, lines: [{ ...line, taxRatePercent: 1 }] });
await assert.rejects(() => owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [wrongRate] }), /rates differ/);
const wrongDate = await owner.mutation(api.invoices.upsert, { ...input, issueDate: "2026-11-07" });
await assert.rejects(() => owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [wrongDate] }), /date changed/);
const changedCustomer = await owner.mutation(api.invoices.upsert, input);
await owner.mutation(api.invoices.upsert, { ...input, id: changedCustomer, billToName: "Different buyer" });
assert.equal((await t.run((ctx) => ctx.db.get(changedCustomer)))?.lines[0].taxAssessment?.confirmed, false);
await assert.rejects(() => owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [changedCustomer] }), /confirm/);
const duplicate = await owner.mutation(api.invoices.duplicate, { id: invoiceId });
assert.equal((await t.run((ctx) => ctx.db.get(duplicate)))?.lines[0].taxAssessment?.confirmed, false);

const exemptAssessment = assessTax({ ...answers, federalException: "zero_rated", federalEvidence: "Synthetic verified rule", provincialException: "exempt", provincialEvidence: "Synthetic provincial rule" }, true);
const noTaxId = await owner.mutation(api.invoices.upsert, { ...input, lines: [{ ...line, ...taxAssessmentRates(exemptAssessment), taxAssessment: exemptAssessment }] });
const noTax: any = await t.run((ctx) => ctx.db.get(noTaxId));
assert.equal(noTax.totalCents, 10000);
assert.equal(noTax.lines[0].taxAssessment.components[0].treatment, "zero_rated");
assert.equal(noTax.lines[0].taxAssessment.components[1].treatment, "exempt");
assert.equal(noTax.lines[0].taxAssessment.answers.provincialEvidence, "Synthetic provincial rule");
const schemaTamper = { ...assessment, answers: { ...answers, scopeConfirmed: "no" }, status: "ready", confirmed: true, issues: [] };
const tamperId = await owner.mutation(api.invoices.upsert, { ...input, lines: [{ ...line, taxAssessment: schemaTamper }] });
assert.equal((await t.run((ctx) => ctx.db.get(tamperId)))?.lines[0].taxAssessment?.status, "review_required");
const quoteFields = { partyKind: "custom", billToName: "Quote buyer", issueDate: "2026-11-06", validUntil: "2026-12-31", currency: "CAD", lines: [line], documentTemplate: DEFAULT_INVOICE_TEMPLATE };
const quoteId = await owner.mutation(api.billingDocuments.upsertQuote, { societyId: ids.societyId, fields: quoteFields });
await owner.mutation(api.billingDocuments.upsertQuote, { societyId: ids.societyId, id: quoteId, fields: { ...quoteFields, billToName: "Another quote buyer" } });
assert.equal((await t.run((ctx) => ctx.db.get(quoteId)))?.fields.lines[0].taxAssessment?.confirmed, false, "quote party change invalidates prior relief");
await assert.rejects(() => owner.mutation(api.billingDocuments.setQuoteStatus, { id: quoteId, status: "sent" }), /Complete and confirm/);
const approvedQuote = await owner.mutation(api.billingDocuments.upsertQuote, { societyId: ids.societyId, fields: quoteFields });
await owner.mutation(api.billingDocuments.setQuoteStatus, { id: approvedQuote, status: "sent" });
await owner.mutation(api.billingDocuments.setQuoteStatus, { id: approvedQuote, status: "accepted", note: "Synthetic acceptance evidence" });
const converted = await owner.mutation(api.billingDocuments.convertQuote, { id: approvedQuote, issueDate: "2026-11-06" });
assert.equal((await t.run((ctx) => ctx.db.get(converted)))?.lines[0].taxAssessment?.confirmed, false, "same-date quote conversion rechecks the actual invoice");
const customerId = await owner.mutation(api.invoices.upsertCustomer, { societyId: ids.societyId, name: "Saved synthetic buyer", address: "Synthetic BC address" });
const customerInput = { ...input, partyKind: "organization", counterpartyId: customerId, billToName: "Saved synthetic buyer", billToAddress: "Synthetic BC address" };
const customerDraft = await owner.mutation(api.invoices.upsert, customerInput);
const customerIssued = await owner.mutation(api.invoices.upsert, customerInput);
await owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [customerIssued] });
const customerQuote = await owner.mutation(api.billingDocuments.upsertQuote, { societyId: ids.societyId, fields: { ...quoteFields, partyKind: "organization", counterpartyId: customerId, billToName: "Saved synthetic buyer", billToAddress: "Synthetic BC address" } });
await owner.mutation(api.invoices.upsertCustomer, { societyId: ids.societyId, id: customerId, name: "Changed synthetic buyer", address: "Synthetic Ontario address", updateSentInvoices: true });
const updatedDraft: any = await t.run((ctx) => ctx.db.get(customerDraft));
assert.equal(updatedDraft.billToAddress, "Synthetic Ontario address");
assert.equal(updatedDraft.lines[0].taxAssessment.confirmed, false, "customer master changes invalidate draft tax decisions");
assert.equal((await t.run((ctx) => ctx.db.get(customerQuote)))?.fields.lines[0].taxAssessment?.confirmed, false, "customer master changes invalidate draft quote tax decisions");
assert.equal((await t.run((ctx) => ctx.db.get(customerIssued)))?.billToName, "Saved synthetic buyer", "issued assessed invoices retain their recipient even when master edits opt into legacy renaming");
await owner.mutation(api.invoices.upsertCustomer, { societyId: ids.societyId, name: "Promoted one-off buyer", oneOffName: "Synthetic buyer", updateSentInvoices: true });
assert.equal((await t.run((ctx) => ctx.db.get(invoiceId)))?.partyKind, "custom", "promoting one-off customers cannot relink issued tax evidence");

// The hosted publisher must load organization facts itself; client answers and
// forged success flags do not override dated charity evidence.
const charityRegistrationId = await t.run(async ctx => {
  const content = "Synthetic authority source retained for the hosted supplier-facts regression fixture.";
  const evidence = await ctx.db.insert("documents", { societyId: ids.societyId, title: "Synthetic reviewed registration", category: "Finance", content, createdAtISO: "2026-11-06T00:00:00Z", flaggedForDeletion: false, tags: [] });
  return ctx.db.insert("organizationTaxRegistrations", {
    societyId: ids.societyId, registrationType: "CA-CRA-CHARITY", revisionNumber: 1, status: "registered", evidenceReviewed: true,
    charityNumber: "123456789RR0001", registeredName: "Synthetic tax organization", registeredAddress: "Synthetic registered address", effectiveFrom: "2026-01-01",
    evidenceDocumentIds: [evidence], recordedByUserId: "synthetic-reviewer", recordedAtISO: "2026-11-06T00:00:00Z", reviewedByUserId: "synthetic-reviewer", reviewedAtISO: "2026-11-06T00:00:00Z",
    evidenceSnapshots: [{ documentId: evidence, fingerprint: await receiptEvidenceFingerprint({ documentId: evidence, content }) }],
  });
});
const conflictingSupplier = await owner.mutation(api.invoices.upsert, input);
const ledgerCount = await t.run(async ctx => ({ entries: (await ctx.db.query("journalEntries").collect()).length, lines: (await ctx.db.query("journalLines").collect()).length, accounts: (await ctx.db.query("financialAccounts").collect()).length }));
await assert.rejects(() => owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [conflictingSupplier] }), /reviewed registration identifies a registered charity/);
await assert.rejects(() => owner.mutation(api.invoices.recordPayment, { id: conflictingSupplier, date: "2026-11-06", amountCents: 1000, method: "cash" }), /reviewed registration identifies a registered charity/);
assert.equal((await t.run(ctx => ctx.db.get(conflictingSupplier)))?.status, "draft");
assert.deepEqual(await t.run(async ctx => ({ entries: (await ctx.db.query("journalEntries").collect()).length, lines: (await ctx.db.query("journalLines").collect()).length, accounts: (await ctx.db.query("financialAccounts").collect()).length })), ledgerCount);
const projected: any = await owner.query(api.invoices.workspace, { societyId: ids.societyId });
assert.doesNotMatch(JSON.stringify(projected.organization.charityRegistrations), /charityNumber|registeredAddress|evidenceDocumentIds|reviewedByUserId/);
const charityAssessment = assessTaxForOrganization({ ...answers, sellerKind: "charity", charityEvidence: "Synthetic review of the charity's ordinary taxable supply" }, projected.organization, true);
assert.equal(charityAssessment.confirmed, true);
const charityInvoice = await owner.mutation(api.invoices.upsert, { ...input, lines: [{ ...line, taxAssessment: charityAssessment, ...taxAssessmentRates(charityAssessment) }] });
await owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [charityInvoice] });
assert.equal((await t.run(ctx => ctx.db.get(charityInvoice)))?.issuerTaxRegistrationsSnapshot?.supplierFacts?.charityRegistrationRevisionId, charityRegistrationId);
const changedSourceInvoice = await owner.mutation(api.invoices.upsert, { ...input, lines: [{ ...line, taxAssessment: charityAssessment, ...taxAssessmentRates(charityAssessment) }] });
await t.run(async ctx => {
  const reviewed = (await ctx.db.get(charityRegistrationId))!;
  await ctx.db.patch(reviewed.evidenceDocumentIds[0], { content: "Synthetic changed source after review." });
});
const beforeChangedSource = await t.run(async ctx => ({ entries: (await ctx.db.query("journalEntries").collect()).length, lines: (await ctx.db.query("journalLines").collect()).length, accounts: (await ctx.db.query("financialAccounts").collect()).length }));
await assert.rejects(() => owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [changedSourceInvoice] }), /Registration evidence changed/);
assert.equal((await t.run(ctx => ctx.db.get(changedSourceInvoice)))?.status, "draft");
assert.deepEqual(await t.run(async ctx => ({ entries: (await ctx.db.query("journalEntries").collect()).length, lines: (await ctx.db.query("journalLines").collect()).length, accounts: (await ctx.db.query("financialAccounts").collect()).length })), beforeChangedSource);
console.log("PASS hosted tax schema and handlers: catalog and line persistence, independent zero/exempt treatment, authorization/tenant isolation, server recomputation, issue gates, customer/date changes and immutable issued decisions.");
mock.timers.reset();
