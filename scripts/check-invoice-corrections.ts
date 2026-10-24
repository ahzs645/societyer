import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableDoc, PortableMutationCtx } from "../shared/portable/ctx";
import { tables, society } from "../src/lib/staticConvexFixtures";
import { entryCountsForBasis, type AccountingBasis } from "../shared/booksReports";
import { historicalSettlements } from "../shared/commerceReportSources";
import * as invoices from "../shared/functions/invoices";
import * as accounting from "../shared/functions/accounting";
import { invoiceCashActivity, invoiceCurrencySummary, type InvoicePayment } from "../shared/invoicing";

const D = "2026-03-02", R = "2026-04-04";
async function fixture() {
  const seed: Record<string, PortableDoc[]> = JSON.parse(JSON.stringify(tables));
  seed.users = seed.users.map(user => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
  seed.societies = [JSON.parse(JSON.stringify(society))];
  for (const table of ["invoices", "invoiceCatalogItems", "invoiceSettings", "invoiceSeries", "invoiceTemplates", "invoicePriceLists", "repairJobs", "financialAccounts", "financialTransactions", "journalEntries", "journalLines", "accountingFiscalPeriods", "booksSettings", "repairOperations", "bankAccountProfiles"]) seed[table] = [];
  const owner = seed.users.find(user => user.role === "Owner")!, societyId = String(owner.societyId), db = new MemoryDb({ seed });
  const ctx: PortableMutationCtx = { db, principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${owner._id}`, issuer: "https://issuer.test", userId: owner._id, societyId }, capabilities: makeCapabilities({}) } as PortableMutationCtx;
  const account = (name: string, accountType: string, subtype?: string) => db.insert("financialAccounts", { societyId, name, accountType, ...(subtype ? { subtype } : {}), currency: "CAD" });
  const AR = await account("Accounts receivable", "Asset", "receivable"), CASH = await account("Cash", "Asset", "cash"), REVENUE = await account("Invoice revenue", "Income"), BANK_INCOME = await account("Original bank income", "Income");
  await invoices.saveAccountMappingPortable(ctx, { societyId, receivableAccountId: AR, depositAccountId: CASH, defaultRevenueAccountId: REVENUE });
  const oldPeriod = await db.insert("accountingFiscalPeriods", { societyId, startDate: "2026-03-01", endDate: "2026-03-31", periodLabel: "Original fiscal year", fiscalYear: "2025/26", status: "open" });
  await db.insert("accountingFiscalPeriods", { societyId, startDate: "2026-04-01", endDate: "2027-03-31", periodLabel: "Correction fiscal year", fiscalYear: "2026/27", status: "open" });
  const get = async (id: string) => (await db.get(id))!;
  const linesOf = (id: string) => db.query("journalLines").withIndex("by_entry", q => q.eq("journalEntryId", id)).collect();
  const createInvoice = async (name = "Dated correction customer") => {
    const id = await invoices.upsertPortable(ctx, { societyId, partyKind: "custom", billToName: name, issueDate: "2026-03-01", terms: "net_30", currency: "CAD", lines: [{ key: "service", item: "Service", quantity: 1, unitPriceCents: 1000 }] });
    await invoices.markSentPortable(ctx, { societyId, ids: [id] });
    return id;
  };
  const createBank = (externalId: string) => db.insert("financialTransactions", { societyId, connectionId: seed.financialConnections[0]._id, accountId: CASH, externalId, date: D, description: "Original customer bank deposit", amountCents: 1000, accountingAccountId: BANK_INCOME, category: "Original bank income", categorizedBy: "rule", ruleId: "static_rule_janitorial", ruleApplication: { ruleName: "Original", previous: { category: "Uncategorized" } } });
  const lockOriginal = async () => {
    const lock = await db.insert("booksSettings", { societyId, closeDate: D, createdAtISO: `${R}T00:00:00Z`, updatedAtISO: `${R}T00:00:00Z` });
    await db.patch(oldPeriod, { status: "closed" });
    return lock;
  };
  const snapshot = async () => JSON.stringify(await Promise.all(["invoices", "financialTransactions", "journalEntries", "journalLines", "financialAccounts"].map(table => db.query(table).collect())));
  const rejectsUnchanged = async (action: () => Promise<unknown>, error: RegExp) => { const before = await snapshot(); await assert.rejects(action, error); assert.equal(await snapshot(), before, "refused correction leaves all money and bank records unchanged"); };
  const book = async (invoiceId: string, bankId: string | undefined, basis: AccountingBasis, asOf: string) => {
    const allLines = await db.query("journalLines").collect();
    const bankEntries = new Set(allLines.filter(line => bankId && line.financialTransactionId === bankId).map(line => line.journalEntryId));
    const entryIds = new Set((await db.query("journalEntries").collect()).filter(entry => entry.status === "posted" && entry.date <= asOf && entryCountsForBasis(entry, basis) && (String(entry.sourceExternalId ?? "").startsWith(`invoice:${invoiceId}`) || bankEntries.has(entry._id))).map(entry => entry._id));
    const balance = (accountId: string) => allLines.filter(line => entryIds.has(line.journalEntryId) && line.accountId === accountId).reduce((sum, line) => sum + (line.side === "debit" ? line.amountCents : -line.amountCents), 0) || 0;
    return { ar: balance(AR), cash: balance(CASH), revenue: -balance(REVENUE) || 0, bankIncome: -balance(BANK_INCOME) || 0 };
  };
  return { db, ctx, societyId, AR, CASH, REVENUE, BANK_INCOME, oldPeriod, get, linesOf, createInvoice, createBank, lockOriginal, rejectsUnchanged, snapshot, book };
}

// A refund cannot precede the actual receipt or create cash history before it existed.
{
  const f = await fixture(), id = await f.createInvoice(), key = await invoices.recordPaymentPortable(f.ctx, { id, date: D, amountCents: 1000, method: "cash", depositAccountId: f.CASH });
  await f.rejectsUnchanged(() => invoices.recordAdjustmentPortable(f.ctx, { id, kind: "refund", date: "2026-03-01", amountCents: 100, note: "Pre-receipt refund must fail", sourcePaymentKey: key, depositAccountId: f.CASH, idempotencyKey: "early-refund" }), /on or after the original cash payment/);
  assert.equal(historicalSettlements((await f.get(id)).payments, "2026-03-01"), 0);
  assert.equal(historicalSettlements((await f.get(id)).payments, D), 1000);
}

// Close the original fiscal period and books. Reversing an ordinary receipt in
// the open year retains its exact journal/lines and posts only dated mirrors.
{
  const f = await fixture(), id = await f.createInvoice(), key = await invoices.recordPaymentPortable(f.ctx, { id, date: D, amountCents: 1000, method: "cash", depositAccountId: f.CASH });
  const payment = (await f.get(id)).payments[0], original = JSON.stringify(await f.get(payment.journalEntryId)), originalLines = JSON.stringify(await f.linesOf(payment.journalEntryId));
  await f.lockOriginal();
  await f.rejectsUnchanged(() => invoices.removePaymentPortable(f.ctx, { id, paymentKey: key, date: D, reason: "Closed correction must fail" }), /closed/i);
  await invoices.removePaymentPortable(f.ctx, { id, paymentKey: key, date: R, reason: "Correct the receipt in the open year" });
  const retained = (await f.get(id)).payments[0];
  assert.equal(JSON.stringify(await f.get(payment.journalEntryId)), original);
  assert.equal(JSON.stringify(await f.linesOf(payment.journalEntryId)), originalLines);
  assert.equal((await f.get(payment.cashBasisEntryId)).status, "posted");
  assert.equal((await f.get(f.oldPeriod)).status, "closed");
  assert.equal((await f.get(retained.reversalJournalEntryId)).date, R);
  assert.notEqual((await f.get(retained.reversalJournalEntryId)).fiscalPeriodId, f.oldPeriod);
  for (const basis of ["accrual", "cash"] as const) assert.deepEqual(await f.book(id, undefined, basis, "2026-04-03"), { ar: 0, cash: 1000, revenue: 1000, bankIncome: 0 });
  assert.deepEqual(await f.book(id, undefined, "accrual", R), { ar: 1000, cash: 0, revenue: 1000, bankIncome: 0 });
  assert.deepEqual(await f.book(id, undefined, "cash", R), { ar: 0, cash: 0, revenue: 0, bankIncome: 0 });
  assert.equal(historicalSettlements([retained], "2026-04-03"), 1000);
  assert.equal(historicalSettlements([retained], R), 0);
  const after = await f.snapshot();
  await invoices.removePaymentPortable(f.ctx, { id, paymentKey: key, date: R, reason: "Correct the receipt in the open year" });
  assert.equal(await f.snapshot(), after);
  await f.rejectsUnchanged(() => invoices.removePaymentPortable(f.ctx, { id, paymentKey: key, date: "2026-04-05", reason: "Changed retry" }), /already reversed/);
}

// A replaced imported deposit stays void at D. Its original accounting is
// restored at R, preserving dimensions and releasing the old receipt only for
// current matching. Re-linking at R preserves every earlier as-of cash balance.
{
  const f = await fixture(), id = await f.createInvoice(), bankId = await f.createBank("invoice-dated-restoration");
  const bankEntry = await f.db.insert("journalEntries", { societyId: f.societyId, date: D, source: accounting.TRANSACTION_BACKFILL_SOURCE, sourceExternalId: "invoice-dated-restoration", status: "posted", basis: "both" });
  const restoredTag = "static_tag_fall_gala", restoredProgram = "RESTORED";
  for (const [lineOrder, line] of [{ accountId: f.CASH, side: "debit", amountCents: 1000, financialTransactionId: bankId }, { accountId: f.BANK_INCOME, side: "credit", amountCents: 1000, tagIds: [restoredTag], programCode: restoredProgram }].entries()) await f.db.insert("journalLines", { societyId: f.societyId, journalEntryId: bankEntry, lineOrder, ...line });
  const key = await invoices.recordPaymentPortable(f.ctx, { id, date: D, amountCents: 1000, method: "e_transfer", financialTransactionId: bankId });
  const oldPayment = (await f.get(id)).payments[0], originalMain = JSON.stringify(await f.get(oldPayment.journalEntryId)), originalCash = JSON.stringify(await f.get(oldPayment.cashBasisEntryId));
  const otherInvoice = await f.createInvoice("Other old receipt"), otherKey = await invoices.recordPaymentPortable(f.ctx, { id: otherInvoice, date: D, amountCents: 1000, method: "cash", depositAccountId: f.CASH });
  const priorMatch = await f.get(bankId);
  await f.lockOriginal();
  await f.db.patch(bankId, { matchedKind: "manual", matchedId: "changed" });
  await f.rejectsUnchanged(() => invoices.removePaymentPortable(f.ctx, { id, paymentKey: key, date: R }), /bank match changed/);
  await f.db.patch(bankId, { matchedKind: priorMatch.matchedKind, matchedId: priorMatch.matchedId });
  await f.db.patch(bankEntry, { status: "posted" });
  await f.rejectsUnchanged(() => invoices.removePaymentPortable(f.ctx, { id, paymentKey: key, date: R }), /replaced bank journal changed/);
  await f.db.patch(bankEntry, { status: "void" });
  await invoices.removePaymentPortable(f.ctx, { id, paymentKey: key, date: R, reason: "Release original customer bank match" });
  const retained = (await f.get(id)).payments[0], restoration = await f.get(retained.restoredTransactionJournalEntryId);
  assert.deepEqual([restoration.source, restoration.date, restoration.status], [accounting.INVOICE_BANK_RESTORATION_SOURCE, R, "posted"]);
  assert.deepEqual([(await f.get(bankEntry)).status, (await f.get(bankEntry)).date], ["void", D]);
  assert.equal(JSON.stringify(await f.get(oldPayment.journalEntryId)), originalMain);
  assert.equal(JSON.stringify(await f.get(oldPayment.cashBasisEntryId)), originalCash);
  const dimension = (await f.linesOf(restoration._id)).find(line => line.accountId === f.BANK_INCOME)!;
  assert.deepEqual([dimension.tagIds, dimension.programCode], [[restoredTag], restoredProgram]);
  assert.deepEqual((await f.get(bankId)).invoicePaymentRelease, { date: R, journalEntryIds: [oldPayment.journalEntryId] });
  assert.equal((await f.get(bankId)).date, D);
  assert.deepEqual((await accounting.postedJournalForTransaction(f.ctx, bankId)).entries.map(entry => entry._id), [restoration._id]);
  assert.equal(await accounting.createTransactionJournalSync(f.ctx, f.societyId)(bankId), "external");
  for (const basis of ["accrual", "cash"] as const) assert.deepEqual(await f.book(id, bankId, basis, "2026-04-03"), { ar: 0, cash: 1000, revenue: 1000, bankIncome: 0 });
  assert.deepEqual(await f.book(id, bankId, "accrual", R), { ar: 1000, cash: 1000, revenue: 1000, bankIncome: 1000 });
  assert.deepEqual(await f.book(id, bankId, "cash", R), { ar: 0, cash: 1000, revenue: 0, bankIncome: 1000 });
  await f.rejectsUnchanged(() => invoices.recordPaymentPortable(f.ctx, { id, date: "2026-04-03", amountCents: 1000, method: "cash", financialTransactionId: bankId }), /overlaps earlier settled amounts|on or after its previous reversal/);
  await f.rejectsUnchanged(() => invoices.linkDepositPortable(f.ctx, { id: otherInvoice, paymentKey: otherKey, financialTransactionId: bankId }), /on or after.*(previous reversal|current posting date)/);
  await invoices.recordPaymentPortable(f.ctx, { id, date: R, amountCents: 1000, method: "e_transfer", financialTransactionId: bankId });
  assert.equal((await f.get(restoration._id)).status, "void");
  assert.equal((await f.get(id)).payments.length, 2, "a retained reversed receipt does not block a new legitimate receipt using the same bank deposit");
  for (const basis of ["accrual", "cash"] as const) {
    assert.deepEqual(await f.book(id, bankId, basis, "2026-04-03"), { ar: 0, cash: 1000, revenue: 1000, bankIncome: 0 });
    assert.deepEqual(await f.book(id, bankId, basis, R), { ar: 0, cash: 1000, revenue: 1000, bankIncome: 0 });
  }
}

// A released bank transaction without a prior import journal can later be
// backfilled at R while D remains closed, without changing its bank-statement date.
{
  const f = await fixture(), id = await f.createInvoice(), bankId = await f.createBank("invoice-new-dated-backfill"), key = await invoices.recordPaymentPortable(f.ctx, { id, date: D, amountCents: 1000, method: "e_transfer", financialTransactionId: bankId });
  await f.lockOriginal();
  await invoices.removePaymentPortable(f.ctx, { id, paymentKey: key, date: R });
  assert.equal((await accounting.postedJournalForTransaction(f.ctx, bankId)).entries.length, 0);
  assert.equal((await accounting.backfillFinancialTransactionsToJournalPortable(f.ctx, { societyId: f.societyId, transactionIds: [bankId], includeBeforeOpening: true })).posted, 1);
  const [entry] = (await accounting.postedJournalForTransaction(f.ctx, bankId)).entries;
  assert.deepEqual([entry.source, entry.date], [accounting.INVOICE_BANK_RESTORATION_SOURCE, R]);
  assert.equal(JSON.parse(entry.rawJson).originalTransactionDate, D);
  assert.equal((await f.get(bankId)).date, D);
  assert.equal((await accounting.backfillFinancialTransactionsToJournalPortable(f.ctx, { societyId: f.societyId, transactionIds: [bankId], includeBeforeOpening: true })).posted, 0);
  for (const basis of ["accrual", "cash"] as const) assert.deepEqual(await f.book(id, bankId, basis, "2026-04-03"), { ar: 0, cash: 1000, revenue: 1000, bankIncome: 0 });
  assert.deepEqual(await f.book(id, bankId, "cash", R), { ar: 0, cash: 1000, revenue: 0, bankIncome: 1000 });
}

// Re-linking on a later date must retain cash throughout the intervening
// released-bank period, even after that earlier month has been closed.
{
  const f = await fixture(), id = await f.createInvoice(), bankId = await f.createBank("invoice-delayed-relink"), key = await invoices.recordPaymentPortable(f.ctx, { id, date: D, amountCents: 1000, method: "e_transfer", financialTransactionId: bankId });
  const books = await f.lockOriginal();
  await invoices.removePaymentPortable(f.ctx, { id, paymentKey: key, date: R });
  await accounting.backfillFinancialTransactionsToJournalPortable(f.ctx, { societyId: f.societyId, transactionIds: [bankId], includeBeforeOpening: true });
  const [bankPosting] = (await accounting.postedJournalForTransaction(f.ctx, bankId)).entries;
  const originalBank = JSON.stringify(await f.get(bankPosting._id));
  await f.db.patch(bankPosting.fiscalPeriodId, { endDate: "2026-04-30", status: "closed" });
  const may = await f.db.insert("accountingFiscalPeriods", { societyId: f.societyId, startDate: "2026-05-01", endDate: "2026-05-31", periodLabel: "May", status: "open" });
  await f.db.insert("accountingFiscalPeriods", { societyId: f.societyId, startDate: "2026-06-01", endDate: "2027-03-31", periodLabel: "Later corrections", status: "open" });
  await f.db.patch(books, { closeDate: "2026-04-30" });
  const P = "2026-05-05", LATER_R = "2026-06-06";
  const laterKey = await invoices.recordPaymentPortable(f.ctx, { id, date: P, amountCents: 1000, method: "e_transfer", financialTransactionId: bankId });
  const laterPayment = (await f.get(id)).payments.find((payment: any) => payment.key === laterKey);
  assert.equal(laterPayment.replacedTransactionEntryId, bankPosting._id);
  assert.deepEqual([(await f.get(laterPayment.bankTransferJournalEntryId)).source, (await f.get(laterPayment.bankTransferJournalEntryId)).date], ["invoice_bank_transfer", P]);
  assert.equal(JSON.stringify(await f.get(bankPosting._id)), originalBank, "the closed earlier bank posting remains byte-for-byte unchanged");
  assert.deepEqual(await f.book(id, bankId, "accrual", "2026-04-30"), { ar: 1000, cash: 1000, revenue: 1000, bankIncome: 1000 });
  assert.deepEqual(await f.book(id, bankId, "cash", "2026-04-30"), { ar: 0, cash: 1000, revenue: 0, bankIncome: 1000 });
  for (const basis of ["accrual", "cash"] as const) assert.deepEqual(await f.book(id, bankId, basis, P), { ar: 0, cash: 1000, revenue: 1000, bankIncome: 0 });
  await f.db.patch(may, { status: "closed" });
  await f.db.patch(books, { closeDate: "2026-05-31" });
  await invoices.removePaymentPortable(f.ctx, { id, paymentKey: laterKey, date: LATER_R, reason: "Correct the later bank relink in June" });
  const corrected = (await f.get(id)).payments.find((payment: any) => payment.key === laterKey);
  assert.equal((await f.get(laterPayment.bankTransferJournalEntryId)).status, "posted");
  assert.equal((await f.get(corrected.restoredTransactionJournalEntryId)).date, LATER_R);
  assert.equal((await f.get(bankPosting._id)).status, "posted");
  assert.deepEqual(await f.book(id, bankId, "cash", "2026-04-30"), { ar: 0, cash: 1000, revenue: 0, bankIncome: 1000 });
  for (const basis of ["accrual", "cash"] as const) assert.deepEqual(await f.book(id, bankId, basis, "2026-05-31"), { ar: 0, cash: 1000, revenue: 1000, bankIncome: 0 });
  assert.deepEqual(await f.book(id, bankId, "accrual", LATER_R), { ar: 1000, cash: 1000, revenue: 1000, bankIncome: 1000 });
  assert.deepEqual(await f.book(id, bankId, "cash", LATER_R), { ar: 0, cash: 1000, revenue: 0, bankIncome: 1000 });
  assert.deepEqual((await accounting.postedJournalForTransaction(f.ctx, bankId)).entries.map(entry => entry._id), [corrected.restoredTransactionJournalEntryId]);
}

const cashHistory: InvoicePayment[] = [
  { key: "receipt", date: "2026-03-02", amountCents: 10000, method: "cash", reversedDate: "2026-04-04" },
  { key: "refund", kind: "refund", date: "2026-03-03", amountCents: -2000, method: "cash", reversedDate: "2026-04-04" },
  { key: "credit", kind: "credit", date: "2026-04-04", amountCents: 5000, method: "other" },
  { key: "writeoff", kind: "write_off", date: "2026-04-04", amountCents: 3000, method: "other" },
];
assert.deepEqual(invoiceCashActivity(cashHistory, "2026-03-01", "2026-03-31"), { amountCents: 8000, hasActivity: true }, "later corrections preserve original receipt and refund activity");
assert.deepEqual(invoiceCashActivity(cashHistory, "2026-04-01", "2026-04-30"), { amountCents: -8000, hasActivity: true }, "correction period includes signed reversals and excludes noncash settlements");
const cashRows = [{ currency: "CAD", status: "void" as const, balanceCents: 0, totalCents: 10000, payments: cashHistory }];
assert.equal(invoiceCurrencySummary(cashRows, "CAD", "2026-04-04").paidLast30Cents, -8000, "voiding a corrected invoice preserves the cash correction in the displayed window");
assert.equal(invoiceCurrencySummary(cashRows, "USD", "2026-04-04").paidLast30Cents, 0, "cash activity stays in its document currency");

console.log("Invoice correction checks passed: refund chronology, closed original/open correction periods, immutable cash/accrual as-of history, dated bank restoration, dimensions, active-only relinking, backfill dates, retries, signed list cash metrics and no partial writes.");
