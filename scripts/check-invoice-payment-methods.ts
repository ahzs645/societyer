import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { PortableRuntime, definePortableMutation, definePortableQuery } from "../shared/portable/define";
import { tables, society } from "../src/lib/staticConvexFixtures";
import * as invoices from "../shared/functions/invoices";
import * as billingDocuments from "../shared/functions/billingDocuments";
import { DEFAULT_INVOICE_TEMPLATE } from "../shared/invoiceCommerce";
import { cleanInvoicePaymentMethods, invoicePaymentText, type InvoiceReceivingMethod } from "../shared/invoicePaymentMethods";

// Use the same authorization wrapper and transaction boundary as the offline app.
const seed: Record<string, any[]> = JSON.parse(JSON.stringify(tables));
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://invoice-payments.test", authSubject: `invoice-payments-${user._id}` }));
seed.societies = [JSON.parse(JSON.stringify(society)), { _id: "payment_foreign_society", name: "Foreign society" }];
const societyId = seed.users[0].societyId;
const userId = seed.users[0]._id;
const principal: any = { kind: "user", runtime: "test", assurance: "verified-jwt", subject: seed.users[0].authSubject, issuer: seed.users[0].authIssuer, userId, societyId };
const capabilities = makeCapabilities({});
const db = new MemoryDb({ seed });
const runtime = new PortableRuntime({ db, capabilities, principalProvider: () => principal });
runtime.registerAll([
  definePortableQuery({ name: "invoices:workspace", handler: invoices.workspacePortable, applicationPolicy: true }),
  ...Object.entries({
    saveSettings: invoices.saveSettingsPortable, upsert: invoices.upsertPortable,
    duplicate: invoices.duplicatePortable, upsertSeries: invoices.upsertSeriesPortable,
    issueFromSeries: invoices.issueFromSeriesPortable, upsertTemplate: invoices.upsertTemplatePortable,
    upsertRepairJob: invoices.upsertRepairJobPortable, invoiceRepairJob: invoices.invoiceRepairJobPortable,
    billMemberDues: invoices.billMemberDuesPortable, markSent: invoices.markSentPortable,
    sendReminders: invoices.sendRemindersPortable,
  }).map(([name, handler]) => definePortableMutation({ name: `invoices:${name}`, handler: handler as any, applicationPolicy: true })),
  ...Object.entries({ upsertQuote: billingDocuments.upsertQuotePortable, setQuoteStatus: billingDocuments.setQuoteStatusPortable, convertQuote: billingDocuments.convertQuotePortable })
    .map(([name, handler]) => definePortableMutation({ name: `billingDocuments:${name}`, handler: handler as any, applicationPolicy: true })),
]);
const mutate = (name: string, args: any) => runtime.runMutation(`invoices:${name}`, args);
const workspace = () => runtime.runQuery<any>("invoices:workspace", { societyId });
const eft: InvoiceReceivingMethod = { id: "society-eft", name: "Operating account — EFT", type: "eft", details: "Demo Society\nExample Bank\nInstitution 999 · Transit 12345 · Account 000123456\nUse your invoice number as the reference." };
const transfer: InvoiceReceivingMethod = { id: "society-transfer", name: "E-transfer", type: "e_transfer", details: "payments@example.test\nInclude the invoice number." };
const cheque: InvoiceReceivingMethod = { id: "society-cheque", name: "Cheque", type: "cheque", details: "Payable to Demo Society\n100 Demo Road, Vancouver, BC" };
const initialMethods: InvoiceReceivingMethod[] = [eft, transfer, cheque,
  { id: "society-cash", name: "Cash at reception", type: "cash", details: "Pay at the society reception desk; request a receipt." },
  { id: "society-card", name: "Card payment", type: "card", details: "https://payments.example.test/society\nInclude your invoice number." },
  { id: "society-other", name: "Alternative arrangement", type: "other", details: "Contact treasury@example.test to arrange payment." },
];
const saveSettings = async (methods: InvoiceReceivingMethod[], defaults: string[], instructions = "Include the invoice number with your payment.") => {
  const current = await workspace();
  return mutate("saveSettings", { societyId, prefix: current.settings.prefix, nextNumber: current.settings.nextNumber, defaultTerms: "net_30", paymentMethods: methods, defaultPaymentMethodIds: defaults, paymentInstructions: instructions });
};

await saveSettings(initialMethods, [eft.id, transfer.id]);
const ws = await workspace();
const today = ws.today;
assert.deepEqual(ws.settings.paymentMethods, initialMethods);
assert.deepEqual(ws.settings.defaultPaymentMethodIds, [eft.id, transfer.id]);
const invoiceArgs = {
  societyId, partyKind: "custom", billToName: "Payment scenario customer", billToEmail: "scenario@example.test",
  issueDate: today, terms: "net_30", currency: "CAD", lines: [{ key: "service", item: "Community workshop", quantity: 2, unitPriceCents: 1000 }],
};
const defaultId = await mutate("upsert", invoiceArgs);
const defaultInvoice: any = await db.get(defaultId);
assert.deepEqual(defaultInvoice.paymentMethods, [eft, transfer]);
assert.match(invoicePaymentText(defaultInvoice), /999.*12345.*000123456/s);
assert.match(invoicePaymentText(defaultInvoice), /payments@example.test/);
const customId = await mutate("upsert", { ...invoiceArgs, paymentMethodIds: [cheque.id] });
assert.deepEqual((await db.get(customId))!.paymentMethods, [cheque]);
const noMethodId = await mutate("upsert", { ...invoiceArgs, paymentMethodIds: [] });
assert.deepEqual((await db.get(noMethodId))!.paymentMethods, []);
await assert.rejects(() => mutate("upsert", { ...invoiceArgs, paymentMethodIds: ["foreign-receiving-account"] }), /unavailable/);
await assert.rejects(() => mutate("upsert", { ...invoiceArgs, paymentMethodIds: [eft.id, eft.id] }), /once/);
await assert.rejects(() => saveSettings([eft], ["foreign-receiving-account"]), /unavailable/);
await assert.rejects(() => saveSettings([{ ...eft, name: "  " }], [eft.id]), /name/);
await assert.rejects(() => saveSettings([{ ...eft, details: "" }], [eft.id]), /details/);
await assert.rejects(() => saveSettings([eft, eft], [eft.id]), /unique/);
assert.throws(() => cleanInvoicePaymentMethods(Array.from({ length: 21 }, (_, index) => ({ ...eft, id: `method-${index}` }))), /20/);

// Changing defaults, bank details or removing a method must not rewrite saved invoices.
const revisedEft = { ...eft, details: "Replacement bank account — NEW DETAILS" };
await saveSettings([revisedEft, cheque], [cheque.id], "New additional instructions");
assert.deepEqual((await db.get(defaultId))!.paymentMethods, [eft, transfer]);
await mutate("upsert", { ...invoiceArgs, id: defaultId, reference: "Unrelated draft edit" });
assert.deepEqual((await db.get(defaultId))!.paymentMethods, [eft, transfer]);
assert.equal((await db.get(defaultId))!.paymentInstructions, defaultInvoice.paymentInstructions);

// Selecting another method while retaining removed or revised methods preserves their original details.
await mutate("upsert", { ...invoiceArgs, id: defaultId, paymentMethodIds: [eft.id, transfer.id, cheque.id] });
assert.deepEqual((await db.get(defaultId))!.paymentMethods, [eft, transfer, cheque]);
const changedDefaultId = await mutate("upsert", invoiceArgs);
assert.deepEqual((await db.get(changedDefaultId))!.paymentMethods, [cheque]);
assert.equal((await db.get(changedDefaultId))!.paymentInstructions, "New additional instructions");
const duplicate: any = await db.get(await mutate("duplicate", { id: defaultId }));
assert.deepEqual(duplicate.paymentMethods, [eft, transfer, cheque]);
assert.equal(duplicate.paymentInstructions, defaultInvoice.paymentInstructions);

await mutate("upsertTemplate", { societyId, config: { ...DEFAULT_INVOICE_TEMPLATE, name: "Payment default design", accentColor: "#7842a6" }, makeDefault: true });
const seriesId = await mutate("upsertSeries", { ...invoiceArgs, fromInvoiceId: defaultId, name: "Original payment details series", frequency: "monthly", startDate: today, endKind: "after_count", endAfterCount: 3 });
const seriesInvoice: any = await db.get(await mutate("issueFromSeries", { id: seriesId }));
assert.deepEqual(seriesInvoice.paymentMethods, [eft, transfer, cheque]);
assert.equal(seriesInvoice.paymentInstructions, defaultInvoice.paymentInstructions);
const standaloneSeriesId = await mutate("upsertSeries", { ...invoiceArgs, name: "Current defaults series", frequency: "monthly", startDate: today, endKind: "after_count", endAfterCount: 3 });
const standaloneInvoice: any = await db.get(await mutate("issueFromSeries", { id: standaloneSeriesId }));
assert.deepEqual(standaloneInvoice.paymentMethods, [cheque]);
assert.equal(standaloneInvoice.documentTemplate?.name, "Payment default design", "standalone recurring invoices should use the society's default template");
const dues: any = await db.get(await mutate("billMemberDues", { societyId, memberId: "static_member_wei" }));
assert.deepEqual(dues.paymentMethods, [cheque]);
assert.equal(dues.documentTemplate?.name, "Payment default design");
const repairId = await mutate("upsertRepairJob", { ...invoiceArgs, receivedDate: today, asset: "Community bicycle", problem: "Safety check" });
const repairInvoice: any = await db.get(await mutate("invoiceRepairJob", { id: repairId }));
assert.deepEqual(repairInvoice.paymentMethods, [cheque]);
assert.equal(repairInvoice.documentTemplate?.name, "Payment default design");
const quoteId = await runtime.runMutation("billingDocuments:upsertQuote", { societyId, fields: { ...invoiceArgs, validUntil: "2099-12-31", documentTemplate: { ...DEFAULT_INVOICE_TEMPLATE, name: "Accepted quote design" } } });
await runtime.runMutation("billingDocuments:setQuoteStatus", { id: quoteId, status: "sent" });
await runtime.runMutation("billingDocuments:setQuoteStatus", { id: quoteId, status: "accepted", note: "Customer approved demo quote" });
const quoteInvoice: any = await db.get(await runtime.runMutation("billingDocuments:convertQuote", { id: quoteId, issueDate: today }));
assert.deepEqual(quoteInvoice.paymentMethods, [cheque]);
assert.equal(quoteInvoice.documentTemplate?.name, "Accepted quote design", "conversion preserves the accepted quote's design");

// Email drafts and reminders use the exact same saved receiving instructions as the printed invoice.
await mutate("markSent", { societyId, ids: [defaultId], draftEmail: true });
const emails: any[] = await db.query("pendingEmails").withIndex("by_society", (query) => query.eq("societyId", societyId)).collect();
const drafted = emails.find((email) => email.subject?.includes(defaultInvoice.number));
assert.ok(drafted, "invoice email draft exists");
assert.match(drafted.body, /payments@example.test/);
assert.match(drafted.body, /000123456/);
assert.doesNotMatch(drafted.body, /NEW DETAILS|New additional instructions/);

// A deterministic varied set catches empty defaults, order, multi-method selection, and snapshot leakage.
let randomState = 84137;
const random = () => ((randomState = (randomState * 1664525 + 1013904223) >>> 0) / 4294967296);
await saveSettings(initialMethods, [], "");
const currencies = ["CAD", "USD", "EUR", "GBP"];
for (let index = 0; index < 60; index++) {
  const selected = initialMethods.filter(() => random() > 0.45);
  const amount = Math.floor(random() * 90000) + 100;
  const id = await mutate("upsert", { ...invoiceArgs, billToName: `Randomized customer ${index + 1}`, currency: currencies[index % currencies.length], paymentMethodIds: selected.map((method) => method.id), lines: [{ key: `line-${index}`, item: `Community service ${index + 1}`, quantity: Math.floor(random() * 7) + 1, unitPriceCents: amount, taxRatePercent: index % 2 ? 5 : 0 }] });
  const row: any = await db.get(id);
  assert.deepEqual(row.paymentMethods, selected);
  assert.equal(row.paymentInstructions, "");
  const renderedInstructions = invoicePaymentText(row, "SHOULD NEVER APPEAR");
  assert.doesNotMatch(renderedInstructions, /SHOULD NEVER APPEAR/);
  for (const method of initialMethods) assert.equal(renderedInstructions.includes(method.details), selected.some((item) => item.id === method.id));
}

// Exercise role and tenancy decisions through the runtime wrapper, not bare handlers.
for (const role of ["Viewer", "Member", "Director"]) {
  await db.patch(userId, { role });
  await assert.rejects(() => mutate("saveSettings", { societyId, prefix: "PAY-", nextNumber: 500, defaultTerms: "net_30", paymentMethods: [], defaultPaymentMethodIds: [] }), /permission|access|allowed|authorized/i);
  await assert.rejects(() => mutate("upsert", invoiceArgs), /permission|access|allowed|authorized/i);
}
await db.patch(userId, { role: "Owner" });
await assert.rejects(() => mutate("saveSettings", { societyId: "payment_foreign_society", prefix: "PAY-", nextNumber: 1, defaultTerms: "net_30", paymentMethods: [], defaultPaymentMethodIds: [] }), /membership|permission|access/i);
await assert.rejects(() => mutate("upsert", { ...invoiceArgs, societyId: "payment_foreign_society" }), /membership|permission|access/i);
await assert.rejects(() => runtime.runQuery("invoices:workspace", { societyId: "payment_foreign_society" }), /membership|permission|access/i);
await db.patch(userId, { role: "Admin" });
await saveSettings(initialMethods, [eft.id]);
assert.deepEqual((await workspace()).settings.defaultPaymentMethodIds, [eft.id]);
await db.patch(userId, { status: "Disabled" });
await assert.rejects(() => mutate("upsert", invoiceArgs), /disabled/i);

console.log("Invoice receiving-method checks passed: 60 varied invoices; defaults and selections; immutable bank details; duplicate, recurring, dues, repair and quote paths; email drafts; validation; hosted identity tenancy and financial-write permissions.");
