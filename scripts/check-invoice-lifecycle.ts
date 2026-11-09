import assert from "node:assert/strict";
import { mock } from "node:test";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { deriveInvoiceStatus, isOpenStatus } from "../shared/invoicing";

// Hosted validators, authorization and atomicity exercise the same portable
// handlers as local workspaces, with synthetic organizations and no sending.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-08T20:00:00Z") });
const api: any = anyApi;
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./invoices.js": () => import("../convex/invoices"),
} as any);
const issuer = betterAuthIssuer();
const ids = await t.run(async ctx => {
  const logoStorageId = await ctx.storage.store(new Blob(["synthetic stored logo fixture"], { type: "image/png" }));
  const societyId = await ctx.db.insert("societies", { name: "Synthetic Original Ltd.", mailingAddress: "Original synthetic address", officialEmail: "billing@example.invalid", incorporationNumber: "SYN-123", logoStorageId, isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const otherId = await ctx.db.insert("societies", { name: "Other synthetic organization", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const [subject, role, workspace] of [["invoice-owner", "Owner", societyId], ["invoice-viewer", "Viewer", societyId], ["invoice-stranger", "Owner", otherId]] as const) {
    await ctx.db.insert("users", { societyId: workspace, email: `${subject}@example.invalid`, displayName: subject, role, status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-11-01T00:00:00Z" });
  }
  const gstId = await ctx.db.insert("organizationIdentifiers", { societyId, kind: "gst", number: "123456789RT0001", jurisdiction: "canada", registeredAt: "2026-01-01", status: "active", accessLevel: "internal", createdAtISO: "2026-01-01T00:00:00Z", updatedAtISO: "2026-01-01T00:00:00Z" });
  const connectionId = await ctx.db.insert("financialConnections", { societyId, provider: "societyer", status: "connected", connectedAtISO: "2026-01-01T00:00:00Z", demo: false });
  const revenue = await ctx.db.insert("financialAccounts", { societyId, connectionId, externalId: "synthetic-revenue", name: "Synthetic revenue", accountType: "Income", currency: "CAD", balanceCents: 0, isRestricted: false });
  const closed = await ctx.db.insert("accountingFiscalPeriods", { societyId, fiscalYear: "2026", periodLabel: "Closed October", startDate: "2026-10-01", endDate: "2026-10-31", status: "closed", createdAtISO: "2026-01-01T00:00:00Z", updatedAtISO: "2026-01-01T00:00:00Z" });
  return { societyId, otherId, gstId, revenue, closed, logoStorageId };
});
const owner = t.withIdentity({ subject: "invoice-owner", issuer });
const viewer = t.withIdentity({ subject: "invoice-viewer", issuer });
const stranger = t.withIdentity({ subject: "invoice-stranger", issuer });
const input = { societyId: ids.societyId, partyKind: "custom", billToName: "Synthetic customer", billToEmail: "customer@example.invalid", billToAddress: "Synthetic customer address", issueDate: "2026-11-06", terms: "net_30", currency: "CAD", lines: [{ key: "service", item: "Synthetic service", quantity: 1, unitPriceCents: 10000, taxRatePercent: 5, taxLabel: "GST" }] };
await owner.mutation(api.invoices.saveAccountMapping, { societyId: ids.societyId, defaultRevenueAccountId: ids.revenue, categoryAccounts: [] });
const get = (id: any) => t.run(ctx => ctx.db.get(id)) as Promise<any>;
const counts = () => t.run(async ctx => ({ entries: (await ctx.db.query("journalEntries").collect()).length, lines: (await ctx.db.query("journalLines").collect()).length, emails: (await ctx.db.query("pendingEmails").collect()).length }));
const id = await owner.mutation(api.invoices.upsert, input);
await assert.rejects(() => viewer.mutation(api.invoices.issue, { societyId: ids.societyId, ids: [id] }), /financials:write|permission/i);
await assert.rejects(() => stranger.query(api.invoices.document, { id }), /not found|membership|access|workspace/i);
await assert.rejects(() => stranger.mutation(api.invoices.issue, { societyId: ids.otherId, ids: [id] }), /not found|belong|workspace/i);
assert.equal((await get(id)).status, "draft");

const result = await owner.mutation(api.invoices.issue, { societyId: ids.societyId, ids: [id, id] });
assert.deepEqual(result, { issued: 1, skipped: 0, posted: 1 });
const issued = await get(id), afterIssue = await counts();
assert.equal(issued.status, "issued");
assert.ok(issued.issuedAtISO);
assert.equal(issued.sentAtISO, undefined);
assert.equal(issued.externalDelivery, undefined);
assert.deepEqual(issued.issuerSnapshot, { name: "Synthetic Original Ltd.", address: "Original synthetic address", email: "billing@example.invalid", registrationNumber: "SYN-123", logoStorageId: ids.logoStorageId });
assert.equal(issued.issuerTaxRegistrationsSnapshot.registrations[0].number, "123456789RT0001");
assert.equal(afterIssue.emails, 0, "finalization never creates an outgoing message");
assert.equal((await get(issued.journalEntryId)).date, input.issueDate, "issuance posts on the document date, independent of delivery/payment");
const document = await owner.query(api.invoices.document, { id });
assert.deepEqual([document.lifecycle, document.status, document.totalCents, document.balanceCents], ["issued", "issued", 10500, 10500]);
assert.equal(typeof document.issuerLogoUrl, "string", "the hosted query resolves the captured logo through its injected storage capability");
assert.equal((await owner.query(api.invoices.workspace, { societyId: ids.societyId })).invoices.find((row: any) => row._id === id).issuerLogoUrl, document.issuerLogoUrl);
assert.equal(isOpenStatus(document.status), true);
assert.equal(deriveInvoiceStatus({ status: "issued", dueDate: "2026-11-01", totalCents: 1000 }, "2026-11-08"), "overdue");
assert.deepEqual(await owner.mutation(api.invoices.sendReminders, { societyId: ids.societyId, ids: [id] }), { created: 0, skippedNoEmail: 0, skippedNotOpen: 1 });
assert.deepEqual(await counts(), afterIssue, "a finalized but unsent invoice cannot create a reminder email");
await assert.rejects(() => owner.mutation(api.invoices.upsert, { ...input, id, billToName: "Changed customer" }), /immutable/);
await assert.rejects(() => owner.mutation(api.invoices.remove, { id }), /Only unpaid drafts/);

await t.run(async ctx => {
  await ctx.db.patch(ids.societyId, { name: "Synthetic Changed Ltd.", mailingAddress: "Changed address", officialEmail: "changed@example.invalid", logoStorageId: undefined });
  await ctx.db.patch(ids.gstId, { number: "987654321RT0001" });
});
assert.deepEqual(await owner.mutation(api.invoices.issue, { societyId: ids.societyId, ids: [id] }), { issued: 0, skipped: 1, posted: 0 });
const unchanged = await owner.query(api.invoices.document, { id });
assert.deepEqual(unchanged.issuerSnapshot, issued.issuerSnapshot);
assert.equal(unchanged.issuerLogoUrl, document.issuerLogoUrl, "changing current branding cannot replace the historical invoice logo");
assert.deepEqual(unchanged.issuerTaxRegistrationsSnapshot, issued.issuerTaxRegistrationsSnapshot);
assert.deepEqual(await counts(), afterIssue, "repeated finalization neither posts nor sends twice");

const response = { id, response: "accepted", date: "2026-11-07", customerName: "Synthetic customer contact", reference: "External email thread reference", idempotencyKey: "customer-response-1" };
await assert.rejects(() => owner.mutation(api.invoices.recordClientResponse, response), /external sending/);
await assert.rejects(() => owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [id], sentDate: "2026-11-05", method: "email" }), /cannot precede/);
await assert.rejects(() => owner.mutation(api.invoices.markSent, { societyId: ids.societyId, ids: [id], sentDate: "2026-11-09", method: "email" }), /on or before today/);
const send = { societyId: ids.societyId, ids: [id], sentDate: "2026-11-07", method: "email", recipient: "customer@example.invalid", reference: "External sent-message reference", note: "Sent manually from our own mail client" };
assert.deepEqual(await owner.mutation(api.invoices.markSent, send), { sent: 1, emailed: 0, skipped: 0, posted: 0 });
const sent = await get(id);
assert.deepEqual([sent.status, sent.externalDelivery.sentDate, sent.externalDelivery.method, sent.externalDelivery.recipient, sent.externalDelivery.recordedByName], ["sent", "2026-11-07", "email", "customer@example.invalid", "invoice-owner"]);
assert.equal(sent.externalDelivery.source, "manual");
assert.deepEqual(await counts(), afterIssue, "recording external send has no ledger or email side effects");
assert.deepEqual(await owner.mutation(api.invoices.markSent, send), { sent: 0, emailed: 0, skipped: 1, posted: 0 });
assert.equal((await get(id)).timeline.length, sent.timeline.length);

await assert.rejects(() => viewer.mutation(api.invoices.recordClientResponse, response), /financials:write|permission/i);
await assert.rejects(() => owner.mutation(api.invoices.recordClientResponse, { ...response, response: "declined" }), /Explain/);
await assert.rejects(() => owner.mutation(api.invoices.recordClientResponse, { ...response, date: "2026-11-06" }), /response date/);
await owner.mutation(api.invoices.recordClientResponse, response);
const accepted = await get(id);
assert.equal(accepted.clientResponse.response, "accepted");
assert.equal(accepted.paidCents, 0);
assert.equal((await owner.query(api.invoices.document, { id })).balanceCents, 10500);
assert.deepEqual(await counts(), afterIssue, "customer acceptance is neither money nor a journal posting");
await owner.mutation(api.invoices.recordClientResponse, response);
assert.equal((await get(id)).timeline.length, accepted.timeline.length, "a retried response is recorded once");
await assert.rejects(() => owner.mutation(api.invoices.recordClientResponse, { ...response, customerName: "Another contact" }), /different details/);
await owner.mutation(api.invoices.recordClientResponse, { ...response, response: "disputed", date: "2026-11-08", note: "Customer queries one service charge", idempotencyKey: "customer-response-2" });
assert.deepEqual((await get(id)).timeline.filter((event: any) => event.clientResponse).map((event: any) => event.clientResponse.response), ["accepted", "disputed"]);
assert.equal((await get(id)).totalCents, 10500, "a dispute does not silently forgive the balance");

const paymentKey = await owner.mutation(api.invoices.recordPayment, { id, date: "2026-11-08", amountCents: 3000, method: "e_transfer", idempotencyKey: "manual-payment" });
assert.equal((await owner.query(api.invoices.document, { id })).status, "partially_paid");
assert.equal((await get(id)).clientResponse.response, "disputed", "financial and customer-response states are independent");
assert.equal((await owner.mutation(api.invoices.voidInvoices, { societyId: ids.societyId, ids: [id], reason: "Correction" })).skippedPaid, 1);
await owner.mutation(api.invoices.removePayment, { id, paymentKey, date: "2026-11-08", reason: "Synthetic reversal to test invoice correction" });
await owner.mutation(api.invoices.voidInvoices, { societyId: ids.societyId, ids: [id], reason: "Synthetic duplicate invoice" });
await assert.rejects(() => owner.mutation(api.invoices.recordClientResponse, { ...response, idempotencyKey: "void-response" }), /void invoices/);
await owner.mutation(api.invoices.restoreVoided, { id });
assert.equal((await get(id)).status, "sent");
assert.deepEqual((await get(id)).issuerSnapshot, issued.issuerSnapshot);
assert.equal((await get(id)).externalDelivery.sentDate, "2026-11-07");

const unsentId = await owner.mutation(api.invoices.upsert, input);
await owner.mutation(api.invoices.issue, { societyId: ids.societyId, ids: [unsentId] });
await owner.mutation(api.invoices.voidInvoices, { societyId: ids.societyId, ids: [unsentId], reason: "Synthetic restore check" });
await owner.mutation(api.invoices.restoreVoided, { id: unsentId });
assert.equal((await get(unsentId)).status, "issued", "restoring an unsent invoice must not invent external delivery");
assert.equal((await get(unsentId)).sentAtISO, undefined);
const paidDraft = await owner.mutation(api.invoices.upsert, input);
await owner.mutation(api.invoices.recordPayment, { id: paidDraft, date: "2026-11-08", amountCents: 1000, method: "cash" });
assert.deepEqual([(await get(paidDraft)).status, (await get(paidDraft)).sentAtISO], ["issued", undefined]);
assert.ok((await get(paidDraft)).issuerSnapshot);
assert.deepEqual(await owner.mutation(api.invoices.sendReminders, { societyId: ids.societyId, ids: [paidDraft] }), { created: 0, skippedNoEmail: 0, skippedNotOpen: 1 }, "a derived partially-paid status must not permit reminders before external sending");
const duplicate = await owner.mutation(api.invoices.duplicate, { id });
assert.deepEqual([(await get(duplicate)).status, (await get(duplicate)).issuerSnapshot, (await get(duplicate)).externalDelivery, (await get(duplicate)).clientResponse], ["draft", undefined, undefined, undefined]);
assert.notEqual((await get(duplicate)).number, issued.number);

const emailDraftId = await owner.mutation(api.invoices.upsert, input);
const emailDraft = { societyId: ids.societyId, ids: [emailDraftId], draftEmail: true };
assert.deepEqual(await owner.mutation(api.invoices.markSent, emailDraft), { sent: 0, emailed: 1, skipped: 0, posted: 1 });
assert.deepEqual([(await get(emailDraftId)).status, (await get(emailDraftId)).sentAtISO, (await get(emailDraftId)).externalDelivery], ["issued", undefined, undefined]);
const emailCount = (await counts()).emails;
assert.deepEqual(await owner.mutation(api.invoices.markSent, emailDraft), { sent: 0, emailed: 0, skipped: 1, posted: 0 });
assert.equal((await counts()).emails, emailCount, "retries must not duplicate an Outbox draft");

// A rejected batch must leave the earlier open-period draft untouched.
const openDraft = await owner.mutation(api.invoices.upsert, input);
const closedDraft = await owner.mutation(api.invoices.upsert, { ...input, issueDate: "2026-10-15" });
const beforeClosed = await counts();
await assert.rejects(() => owner.mutation(api.invoices.issue, { societyId: ids.societyId, ids: [openDraft, closedDraft] }), /closed/i);
assert.deepEqual([(await get(openDraft)).status, (await get(closedDraft)).status], ["draft", "draft"]);
assert.deepEqual(await counts(), beforeClosed);
console.log("PASS manual invoice lifecycle: saved-document finalization, immutable issuer/GST and recipient, separate external sending/customer responses/payments, retries, dated corrections, legacy restore, authorization and atomic batches.");

// Returning an internal finalization to draft is distinct from replacing an
// externally issued or posted document. Exercise the real hosted authorization,
// indexes and atomic mutation, including the archive and refreshed defaults.
await t.run(async ctx => {
  const settings = await ctx.db.query("invoiceSettings").withIndex("by_society", q => q.eq("societyId", ids.societyId)).first();
  await ctx.db.patch(settings!._id, { defaultRevenueAccountId: undefined, categoryAccounts: [], paymentMethods: [{ id: "bank", name: "Old bank details", type: "eft", details: "Synthetic old receiving details" }], defaultPaymentMethodIds: ["bank"], paymentInstructions: "Original receiving note" });
  await ctx.db.patch(ids.societyId, { logoStorageId: ids.logoStorageId });
});
const correctableId = await owner.mutation(api.invoices.upsert, { ...input, issueDate: "2026-11-08" });
assert.deepEqual(await owner.mutation(api.invoices.issue, { societyId: ids.societyId, ids: [correctableId] }), { issued: 1, skipped: 0, posted: 0 });
const beforeReopen = await get(correctableId);
await t.run(async ctx => {
  const settings = await ctx.db.query("invoiceSettings").withIndex("by_society", q => q.eq("societyId", ids.societyId)).first();
  await ctx.db.patch(settings!._id, { paymentMethods: [{ id: "bank", name: "Current EFT details", type: "eft", details: "Transit: 00002 (synthetic fixture)" }], paymentInstructions: "Current receiving note" });
});
await assert.rejects(() => viewer.mutation(api.invoices.returnToDraft, { id: correctableId, reason: "Not authorized" }), /permission|financials:write/i);
await assert.rejects(() => stranger.mutation(api.invoices.returnToDraft, { id: correctableId, reason: "Other workspace" }), /permission|membership|access|workspace/i);
await assert.rejects(() => owner.mutation(api.invoices.returnToDraft, { id: correctableId, reason: " " }), /reason/i);
const priorCounts = await counts();
assert.equal(await owner.mutation(api.invoices.returnToDraft, { id: correctableId, reason: "Never sent; correct the date and taxes" }), correctableId);
const reopened = await get(correctableId);
assert.equal(reopened.status, "draft");
assert.equal(reopened.number, beforeReopen.number);
assert.deepEqual([reopened.issuedAtISO, reopened.issuerSnapshot, reopened.issuerTaxRegistrationsSnapshot], [undefined, undefined, undefined]);
assert.equal(reopened.paymentMethods[0].details, "Transit: 00002 (synthetic fixture)");
assert.equal(reopened.paymentInstructions, "Current receiving note");
assert.deepEqual(await counts(), priorCounts, "reopening creates no journals, payments or emails");
const revisionId = reopened.timeline.at(-1).previousVersionId;
assert.ok(revisionId);
assert.deepEqual(JSON.parse((await get(revisionId)).snapshotJson), beforeReopen, "the complete earlier saved document remains archived");
await assert.rejects(() => stranger.query(api.invoices.previousDocument, { id: revisionId }), /permission|membership|access|workspace/i);
await assert.rejects(() => owner.mutation(api.invoices.remove, { id: correctableId }), /prepared|retained|void/i);
await assert.rejects(() => owner.mutation(api.invoices.returnToDraft, { id: correctableId, reason: "Retry" }), /finalized/i);
await owner.mutation(api.invoices.upsert, { ...input, id: correctableId, issueDate: "2026-11-08", lines: [{ ...input.lines[0], unitPriceCents: 20000 }] });
await owner.mutation(api.invoices.issue, { societyId: ids.societyId, ids: [correctableId] });
const afterReissue = await owner.query(api.invoices.document, { id: correctableId });
const previousVersion = await owner.query(api.invoices.previousDocument, { id: revisionId });
assert.equal(afterReissue.number, beforeReopen.number);
assert.equal(afterReissue.totalCents, 21000);
assert.equal(previousVersion.totalCents, 10500);
assert.equal(previousVersion.paymentInstructions, "Original receiving note");
assert.equal(typeof previousVersion.issuerLogoUrl, "string");
const { storageHasRetainedDocumentReference } = await import("../shared/functions/receiptRetention");
await t.run(async ctx => {
  await ctx.db.patch(correctableId, { issuerSnapshot: undefined });
  // Remove every live invoice logo reference to prove the archived version pins it.
  for (const row of await ctx.db.query("invoices").collect()) if (row.issuerSnapshot?.logoStorageId) await ctx.db.patch(row._id, { issuerSnapshot: { ...row.issuerSnapshot, logoStorageId: undefined } });
  assert.equal(await storageHasRetainedDocumentReference(ctx as any, ids.societyId, ids.logoStorageId), true);
});
for (const blockedId of [id, unsentId, paidDraft, emailDraftId, openDraft]) {
  await assert.rejects(() => owner.mutation(api.invoices.returnToDraft, { id: blockedId, reason: "Must remain locked" }));
}
// An accrual whose backlink was lost must still block editing.
const orphanId = await owner.mutation(api.invoices.upsert, { ...input, issueDate: "2026-11-08" });
await owner.mutation(api.invoices.issue, { societyId: ids.societyId, ids: [orphanId] });
await t.run(async ctx => {
  const originalEntry = await ctx.db.get(issued.journalEntryId);
  const { _id, _creationTime, ...fields } = originalEntry! as any;
  await ctx.db.insert("journalEntries", { ...fields, sourceExternalId: `invoice:${orphanId}` });
});
await assert.rejects(() => owner.mutation(api.invoices.returnToDraft, { id: orphanId, reason: "Orphan posting" }), /ledger history/i);
const scheduledId = await owner.mutation(api.invoices.upsert, { ...input, issueDate: "2026-11-08" });
await owner.mutation(api.invoices.issue, { societyId: ids.societyId, ids: [scheduledId] });
await t.run(ctx => ctx.db.insert("billingAutomationSchedules", { societyId: ids.societyId, name: "Synthetic reminder", kind: "invoice_reminder", sourceId: scheduledId, recipients: ["customer@example.invalid"], recipientsConfirmed: true, active: false, timezone: "America/Vancouver", localTime: "09:00", cadence: "monthly", anchorDay: 8, nextLocalDate: "2026-12-08", nextRunAtISO: "2026-12-08T17:00:00Z", createdByUserId: "synthetic", createdAtISO: "2026-11-08T20:00:00Z", updatedAtISO: "2026-11-08T20:00:00Z" }));
await assert.rejects(() => owner.mutation(api.invoices.returnToDraft, { id: scheduledId, reason: "Prepared reminder" }), /automation history/i);
console.log("PASS unsent invoice corrections: same number, complete prior version, permission/ownership gates, receiving defaults, no ledger/email effects, retained logos, reissue, delete protection and posting/automation refusals.");
mock.timers.reset();
