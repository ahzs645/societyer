import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableDoc, PortableMutationCtx } from "../shared/portable/ctx";
import { tables, society } from "../src/lib/staticConvexFixtures";
import { addDays, approvalPostingLines, billPaidCents, billPaidCentsAsOf, cashBasisShares, recognizedCashShares, summarizeBills, type BillLine } from "../shared/bills";
import { entryCountsForBasis, type AccountingBasis } from "../shared/booksReports";
import * as bills from "../shared/functions/bills";
import * as accounting from "../shared/functions/accounting";

const seed: Record<string, PortableDoc[]> = JSON.parse(JSON.stringify(tables));
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
seed.societies = [JSON.parse(JSON.stringify(society)), { _id: "foreign_bill_workspace", name: "Elsewhere", currency: "CAD" }];
const owner = seed.users.find((user) => user.role === "Owner")!, workspaceId = String(owner.societyId);
const db = new MemoryDb({ seed });
const ctx: PortableMutationCtx = { db, principal: { kind: "user", runtime: "test", assurance: "verified-jwt", subject: `sub-${owner._id}`, issuer: "https://issuer.test", userId: owner._id, societyId: workspaceId }, capabilities: makeCapabilities({}), runQuery: async () => { throw new Error("Unexpected nested query"); }, runMutation: async () => { throw new Error("Unexpected nested mutation"); } };
const AP = "static_financial_ap", CASH = "static_financial_cash", EXPENSE_A = "static_financial_facilities_expense", EXPENSE_B = "static_financial_utilities_expense";
const get = async (id: string) => (await db.get(id))!;
const ofBill = (entry: PortableDoc, id: string) => entry.sourceExternalId === `bill:${id}` || String(entry.sourceExternalId ?? "").startsWith(`bill:${id}:`);
const entries = async (id: string) => (await db.query("journalEntries").collect()).filter((entry) => ofBill(entry, id));
const linesOf = async (id: string) => db.query("journalLines").withIndex("by_entry", (q) => q.eq("journalEntryId", id)).collect();
const book = async (id: string, basis: AccountingBasis, date = "2999-12-31") => {
  const posted = new Set((await entries(id)).filter((entry) => entry.status === "posted" && entry.date <= date && entryCountsForBasis(entry as any, basis)).map((entry) => entry._id));
  const lines = (await db.query("journalLines").collect()).filter((line) => posted.has(line.journalEntryId));
  const balance = (accountId: string) => lines.filter((line) => line.accountId === accountId).reduce((sum, line) => sum + (line.side === "credit" ? line.amountCents : -line.amountCents), 0);
  return { ap: balance(AP), cashPaid: balance(CASH), expense: -(balance(EXPENSE_A) + balance(EXPENSE_B)) || 0 };
};
const snapshot = async () => JSON.stringify({ bills: await db.query("bills").collect(), entries: await db.query("journalEntries").collect(), lines: await db.query("journalLines").collect(), accounts: await db.query("financialAccounts").collect(), transactions: await db.query("financialTransactions").collect() });
const rejectsUnchanged = async (action: () => Promise<unknown>, message: RegExp) => {
  const before = await snapshot(); await assert.rejects(action, message); assert.equal(await snapshot(), before, "refused operation does not partially write any accounting rows");
};
const createBill = async (amounts = [10001, 3333], billDate = "2026-08-01") => {
  const lines: BillLine[] = amounts.map((amountCents, index) => ({ key: `line-${index}`, accountId: index ? EXPENSE_B : EXPENSE_A, amountCents, ...(index ? { tagIds: ["static_tag_fall_gala"] } : {}) }));
  const at = `${billDate}T12:00:00Z`, total = amounts.reduce((a, b) => a + b, 0);
  const id = await db.insert("bills", { societyId: workspaceId, vendorId: seed.accountingCounterparties.find((row) => row.kind === "vendor")!._id, vendorName: "Adjustment test vendor", billNumber: "ADJ-TEST", billDate, dueDate: "2026-08-31", terms: "net_30", currency: "CAD", lines, status: "approved", totalCents: total, paidCents: 0, payments: [], approvals: [], timeline: [], createdAtISO: at, updatedAtISO: at });
  const journalEntryId = await db.insert("journalEntries", { societyId: workspaceId, date: billDate, source: "bill", sourceExternalId: `bill:${id}`, status: "posted", basis: "accrual-only", memo: "Approved test bill", createdAtISO: at, updatedAtISO: at });
  for (const [lineOrder, line] of approvalPostingLines({ lines }, AP).entries()) await db.insert("journalLines", { societyId: workspaceId, journalEntryId, lineOrder, ...line, createdAtISO: at, updatedAtISO: at });
  await db.patch(id, { journalEntryId });
  return id;
};

// Pure as-of and cash-flow summaries retain dated reversals and exclude noncash settlements.
const history = [{ date: "2026-08-01", amountCents: 1000, kind: "credit" as const, reversedDate: "2026-09-05" }, { date: "2026-08-02", amountCents: 5000 }, { date: "2026-09-02", amountCents: -1000, kind: "refund" as const, reversedDate: "2026-09-03" }];
assert.equal(billPaidCentsAsOf(history, "2026-08-31"), 6000);
assert.equal(billPaidCentsAsOf(history, "2026-09-02"), 5000);
assert.equal(billPaidCentsAsOf(history, "2026-09-04"), 6000);
assert.equal(billPaidCentsAsOf(history, "2026-09-05"), 5000);
assert.equal(billPaidCents(history), 5000);
assert.equal(summarizeBills([{ status: "open", dueDate: "2026-10-01", totalCents: 10000, balanceCents: 5000, payments: history }], "2026-09-04").paidLast30Cents, 0, "credit and its reversal are not cash paid; refunded then reversed cash nets to zero");

assert.equal(summarizeBills([{ status: "canceled", dueDate: "2026-08-01", totalCents: 5000, balanceCents: 0, payments: [{ date: "2026-08-01", amountCents: 5000, reversedDate: "2026-09-04" }] }], "2026-09-04").paidLast30Cents, -5000, "canceling a corrected bill does not erase a cash reversal inside the selected window");

const billId = await createBill();
const creditArgs = { id: billId, kind: "credit" as const, date: "2026-08-10", amountCents: 2000, reason: "Vendor credit note", idempotencyKey: "credit-one", adjustmentAccountId: EXPENSE_A, reference: "CN-101" };
const credit = await bills.recordAdjustmentPortable(ctx, creditArgs);
assert.equal(await bills.recordAdjustmentPortable(ctx, creditArgs), credit);
assert.equal((await entries(billId)).filter((entry) => entry.source === "bill_adjustment").length, 1);
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...creditArgs, reference: "CN-102" }), /different details/);
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...creditArgs, idempotencyKey: "x".repeat(101) }), /at most 100/);
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...creditArgs, idempotencyKey: "over", amountCents: 11335 }), /open balance/);
assert.deepEqual(await book(billId, "accrual"), { ap: 11334, cashPaid: 0, expense: 11334 });
assert.deepEqual(await book(billId, "cash"), { ap: 0, cashPaid: 0, expense: 0 });

const writeOff = await bills.recordAdjustmentPortable(ctx, { ...creditArgs, kind: "write_off", date: "2026-08-11", amountCents: 334, idempotencyKey: "write-off", reference: undefined, reason: "Vendor agreed small-balance settlement" });
assert.deepEqual(await book(billId, "accrual"), { ap: 11000, cashPaid: 0, expense: 11000 });
const paid = await bills.recordPaymentPortable(ctx, { id: billId, date: "2026-08-12", amountCents: 5000, method: "eft", cashAccountId: CASH });
assert.deepEqual(await book(billId, "accrual"), { ap: 6000, cashPaid: 5000, expense: 11000 });
assert.deepEqual(await book(billId, "cash"), { ap: 0, cashPaid: 5000, expense: 5000 });
const refundArgs = { id: billId, kind: "refund" as const, date: "2026-08-13", amountCents: 1500, reason: "Returned advance payment", idempotencyKey: "refund-one", sourcePaymentKey: paid.key, cashAccountId: CASH };
const refund = await bills.recordAdjustmentPortable(ctx, refundArgs);
assert.equal(await bills.recordAdjustmentPortable(ctx, refundArgs), refund);
assert.deepEqual(await book(billId, "accrual"), { ap: 7500, cashPaid: 3500, expense: 11000 });
assert.deepEqual(await book(billId, "cash"), { ap: 0, cashPaid: 3500, expense: 3500 });
const refundPayment = (await get(billId)).payments.find((payment: any) => payment.key === refund);
assert.equal((await get(refundPayment.journalEntryId)).basis, "both");
assert.equal((await get(refundPayment.cashBasisJournalEntryId)).basis, "cash-only");
assert.ok((await linesOf(refundPayment.cashBasisJournalEntryId)).some((line) => line.tagIds?.includes("static_tag_fall_gala")), "refund reverses original cash expense dimensions");
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...refundArgs, idempotencyKey: "too-much-refund", amountCents: 3501 }), /remaining amount/);
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...refundArgs, idempotencyKey: "too-early-refund", date: "2026-08-11" }), /on or before/);
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { id: billId, paymentKey: paid.key }), /linked refund/);

// Close the original period: a later dated reversal preserves the historical original.
const books = await db.insert("booksSettings", { societyId: workspaceId, closeDate: "2026-08-13", createdAtISO: "2026-08-14T00:00:00Z", updatedAtISO: "2026-08-14T00:00:00Z" });
await rejectsUnchanged(() => bills.reverseAdjustmentPortable(ctx, { id: billId, paymentKey: refund, date: "2026-08-13", reason: "Correct return" }), /closed/i);
await bills.reverseAdjustmentPortable(ctx, { id: billId, paymentKey: refund, date: "2026-08-14", reason: "Refund recorded in error" });
assert.equal(await bills.reverseAdjustmentPortable(ctx, { id: billId, paymentKey: refund, date: "2026-08-14", reason: "Refund recorded in error" }), refund);
await rejectsUnchanged(() => bills.reverseAdjustmentPortable(ctx, { id: billId, paymentKey: refund, date: "2026-08-15", reason: "Retry with different date" }), /already reversed/);
assert.equal((await get(refundPayment.journalEntryId)).status, "posted");
assert.equal((await get(refundPayment.cashBasisJournalEntryId)).status, "posted");
assert.deepEqual(await book(billId, "cash", "2026-08-13"), { ap: 0, cashPaid: 3500, expense: 3500 });
assert.deepEqual(await book(billId, "cash", "2026-08-14"), { ap: 0, cashPaid: 5000, expense: 5000 });
assert.equal(billPaidCentsAsOf((await get(billId)).payments, "2026-08-13"), 5834);
assert.equal(billPaidCentsAsOf((await get(billId)).payments, "2026-08-14"), 7334);
await bills.reverseAdjustmentPortable(ctx, { id: billId, paymentKey: writeOff, date: "2026-08-15", reason: "Reopen settlement" });
await bills.reverseAdjustmentPortable(ctx, { id: billId, paymentKey: credit, date: "2026-08-16", reason: "Credit note canceled" });
assert.deepEqual(await book(billId, "accrual"), { ap: 8334, cashPaid: 5000, expense: 13334 });
await db.delete(books);

// Legacy cash allocations use payment order, including cent-rounding remainders.
const roundingBill = await createBill([3, 1]);
await bills.recordPaymentPortable(ctx, { id: roundingBill, date: "2026-08-02", amountCents: 1, method: "cash", cashAccountId: CASH });
const second = await bills.recordPaymentPortable(ctx, { id: roundingBill, date: "2026-08-03", amountCents: 2, method: "cash", cashAccountId: CASH });
const rounding = await get(roundingBill), expectedShares = rounding.payments[1].cashBasisShares;
assert.deepEqual(expectedShares, [{ key: "line-0", amountCents: 1 }, { key: "line-1", amountCents: 1 }]);
await db.patch(roundingBill, { payments: rounding.payments.map((payment: any) => payment.key === second.key ? { ...payment, cashBasisShares: undefined } : payment) });
const refundTwo = await bills.recordAdjustmentPortable(ctx, { id: roundingBill, kind: "refund", date: "2026-08-04", amountCents: 2, sourcePaymentKey: second.key, cashAccountId: CASH, reason: "Legacy refund", idempotencyKey: "legacy-refund" });
const roundingAfterRefund = await get(roundingBill);
assert.deepEqual(roundingAfterRefund.payments.find((payment: any) => payment.key === refundTwo).cashBasisShares, expectedShares.map((share: any) => ({ ...share, amountCents: -share.amountCents })));
assert.deepEqual(await book(roundingBill, "cash"), { ap: 0, cashPaid: 1, expense: 1 });
const settlement = await bills.recordAdjustmentPortable(ctx, { id: roundingBill, kind: "credit", date: "2026-08-05", amountCents: 3, adjustmentAccountId: EXPENSE_A, reason: "Final vendor credit", idempotencyKey: "final-credit" });
await rejectsUnchanged(() => bills.reverseAdjustmentPortable(ctx, { id: roundingBill, paymentKey: refundTwo, date: "2026-08-06", reason: "Undo refund before dependent credit" }), /subsequent settlements/);
await bills.reverseAdjustmentPortable(ctx, { id: roundingBill, paymentKey: settlement, date: "2026-08-06", reason: "Reopen credit first" });
await bills.reverseAdjustmentPortable(ctx, { id: roundingBill, paymentKey: refundTwo, date: "2026-08-06", reason: "Then undo refund" });
assert.deepEqual(await book(roundingBill, "cash"), { ap: 0, cashPaid: 3, expense: 3 });
assert.equal([...recognizedCashShares(rounding.lines, (await get(roundingBill)).payments).values()].reduce((a, b) => a + b, 0), 3);
assert.equal(cashBasisShares(rounding.lines, recognizedCashShares(rounding.lines, (await get(roundingBill)).payments), 1).reduce((sum, share) => sum + share.amountCents, 0), 1);

// Permission/service scopes, every referenced workspace, currency resolution, and invalid source details.
const viewer = { ...owner, _id: "bill_adjustment_viewer", role: "Viewer", authSubject: "bill-viewer" };
await db.insert("users", viewer);
const viewerCtx = { ...ctx, principal: { ...ctx.principal, kind: "user" as const, assurance: "verified-jwt" as const, userId: viewer._id, subject: "bill-viewer" } };
const newCredit = { ...creditArgs, date: "2026-08-20", idempotencyKey: "permission-credit", amountCents: 100 };
await rejectsUnchanged(() => bills.recordAdjustmentPortable(viewerCtx, newCredit), /financials:write/);
await rejectsUnchanged(() => bills.reverseAdjustmentPortable(viewerCtx, { id: billId, paymentKey: credit, date: "2026-08-16", reason: "Retry denied" }), /financials:write/);
const serviceCtx: PortableMutationCtx = { ...ctx, principal: { kind: "service", runtime: "test", assurance: "trusted-internal", subject: "read-only-finance", societyId: workspaceId, actorUserId: owner._id, scopes: ["financials:read"] } };
await rejectsUnchanged(() => bills.recordAdjustmentPortable(serviceCtx, newCredit), /scope financials:write/i);
const foreignAccount = await db.insert("financialAccounts", { societyId: "foreign_bill_workspace", name: "Foreign expense", accountType: "Expense", currency: "CAD" });
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...newCredit, adjustmentAccountId: foreignAccount }), /not found/i);
const foreignBill = await db.insert("bills", { ...(await get(billId)), _id: "foreign_bill_adjustment", societyId: "foreign_bill_workspace" });
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...newCredit, id: foreignBill, adjustmentAccountId: undefined }), /membership|permission|not found|workspace/i);
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...newCredit, sourcePaymentKey: paid.key }), /appropriate/);
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...newCredit, adjustmentAccountId: CASH }), /non-cash asset/);
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...refundArgs, idempotencyKey: "wrong-source", sourcePaymentKey: second.key }), /active payment/);
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...refundArgs, idempotencyKey: "wrong-cash", cashAccountId: EXPENSE_A }), /bank, cash or card/);
await db.patch(workspaceId, { currency: "USD" });
const currencyCredit = await bills.recordAdjustmentPortable(ctx, { ...newCredit, idempotencyKey: "ledger-currency" });
assert.ok(currencyCredit, "books currency comes from ledger accounts, not an unrelated organization currency field");
await db.patch(AP, { currency: "USD" });
await rejectsUnchanged(() => bills.recordAdjustmentPortable(ctx, { ...newCredit, idempotencyKey: "ap-currency" }), /workspace currency/);
await db.patch(AP, { currency: "CAD" });

// Preflight all original entries before posting any reversal.
const brokenRefund = await bills.recordAdjustmentPortable(ctx, { ...refundArgs, idempotencyKey: "broken-refund", date: "2026-08-21", amountCents: 100 });
const withBroken = await get(billId), brokenPayment = withBroken.payments.find((payment: any) => payment.key === brokenRefund);
await db.patch(brokenPayment.cashBasisJournalEntryId, { status: "void" });
await rejectsUnchanged(() => bills.reverseAdjustmentPortable(ctx, { id: billId, paymentKey: brokenRefund, date: "2026-08-22", reason: "Must preflight both journals" }), /original journal entry/);
await db.patch(brokenPayment.cashBasisJournalEntryId, { status: "posted" });
await db.patch(billId, { status: "canceled" });
await rejectsUnchanged(() => bills.reverseAdjustmentPortable(ctx, { id: billId, paymentKey: brokenRefund, date: "2026-08-22", reason: "Canceled bill cannot reopen cash" }), /approved bill/);

// Ordinary payments use the same append-only correction history as adjustments.
const correctionBill = await createBill();
const ordinary = await bills.recordPaymentPortable(ctx, { id: correctionBill, date: "2026-09-02", amountCents: 5000, method: "eft", cashAccountId: CASH });
const ordinaryPayment = (await get(correctionBill)).payments[0];
const originalEntry = JSON.stringify(await get(ordinaryPayment.journalEntryId));
const originalCash = JSON.stringify(await get(ordinaryPayment.cashBasisJournalEntryId));
const originalMainLines = JSON.stringify(await linesOf(ordinaryPayment.journalEntryId));
const originalCashLines = JSON.stringify(await linesOf(ordinaryPayment.cashBasisJournalEntryId));
const reverseArgs = { id: correctionBill, paymentKey: ordinary.key, date: "2026-09-04", reason: "Payment recorded against the wrong vendor bill" };
await rejectsUnchanged(() => bills.removePaymentPortable(viewerCtx, reverseArgs), /financials:write/);
await rejectsUnchanged(() => bills.removePaymentPortable(serviceCtx, reverseArgs), /scope financials:write/i);
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { ...reverseArgs, id: foreignBill }), /membership|permission|not found|workspace/i);
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { ...reverseArgs, date: "2026-09-01" }), /between the original payment and today/);
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { ...reverseArgs, date: "2999-01-01" }), /between the original payment and today/);
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { ...reverseArgs, reason: " " }), /Explain why/);
const originalLock = await db.insert("booksSettings", { societyId: workspaceId, closeDate: "2026-09-02", createdAtISO: "2026-10-23T00:00:00Z", updatedAtISO: "2026-10-23T00:00:00Z" });
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { ...reverseArgs, date: "2026-09-02" }), /closed/);
const currentPeriod = (await db.query("accountingFiscalPeriods").collect()).find((period) => period.societyId === workspaceId && period.startDate <= reverseArgs.date && period.endDate >= reverseArgs.date)!;
await db.patch(currentPeriod._id, { status: "closed" });
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, reverseArgs), /Fiscal period.*closed/);
await db.patch(currentPeriod._id, { status: "open" });
await db.patch(ordinaryPayment.cashBasisJournalEntryId, { status: "void" });
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, reverseArgs), /original payment journal/);
await db.patch(ordinaryPayment.cashBasisJournalEntryId, { status: "posted" });
await bills.removePaymentPortable(ctx, reverseArgs);
const retained = (await get(correctionBill)).payments[0];
assert.equal((await get(correctionBill)).payments.length, 1, "ordinary corrections retain the payment record");
assert.deepEqual([retained.reversedDate, retained.reversalReason], [reverseArgs.date, reverseArgs.reason]);
assert.equal(JSON.stringify(await get(ordinaryPayment.journalEntryId)), originalEntry);
assert.equal(JSON.stringify(await get(ordinaryPayment.cashBasisJournalEntryId)), originalCash);
assert.equal(JSON.stringify(await linesOf(ordinaryPayment.journalEntryId)), originalMainLines);
assert.equal(JSON.stringify(await linesOf(ordinaryPayment.cashBasisJournalEntryId)), originalCashLines);
assert.deepEqual([(await get(retained.reversalJournalEntryId)).basis, (await get(retained.cashBasisReversalJournalEntryId)).basis], ["both", "cash-only"]);
assert.equal((await get(retained.reversalJournalEntryId)).date, reverseArgs.date);
assert.equal((await get(retained.cashBasisReversalJournalEntryId)).date, reverseArgs.date);
assert.deepEqual(await book(correctionBill, "accrual", "2026-09-03"), { ap: 8334, cashPaid: 5000, expense: 13334 });
assert.deepEqual(await book(correctionBill, "cash", "2026-09-03"), { ap: 0, cashPaid: 5000, expense: 5000 });
assert.deepEqual(await book(correctionBill, "accrual", "2026-09-04"), { ap: 13334, cashPaid: 0, expense: 13334 });
assert.deepEqual(await book(correctionBill, "cash", "2026-09-04"), { ap: 0, cashPaid: 0, expense: 0 });
assert.equal(billPaidCentsAsOf([retained], "2026-09-03"), 5000);
assert.equal(billPaidCentsAsOf([retained], "2026-09-04"), 0);
assert.equal(billPaidCents([retained]), 0);
assert.equal([...recognizedCashShares((await get(correctionBill)).lines, [retained]).values()].reduce((a, b) => a + b, 0), 0);
const afterReversal = await snapshot();
await bills.removePaymentPortable(ctx, reverseArgs);
assert.equal(await snapshot(), afterReversal, "retry does not duplicate mirrors, audit history or bank effects");
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { ...reverseArgs, date: "2026-09-05" }), /already reversed/);
await db.delete(originalLock);
await rejectsUnchanged(() => bills.recordPaymentPortable(ctx, { id: correctionBill, date: "2026-09-03", amountCents: 13334, method: "eft", cashAccountId: CASH }), /overlaps earlier settled amounts/);
await bills.recordPaymentPortable(ctx, { id: correctionBill, date: "2026-09-05", amountCents: 13334, method: "eft", cashAccountId: CASH });
assert.deepEqual(await book(correctionBill, "cash"), { ap: 0, cashPaid: 13334, expense: 13334 }, "reversed allocations are available again without losing the old cash history");

// The original fiscal year can remain closed while a later correction lands
// in the next open year; neither original entry is moved or voided.
const priorYearBill = await createBill([1000], "2026-03-01");
const priorYearPayment = await bills.recordPaymentPortable(ctx, { id: priorYearBill, date: "2026-03-02", amountCents: 1000, method: "eft", cashAccountId: CASH });
const priorYearStored = (await get(priorYearBill)).payments[0], priorYearEntry = await get(priorYearStored.journalEntryId);
await db.patch(priorYearEntry.fiscalPeriodId, { status: "closed" });
await bills.removePaymentPortable(ctx, { id: priorYearBill, paymentKey: priorYearPayment.key, date: "2026-04-04", reason: "Correct last year's payment in the open year" });
const priorYearCorrected = (await get(priorYearBill)).payments[0], nextYearEntry = await get(priorYearCorrected.reversalJournalEntryId);
assert.equal((await get(priorYearEntry.fiscalPeriodId)).status, "closed");
assert.notEqual(nextYearEntry.fiscalPeriodId, priorYearEntry.fiscalPeriodId);
assert.deepEqual([(await get(priorYearEntry._id)).status, (await get(priorYearEntry._id)).date, nextYearEntry.date], ["posted", "2026-03-02", "2026-04-04"]);
assert.equal(billPaidCentsAsOf([priorYearCorrected], "2026-03-31"), 1000);
assert.equal(billPaidCentsAsOf([priorYearCorrected], "2026-04-04"), 0);
await db.patch(priorYearEntry.fiscalPeriodId, { status: "open" });
const canceledCorrected = await bills.cancelPortable(ctx, { societyId: workspaceId, ids: [priorYearBill], reason: "Cancel after reversing the mistaken payment" });
assert.deepEqual(canceledCorrected, { canceled: 1, reversed: 1, skippedPaid: 0, skipped: 0 });
const canceledBill = await get(priorYearBill), cancellationEntry = await get(canceledBill.reversalJournalEntryId);
assert.equal(canceledBill.status, "canceled");
assert.equal(canceledBill.payments.length, 1, "cancellation retains corrected payment history");
assert.equal(canceledBill.payments[0].reversedDate, "2026-04-04");
assert.equal((await get(priorYearStored.cashBasisJournalEntryId)).status, "posted");
assert.equal((await get(priorYearStored.journalEntryId)).status, "posted");
assert.deepEqual(await book(priorYearBill, "cash", "2026-03-31"), { ap: 0, cashPaid: 1000, expense: 1000 });
assert.deepEqual(await book(priorYearBill, "accrual", "2026-03-31"), { ap: 0, cashPaid: 1000, expense: 1000 });
assert.deepEqual(await book(priorYearBill, "cash", "2026-04-04"), { ap: 0, cashPaid: 0, expense: 0 });
assert.deepEqual(await book(priorYearBill, "accrual", addDays(cancellationEntry.date, -1)), { ap: 1000, cashPaid: 0, expense: 1000 });
assert.deepEqual(await book(priorYearBill, "cash", cancellationEntry.date), { ap: 0, cashPaid: 0, expense: 0 });
assert.deepEqual(await book(priorYearBill, "accrual", cancellationEntry.date), { ap: 0, cashPaid: 0, expense: 0 });


// Linked-bank corrections restore accounting at the correction date, never by
// reopening the replaced old import. Old payment links remain for history only.
const bankTemplate = seed.financialTransactions.find((row) => row.accountId === CASH)!;
const createBank = async (externalId: string) => db.insert("financialTransactions", { societyId: workspaceId, connectionId: bankTemplate.connectionId, externalId, accountId: CASH, date: "2026-09-02", description: "Vendor bank correction", amountCents: -1000, category: "Original expense", accountingAccountId: EXPENSE_A, categorizedBy: "rule", ruleId: "static_rule_janitorial", ruleApplication: { ruleName: "Original", previous: { category: "Uncategorized" } } });
const linkedBill = await createBill([1000]), bankId = await createBank("dated-bank-restoration");
const bankEntry = await db.insert("journalEntries", { societyId: workspaceId, date: "2026-09-02", source: accounting.TRANSACTION_BACKFILL_SOURCE, sourceExternalId: "dated-bank-restoration", status: "posted", basis: "both" });
for (const [lineOrder, line] of [{ accountId: CASH, side: "credit", amountCents: 1000, financialTransactionId: bankId }, { accountId: EXPENSE_A, side: "debit", amountCents: 1000, tagIds: ["static_tag_fall_gala"], programCode: "RESTORED", counterpartyId: (await get(linkedBill)).vendorId }].entries()) await db.insert("journalLines", { societyId: workspaceId, journalEntryId: bankEntry, lineOrder, ...line });
const linked = await bills.recordPaymentPortable(ctx, { id: linkedBill, date: "2026-09-02", amountCents: 1000, method: "eft", financialTransactionId: bankId });
assert.equal((await get(bankEntry)).status, "void");
const bankBefore = await get(bankId), linkedBefore = (await get(linkedBill)).payments[0];
const bankLock = await db.insert("booksSettings", { societyId: workspaceId, closeDate: "2026-09-02", createdAtISO: "2026-10-23T00:00:00Z", updatedAtISO: "2026-10-23T00:00:00Z" });
await db.patch(bankId, { matchedKind: "manual", matchedId: "changed-match" });
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { id: linkedBill, paymentKey: linked.key, date: "2026-09-04", reason: "Unsafe match changed" }), /bank match changed/);
await db.patch(bankId, { matchedKind: bankBefore.matchedKind, matchedId: bankBefore.matchedId });
await db.patch(bankEntry, { status: "posted" });
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { id: linkedBill, paymentKey: linked.key, date: "2026-09-04", reason: "Refuse altered replaced journal" }), /replaced bank journal changed/);
await db.patch(bankEntry, { status: "void" });
await bills.removePaymentPortable(ctx, { id: linkedBill, paymentKey: linked.key, date: "2026-09-04", reason: "Release bank match with a dated correction" });
const linkedRetained = (await get(linkedBill)).payments[0], restoredBank = await get(linkedRetained.restoredTransactionJournalEntryId);
assert.deepEqual([restoredBank.source, restoredBank.date, restoredBank.status], [accounting.BILL_BANK_RESTORATION_SOURCE, "2026-09-04", "posted"]);
assert.deepEqual([(await get(bankEntry)).status, (await get(bankEntry)).date], ["void", "2026-09-02"]);
assert.equal((await get(linkedBefore.journalEntryId)).status, "posted");
assert.equal((await get(linkedBefore.cashBasisJournalEntryId)).status, "posted");
const restoredDimensions = (await linesOf(restoredBank._id)).find((line) => line.accountId === EXPENSE_A)!;
assert.deepEqual([restoredDimensions.tagIds, restoredDimensions.programCode, restoredDimensions.counterpartyId], [["static_tag_fall_gala"], "RESTORED", (await get(linkedBill)).vendorId]);
assert.deepEqual([(await get(bankId)).matchedKind, (await get(bankId)).category, (await get(bankId)).categorizedBy, (await get(bankId)).ruleApplication], [undefined, "Original expense", "rule", linkedBefore.transactionBefore.ruleApplication]);
assert.deepEqual((await accounting.postedJournalForTransaction(ctx, bankId)).entries.map((entry) => entry._id), [restoredBank._id], "current matching sees the restoration and excludes retained historical payments");
assert.equal(await accounting.createTransactionJournalSync(ctx, workspaceId)(bankId), "external", "bank edits cannot move a dated correction back to the old import date");
await rejectsUnchanged(() => bills.recordPaymentPortable(ctx, { id: linkedBill, date: "2026-09-03", amountCents: 1000, method: "eft", financialTransactionId: bankId }), /on or after its previous reversal/);
await db.delete(bankLock);
await bills.recordPaymentPortable(ctx, { id: linkedBill, date: "2026-09-04", amountCents: 1000, method: "eft", financialTransactionId: bankId });
assert.equal((await get(restoredBank._id)).status, "void");
assert.equal(billPaidCentsAsOf((await get(linkedBill)).payments, "2026-09-03"), 1000);
assert.equal(billPaidCentsAsOf((await get(linkedBill)).payments, "2026-09-04"), 1000);
assert.deepEqual(await book(linkedBill, "cash", "2026-09-03"), { ap: 0, cashPaid: 1000, expense: 1000 });
assert.deepEqual(await book(linkedBill, "cash", "2026-09-04"), { ap: 0, cashPaid: 1000, expense: 1000 });

// A later relink must retain the restored bank posting throughout the gap.
// Only its replacement transfer and new payment are dated at the later match.
const sameDayPayment = (await get(linkedBill)).payments.find((payment: any) => !payment.reversedDate)!;
await bills.removePaymentPortable(ctx, { id: linkedBill, paymentKey: sameDayPayment.key, date: "2026-09-06", reason: "Release bank transaction before a delayed match" });
const secondRestoration = await get((await get(linkedBill)).payments.find((payment: any) => payment.key === sameDayPayment.key).restoredTransactionJournalEntryId);
const secondRestorationSnapshot = JSON.stringify(secondRestoration), secondRestorationLines = JSON.stringify(await linesOf(secondRestoration._id));
const gapCashBefore = await book(linkedBill, "cash", "2026-09-08"), gapAccrualBefore = await book(linkedBill, "accrual", "2026-09-08");
assert.deepEqual(gapCashBefore, { ap: 0, cashPaid: 1000, expense: 1000 });
assert.deepEqual(gapAccrualBefore, { ap: 1000, cashPaid: 1000, expense: 2000 });
const delayedLock = await db.insert("booksSettings", { societyId: workspaceId, closeDate: "2026-09-06", createdAtISO: "2026-10-23T01:00:00Z", updatedAtISO: "2026-10-23T01:00:00Z" });
const delayedPayment = await bills.recordPaymentPortable(ctx, { id: linkedBill, date: "2026-09-10", amountCents: 1000, method: "eft", financialTransactionId: bankId });
const delayedStored = (await get(linkedBill)).payments.find((payment: any) => payment.key === delayedPayment.key);
assert.deepEqual([delayedStored.replacedTransactionEntryId, delayedStored.voidedTransactionEntryId], [secondRestoration._id, undefined]);
const bankTransfer = await get(delayedStored.bankTransferJournalEntryId);
assert.deepEqual([bankTransfer.source, bankTransfer.date, bankTransfer.status], ["bill_bank_transfer", "2026-09-10", "posted"]);
assert.equal(JSON.stringify(await get(secondRestoration._id)), secondRestorationSnapshot, "delayed relinking leaves the closed original bank journal unchanged");
assert.equal(JSON.stringify(await linesOf(secondRestoration._id)), secondRestorationLines);
const transferDimensions = (await linesOf(bankTransfer._id)).find((line) => line.accountId === EXPENSE_A)!;
assert.deepEqual([transferDimensions.tagIds, transferDimensions.programCode, transferDimensions.counterpartyId], [restoredDimensions.tagIds, "RESTORED", restoredDimensions.counterpartyId]);
assert.ok((await linesOf(bankTransfer._id)).every((line) => !line.financialTransactionId), "a mirror does not claim the bank transaction for a second time");
assert.deepEqual(await book(linkedBill, "cash", "2026-09-08"), gapCashBefore);
assert.deepEqual(await book(linkedBill, "accrual", "2026-09-08"), gapAccrualBefore);
assert.deepEqual(await book(linkedBill, "cash", "2026-09-11"), { ap: 0, cashPaid: 1000, expense: 1000 });
assert.deepEqual(await book(linkedBill, "accrual", "2026-09-11"), { ap: 0, cashPaid: 1000, expense: 1000 });
assert.deepEqual((await accounting.postedJournalForTransaction(ctx, bankId)).entries.map((entry) => entry._id), [delayedStored.journalEntryId], "current matching excludes the retained earlier bank association after a transfer");
const damagedTransferLine = (await linesOf(bankTransfer._id))[0];
await db.patch(damagedTransferLine._id, { amountCents: damagedTransferLine.amountCents + 1 });
await rejectsUnchanged(() => bills.removePaymentPortable(ctx, { id: linkedBill, paymentKey: delayedPayment.key, date: "2026-09-12", reason: "Refuse changed transfer" }), /transfer lines changed/);
await db.patch(damagedTransferLine._id, { amountCents: damagedTransferLine.amountCents });
const delayedReverse = { id: linkedBill, paymentKey: delayedPayment.key, date: "2026-09-12", reason: "Reverse delayed match while retaining intermediate cash" };
await bills.removePaymentPortable(ctx, delayedReverse);
const finalRestoration = await get((await get(linkedBill)).payments.find((payment: any) => payment.key === delayedPayment.key).restoredTransactionJournalEntryId);
assert.deepEqual([finalRestoration.date, finalRestoration.status], ["2026-09-12", "posted"]);
assert.equal(JSON.stringify(await get(secondRestoration._id)), secondRestorationSnapshot);
assert.equal((await get(bankTransfer._id)).status, "posted");
assert.deepEqual(await book(linkedBill, "cash", "2026-09-08"), gapCashBefore);
assert.deepEqual(await book(linkedBill, "accrual", "2026-09-08"), gapAccrualBefore);
assert.deepEqual(await book(linkedBill, "cash", "2026-09-11"), { ap: 0, cashPaid: 1000, expense: 1000 });
assert.deepEqual(await book(linkedBill, "accrual", "2026-09-11"), { ap: 0, cashPaid: 1000, expense: 1000 });
assert.deepEqual(await book(linkedBill, "cash", "2026-09-12"), gapCashBefore);
assert.deepEqual(await book(linkedBill, "accrual", "2026-09-12"), gapAccrualBefore);
assert.deepEqual((await accounting.postedJournalForTransaction(ctx, bankId)).entries.map((entry) => entry._id), [finalRestoration._id]);
const delayedDone = await snapshot(); await bills.removePaymentPortable(ctx, delayedReverse); assert.equal(await snapshot(), delayedDone, "delayed transfer reversal is idempotent");
await db.delete(delayedLock);

// If the released bank line had never been posted independently, a later
// Backfill imports run starts its accounting at the reversal date. It keeps
// the source date in raw context and preserves the original bank statement.
const backfillBill = await createBill([1000]), neverPostedBank = await createBank("dated-bank-new-backfill");
const neverPostedPayment = await bills.recordPaymentPortable(ctx, { id: backfillBill, date: "2026-09-02", amountCents: 1000, method: "eft", financialTransactionId: neverPostedBank });
await bills.removePaymentPortable(ctx, { id: backfillBill, paymentKey: neverPostedPayment.key, date: "2026-09-04", reason: "Release previously unposted bank line" });
assert.equal((await accounting.postedJournalForTransaction(ctx, neverPostedBank)).entries.length, 0);
const backfillLock = await db.insert("booksSettings", { societyId: workspaceId, closeDate: "2026-09-02", createdAtISO: "2026-10-23T00:00:00Z", updatedAtISO: "2026-10-23T00:00:00Z" });
const backfilled = await accounting.backfillFinancialTransactionsToJournalPortable(ctx, { societyId: workspaceId, transactionIds: [neverPostedBank], includeBeforeOpening: true });
assert.equal(backfilled.posted, 1, "a closed original import date does not prevent posting a later correction");
const [lateBankEntry] = (await accounting.postedJournalForTransaction(ctx, neverPostedBank)).entries;
assert.deepEqual([lateBankEntry.source, lateBankEntry.date, lateBankEntry.status], [accounting.BILL_BANK_RESTORATION_SOURCE, "2026-09-04", "posted"]);
assert.equal(JSON.parse(lateBankEntry.rawJson).originalTransactionDate, "2026-09-02");
assert.equal((await get(neverPostedBank)).date, "2026-09-02", "bank statement dates are never changed by bookkeeping corrections");
assert.deepEqual((await get(neverPostedBank)).billPaymentRelease, { date: "2026-09-04", journalEntryIds: [(await get(backfillBill)).payments[0].journalEntryId] });
assert.equal((await accounting.backfillFinancialTransactionsToJournalPortable(ctx, { societyId: workspaceId, transactionIds: [neverPostedBank], includeBeforeOpening: true })).posted, 0, "repeat backfill remains idempotent");
await db.delete(backfillLock);

console.log("Bill adjustment checks passed: credit/write-off/refund and ordinary-payment dated corrections, cash/accrual as-of history, bank restoration and relinking, backfill chronology, exact rounding, retries, locks, currencies, permissions/scopes and workspace isolation.");
