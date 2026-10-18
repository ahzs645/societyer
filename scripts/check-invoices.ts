// Invoicing gate: totals and tax rounding, status derivation (overdue on the
// organisation's local today), terms, numbering and recurrence, then the
// portable handlers against the demo seed (partial payments, bank-line links,
// void rules, dues generation + undo, series issue, reminders to the Outbox).
import assert from "node:assert/strict";
import {
  addMonthsClamped,
  allocateProportionally,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  dueDateForTerms,
  formatInvoiceNumber,
  nextInvoiceSequence,
  normalizeInvoicePrefix,
  seriesNextIssueDate,
  seriesOccurrenceDate,
  suggestPaymentTransactions,
  summarizeCustomers,
  validateInvoiceLines,
  type InvoiceLine,
} from "../shared/invoicing";
import { resolutionCalendarDate } from "../shared/writtenResolutionEvidence";

const line = (quantity: number, unitPriceCents: number, taxRatePercent?: number, taxLabel = "GST"): InvoiceLine => ({
  key: `l${quantity}-${unitPriceCents}`,
  item: "Item",
  quantity,
  unitPriceCents,
  ...(taxRatePercent ? { taxRatePercent, taxLabel } : {}),
});

// ---- totals and tax
{
  const t = computeInvoiceTotals([line(4, 12000, 5)]);
  assert.deepEqual([t.subtotalCents, t.taxCents, t.totalCents], [48000, 2400, 50400]);
  // fractional quantity rounds half away from zero per line
  assert.equal(computeInvoiceTotals([line(1.5, 3333)]).subtotalCents, 5000); // 4999.5 -> 5000
  // tax is rounded once per rate, not per line: 3 × $0.33 at 5% = 4.95¢ -> 5¢ (per line would be 3 × 2¢ = 6¢)
  assert.equal(computeInvoiceTotals([line(1, 33, 5), line(1, 33, 5), line(1, 33, 5)]).taxCents, 5);
  // separate labels/rates are separate tax lines
  const mixed = computeInvoiceTotals([line(1, 10000, 5, "GST"), line(1, 10000, 7, "PST"), line(1, 10000)]);
  assert.deepEqual(mixed.taxes.map((x) => [x.label, x.cents]), [["GST", 500], ["PST", 700]]);
  assert.equal(mixed.totalCents, 31200);
  // a discount comes off before tax, spread across lines in proportion
  const d = computeInvoiceTotals([line(1, 30000, 5), line(1, 10000)], { kind: "percent", value: 10 });
  assert.equal(d.discountCents, 4000);
  assert.equal(d.taxCents, 1350); // 5% of (30000 - 3000)
  assert.equal(d.totalCents, 40000 - 4000 + 1350);
  // a fixed discount never exceeds the subtotal
  assert.equal(computeInvoiceTotals([line(1, 500)], { kind: "amount", value: 900 }).totalCents, 0);
  // 18 × $40 less 10% (the demo PAC invoice)
  assert.equal(computeInvoiceTotals([line(18, 4000)], { kind: "percent", value: 10 }).totalCents, 64800);
  assert.deepEqual(allocateProportionally(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(allocateProportionally(7, [3, 0, 5]).reduce((a, b) => a + b, 0), 7);
  assert.equal(validateInvoiceLines([]), "Add at least one line item.");
  assert.match(validateInvoiceLines([line(0, 100)])!, /quantity/);
  assert.match(validateInvoiceLines([line(1, 100, 40)])!, /tax rate/);
}

// ---- status derivation
{
  const base = { status: "sent", dueDate: "2026-05-01", totalCents: 10000, payments: [] as any[] };
  assert.equal(deriveInvoiceStatus({ ...base, status: "draft" }, "2026-06-01"), "draft");
  assert.equal(deriveInvoiceStatus({ ...base, status: "void" }, "2026-06-01"), "void");
  assert.equal(deriveInvoiceStatus(base, "2026-04-30"), "sent");
  assert.equal(deriveInvoiceStatus(base, "2026-05-01"), "sent", "due today is not overdue");
  assert.equal(deriveInvoiceStatus(base, "2026-05-02"), "overdue");
  assert.equal(deriveInvoiceStatus({ ...base, payments: [{ amountCents: 4000 }] }, "2026-04-30"), "partially_paid");
  assert.equal(deriveInvoiceStatus({ ...base, payments: [{ amountCents: 4000 }] }, "2026-05-02"), "overdue", "overdue wins over partially paid");
  assert.equal(deriveInvoiceStatus({ ...base, payments: [{ amountCents: 10000 }] }, "2026-09-01"), "paid");
  // Organisation-local today: 03:00 UTC on 2 May is still 1 May in Vancouver.
  const nowISO = "2026-05-02T03:00:00.000Z";
  const vancouverToday = resolutionCalendarDate(nowISO, "America/Vancouver")!;
  assert.equal(vancouverToday, "2026-05-01");
  assert.equal(deriveInvoiceStatus(base, vancouverToday), "sent", "not overdue on the org's calendar");
  assert.equal(deriveInvoiceStatus(base, nowISO.slice(0, 10)), "overdue", "the UTC date would wrongly flag it");
}

// ---- terms, numbering, recurrence
{
  assert.equal(dueDateForTerms("2026-01-31", "net_30"), "2026-03-02");
  assert.equal(dueDateForTerms("2026-04-21", "due_on_receipt"), "2026-04-21");
  assert.equal(dueDateForTerms("2026-04-21", "custom", "2026-06-01"), "2026-06-01");
  assert.equal(formatInvoiceNumber("RCS-", 7), "RCS-0007");
  assert.equal(formatInvoiceNumber("INV-", 12345), "INV-12345");
  assert.equal(normalizeInvoicePrefix("  "), "INV-");
  assert.equal(normalizeInvoicePrefix("A B<c>"), "ABc");
  assert.equal(nextInvoiceSequence([{ sequence: 3 }, { sequence: 9 }], 5), 10, "never reuses a number");
  assert.equal(nextInvoiceSequence([{ sequence: 3 }], 100), 100, "a configured jump is kept");
  assert.equal(nextInvoiceSequence([], undefined), 1);
  assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsClamped("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsClamped("2026-11-15", 3), "2027-02-15");
  // anchored to the start date: Jan 31 monthly → Feb 28 → Mar 31 (no drift to the 28th)
  const monthly = { frequency: "monthly", startDate: "2026-01-31", endKind: "never" };
  assert.deepEqual([0, 1, 2].map((i) => seriesOccurrenceDate(monthly, i)), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.equal(seriesNextIssueDate({ frequency: "quarterly", startDate: "2026-01-15", endKind: "never" }, 2), "2026-07-15");
  assert.equal(seriesNextIssueDate({ frequency: "annually", startDate: "2024-02-29", endKind: "never" }, 1), "2025-02-28");
  assert.equal(seriesNextIssueDate({ ...monthly, endKind: "after_count", endAfterCount: 3 }, 3), null);
  assert.equal(seriesNextIssueDate({ ...monthly, endKind: "after_count", endAfterCount: 3 }, 2), "2026-03-31");
  assert.equal(seriesNextIssueDate({ ...monthly, endKind: "on_date", endDate: "2026-03-30" }, 2), null);
}

// ---- suggestions and customers
{
  const invoice = { issueDate: "2026-04-01", dueDate: "2026-05-01", totalCents: 50400, balanceCents: 50400, billToName: "Westside Yoga Collective" };
  const suggestions = suggestPaymentTransactions(invoice, [
    { _id: "exact", date: "2026-04-28", amountCents: 50400, description: "E-TRANSFER WESTSIDE YOGA" },
    { _id: "other", date: "2026-04-28", amountCents: 50400, description: "DEPOSIT" },
    { _id: "far", date: "2026-04-28", amountCents: 99900, description: "DEPOSIT" },
    { _id: "out", date: "2026-04-28", amountCents: -50400, description: "WESTSIDE" },
    { _id: "before", date: "2026-02-01", amountCents: 50400, description: "WESTSIDE" },
  ]);
  assert.deepEqual(suggestions.map((s) => s._id), ["exact", "other"]);
  const customers = summarizeCustomers([
    { partyKind: "organization", counterpartyId: "c1", billToName: "A", status: "overdue", totalCents: 100, balanceCents: 100, issueDate: "2026-01-01" },
    { partyKind: "organization", counterpartyId: "c1", billToName: "A", status: "paid", totalCents: 50, balanceCents: 0, issueDate: "2026-02-01" },
    { partyKind: "custom", billToName: "B", status: "draft", totalCents: 999, balanceCents: 999, issueDate: "2026-02-01" },
  ]);
  assert.equal(customers.length, 1);
  assert.deepEqual([customers[0].invoiceCount, customers[0].billedCents, customers[0].outstandingCents, customers[0].overdueCents], [2, 150, 100, 100]);
}

// ---- portable handlers on the demo seed
const { tables, society } = await import("../src/lib/staticConvexFixtures");
const { MemoryDb } = await import("../shared/portable/memoryDb");
const { makeCapabilities } = await import("../shared/portable/capabilities");
const inv = await import("../shared/functions/invoices");
const { invoiceDemoAnchor } = await import("../src/lib/staticInvoiceFixtures");

const seed: Record<string, any[]> = {};
for (const [k, v] of Object.entries(tables as Record<string, any[]>)) seed[k] = JSON.parse(JSON.stringify(v));
seed.users = seed.users.map((u: any) => ({ ...u, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${u._id}` }));
seed.societies = [JSON.parse(JSON.stringify(society)), { _id: "other_society", name: "Elsewhere Ltd", entityType: "corporation" }];
seed.invoices = [...seed.invoices, { ...seed.invoices[0], _id: "foreign_invoice", societyId: "other_society" }];
const db = new MemoryDb({ seed });
const S = seed.users[0].societyId;
const ctx: any = {
  db,
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${seed.users[0]._id}`, issuer: "https://issuer.test", userId: seed.users[0]._id, societyId: S },
  capabilities: makeCapabilities({}),
  runQuery: async () => { throw new Error("nested"); },
};

let ws: any = await inv.workspacePortable(ctx, { societyId: S });
const today = ws.today;
assert.ok(today >= invoiceDemoAnchor(), "the demo anchor is never after today");
const count = (status: string) => ws.invoices.filter((row: any) => row.status === status).length;
assert.equal(ws.invoices.length, 25);
assert.equal(count("overdue"), 2, "two overdue invoices");
assert.equal(count("partially_paid"), 2, "two partially paid");
assert.equal(count("void"), 1);
assert.ok(count("draft") >= 3 && count("paid") >= 10 && count("sent") >= 2);
assert.ok(ws.invoices.every((row: any) => row.societyId === S), "never returns another workspace's invoices");
assert.equal(ws.series.length, 1);
assert.equal(ws.catalog.length, 9);
assert.equal(ws.settings.nextNumberPreview, "RCS-0026");
assert.equal(ws.summary.overdueCount, 2);
assert.equal(ws.duesCandidates.length, 4);
assert.equal(ws.organization.gstNumber, "81234 5678 RT0001");

// partial payment linked to a suggested bank line, then the rest
const yogaOverdue = ws.invoices.find((row: any) => row._id === "static_invoice_yoga_4");
assert.equal(yogaOverdue.status, "overdue");
const suggestion = suggestPaymentTransactions(yogaOverdue, ws.transactions.filter((t: any) => !t.linkedInvoiceId))[0];
assert.equal(suggestion._id, "static_tx_invoice_yoga");
await inv.recordPaymentPortable(ctx, { id: yogaOverdue._id, date: today, amountCents: 20000, method: "e_transfer", financialTransactionId: suggestion._id });
await assert.rejects(() => inv.recordPaymentPortable(ctx, { id: "static_invoice_dues_noor", date: today, amountCents: 100, method: "e_transfer", financialTransactionId: suggestion._id }), /already linked/);
await assert.rejects(() => inv.recordPaymentPortable(ctx, { id: yogaOverdue._id, date: today, amountCents: 99999, method: "cash" }), /balance/);
await inv.recordPaymentPortable(ctx, { id: yogaOverdue._id, date: today, amountCents: 30400, method: "cash" });
ws = await inv.workspacePortable(ctx, { societyId: S });
let row = ws.invoices.find((r: any) => r._id === yogaOverdue._id);
assert.equal(row.status, "paid");
assert.equal(row.payments[0].transaction._id, "static_tx_invoice_yoga", "payment carries its bank line");
assert.equal(ws.transactions.find((t: any) => t._id === "static_tx_invoice_yoga").linkedInvoiceNumber, row.number, "bank line links back to the invoice");
// void is refused while payments exist; revert, then void and restore
let result: any = await inv.voidInvoicesPortable(ctx, { societyId: S, ids: [row._id] });
assert.deepEqual(result, { voided: 0, skippedPaid: 1, skipped: 0, reversed: 0 });
await inv.revertToUnpaidPortable(ctx, { id: row._id });
result = await inv.voidInvoicesPortable(ctx, { societyId: S, ids: [row._id], reason: "Issued twice" });
assert.equal(result.voided, 1);
await inv.restoreVoidedPortable(ctx, { id: row._id });
ws = await inv.workspacePortable(ctx, { societyId: S });
assert.equal(ws.invoices.find((r: any) => r._id === row._id).status, "overdue");
// tenancy: a foreign id in a batch stops it before any write, and is not echoed
await assert.rejects(() => inv.markSentPortable(ctx, { societyId: S, ids: ["static_invoice_dues_liam", "foreign_invoice"] }), (error: any) => !String(error.message).includes("foreign_invoice"));
assert.equal((await db.get("static_invoice_dues_liam")).status, "draft");
await assert.rejects(() => inv.recordPaymentPortable(ctx, { id: "foreign_invoice", date: today, amountCents: 100, method: "cash" }));

// create, number, mark sent with an Outbox email, duplicate
const id = await inv.upsertPortable(ctx, { societyId: S, partyKind: "custom", billToName: "Test Party", billToEmail: "party@example.org", issueDate: today, terms: "net_15", lines: [{ item: "Hall", quantity: 1, unitPriceCents: 45000, taxRatePercent: 5, taxLabel: "GST" }] });
let created = await db.get(id);
assert.equal(created.number, "RCS-0026");
assert.equal(created.totalCents, 47250);
const outboxBefore = (await db.query("pendingEmails").collect()).length;
result = await inv.markSentPortable(ctx, { societyId: S, ids: [id], draftEmail: true });
assert.deepEqual(result, { sent: 1, emailed: 1, skipped: 0, posted: 1 });
assert.equal((await db.query("pendingEmails").collect()).length, outboxBefore + 1);
const dup = await inv.duplicatePortable(ctx, { id });
assert.equal((await db.get(dup)).number, "RCS-0027");
assert.equal((await db.get(dup)).status, "draft");
await inv.removePortable(ctx, { id: dup });
await assert.rejects(() => inv.removePortable(ctx, { id }), /drafts/);
// reminders: open invoices with an email only
result = await inv.sendRemindersPortable(ctx, { societyId: S, ids: ["static_invoice_dues_grace", "static_invoice_dues_liam", "static_invoice_dues_mina"] });
assert.deepEqual(result, { created: 1, skippedNoEmail: 0, skippedNotOpen: 2 });

// dues: generate for this month's renewals, refuse duplicates, undo gives numbers back
const settingsBefore = (await inv.workspacePortable(ctx, { societyId: S })).settings.nextNumber;
const gen = await inv.generateDuesInvoicesPortable(ctx, { societyId: S, subscriptionIds: ws.duesCandidates.map((c: any) => c.subscriptionId) });
assert.equal(gen.created, 4);
ws = await inv.workspacePortable(ctx, { societyId: S });
assert.ok(ws.duesCandidates.every((c: any) => c.existingInvoiceNumber), "candidates now show their invoice");
const student = ws.invoices.find((r: any) => r.duesBatch === gen.batch && r.billToName === "Fatima Hussain");
assert.equal(student.totalCents, 500, "student fee tier");
assert.equal(student.partyKind, "member");
assert.equal((await inv.generateDuesInvoicesPortable(ctx, { societyId: S, subscriptionIds: [student.subscriptionId] })).skipped, 1);
const undone = await inv.undoDuesBatchPortable(ctx, { societyId: S, batch: gen.batch });
assert.deepEqual(undone, { removed: 4, kept: 0 });
assert.equal((await inv.workspacePortable(ctx, { societyId: S })).settings.nextNumber, settingsBefore);
// bill one member from their fee tier
const billed = await db.get(await inv.billMemberDuesPortable(ctx, { societyId: S, memberId: "static_member_wei" }));
assert.equal(billed.totalCents, 500);
assert.equal(billed.source, "dues");

// series: issue the next invoice and advance the schedule
const series = ws.series[0];
const issued = await db.get(await inv.issueFromSeriesPortable(ctx, { id: series._id }));
assert.equal(issued.issueDate, series.nextIssueDate);
assert.equal(issued.seriesId, series._id);
const advanced = await db.get(series._id);
assert.equal(advanced.issuedCount, 7);
assert.equal(advanced.nextIssueDate, seriesOccurrenceDate(series, 7));
// settings: the next number can't go backwards
await assert.rejects(() => inv.saveSettingsPortable(ctx, { societyId: S, prefix: "RCS-", nextNumber: 3, defaultTerms: "net_30" }), /above/);

console.log("Invoice checks passed: totals, tax, status, terms, numbering, recurrence and handlers.");
