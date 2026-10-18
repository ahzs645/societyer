// Bills gate: status derivation (overdue on the organisation's local today),
// partial payments, the Accounts payable postings (balanced, reversed on
// cancel), cash-basis recognition of the paid share, duplicate detection and
// bank-line match scoring, then the portable handlers against the demo seed:
// approval under the expense approval rules, posting on approval (accrual-only)
// and payment (both bases plus a cash-only entry), cash- and accrual-basis
// statements that both balance, payments linked to bank lines (matched and
// categorised to Accounts payable, put back on removal), closed fiscal
// periods, the books close date, cancel with a reversing entry, vendors and
// tenancy.
import assert from "node:assert/strict";
import {
  addDays,
  approvalPostingLines,
  billMatchesTab,
  billPaidCents,
  billSubmitProblem,
  billTotalCents,
  cashBasisPostingLines,
  cashBasisShares,
  deriveBillStatus,
  findDuplicateBill,
  isDueSoon,
  normalizeBillNumber,
  paymentPostingLines,
  postingBalance,
  recognizedCashShares,
  reversalLines,
  suggestBillPayments,
  summarizeBills,
  validateBillLines,
  type BillLine,
} from "../shared/bills";
import type { PortableDoc, PortableMutationCtx } from "../shared/portable/ctx";
import { buildBalanceSheet, buildStatementOfOperations, entryCountsForBasis, type AccountingBasis, type BooksAccount, type BooksEntry, type BooksLine } from "../shared/booksReports";

// ---- status derivation
{
  const base = { lifecycle: "approved", dueDate: "2026-05-01", totalCents: 10000, payments: [] as Array<{ amountCents: number }> };
  assert.equal(deriveBillStatus({ ...base, lifecycle: "draft" }, "2026-06-01"), "draft");
  assert.equal(deriveBillStatus({ ...base, lifecycle: "awaiting_approval" }, "2026-06-01"), "awaiting_approval", "a bill waiting for approval is never overdue");
  assert.equal(deriveBillStatus({ ...base, lifecycle: "canceled" }, "2026-06-01"), "canceled");
  assert.equal(deriveBillStatus(base, "2026-04-30"), "open");
  assert.equal(deriveBillStatus(base, "2026-05-01"), "open", "due today is not overdue");
  assert.equal(deriveBillStatus(base, "2026-05-02"), "overdue");
  assert.equal(deriveBillStatus({ ...base, lifecycle: "scheduled" }, "2026-04-30"), "scheduled");
  assert.equal(deriveBillStatus({ ...base, lifecycle: "scheduled" }, "2026-05-02"), "overdue", "overdue wins over scheduled");
  assert.equal(deriveBillStatus({ ...base, payments: [{ amountCents: 4000 }] }, "2026-04-30"), "partially_paid");
  assert.equal(deriveBillStatus({ ...base, payments: [{ amountCents: 4000 }] }, "2026-05-02"), "overdue", "overdue wins over partially paid");
  assert.equal(deriveBillStatus({ ...base, payments: [{ amountCents: 4000 }, { amountCents: 6000 }] }, "2026-09-01"), "paid", "two partial payments settle it");
  assert.ok(isDueSoon({ status: "open", dueDate: "2026-05-07" }, "2026-04-30"));
  assert.ok(!isDueSoon({ status: "open", dueDate: "2026-05-08" }, "2026-04-30"), "eight days out is not due soon");
  assert.ok(!isDueSoon({ status: "overdue", dueDate: "2026-04-29" }, "2026-04-30"));
  assert.ok(billMatchesTab("scheduled", "open") && billMatchesTab("partially_paid", "open") && !billMatchesTab("overdue", "open"));
  const summary = summarizeBills([
    { status: "open", dueDate: "2026-05-03", totalCents: 1000, balanceCents: 1000 },
    { status: "overdue", dueDate: "2026-04-01", totalCents: 5000, balanceCents: 3000, payments: [{ amountCents: 2000, date: "2026-04-20" }] },
    { status: "paid", dueDate: "2026-04-01", totalCents: 700, balanceCents: 0, payments: [{ amountCents: 700, date: "2026-02-01" }] },
    { status: "draft", dueDate: "2026-05-01", totalCents: 999, balanceCents: 999 },
  ], "2026-04-30");
  assert.deepEqual(
    [summary.outstandingCents, summary.overdueCents, summary.dueSoonCents, summary.draftCount, summary.paidLast30Cents],
    [4000, 3000, 1000, 1, 2000],
    "drafts aren't owed; only payments in the last 30 days count",
  );
}

// ---- lines, totals, partial payments, submit checks
{
  const lines: BillLine[] = [
    { key: "a", accountId: "exp_utilities", amountCents: 41238, memo: "Hydro" },
    { key: "b", accountId: "exp_program", amountCents: 24000, fundRestrictionId: "fund_youth" },
  ];
  assert.equal(billTotalCents(lines), 65238);
  assert.equal(billPaidCents([{ amountCents: 50000 }, { amountCents: 15238 }]), 65238);
  assert.equal(validateBillLines([{ key: "x", amountCents: 100 }], { complete: false }), null, "drafts may leave accounts blank");
  assert.match(validateBillLines([{ key: "x", amountCents: 100 }], { complete: true })!, /choose the account/);
  assert.match(validateBillLines([{ key: "x", accountId: "a", amountCents: -5 }], { complete: false })!, /negative/);
  assert.equal(validateBillLines([], { complete: true }), "Add at least one line.");
  assert.equal(billSubmitProblem({ vendorId: null, billDate: "2026-04-01", dueDate: "2026-04-15", lines }), "Choose the vendor.");
  assert.match(billSubmitProblem({ vendorId: "v", billDate: "2026-04-15", dueDate: "2026-04-01", lines })!, /before the bill date/);
  assert.equal(billSubmitProblem({ vendorId: "v", billDate: "2026-04-01", dueDate: "2026-04-15", lines }), null);
}

// ---- Accounts payable postings: balanced, and the reversal nets to zero
{
  const lines: BillLine[] = [
    { key: "a", accountId: "exp_utilities", amountCents: 41238, memo: "Hydro" },
    { key: "b", accountId: "exp_program", amountCents: 24000, fundRestrictionId: "fund_youth" },
    { key: "c", accountId: "exp_program", amountCents: 0 },
  ];
  const approval = approvalPostingLines({ lines, billNumber: "CH-1", vendorName: "Coastal Hydro" }, "ap");
  assert.equal(approval.length, 3, "zero lines are left out; one debit per line plus the payables credit");
  assert.deepEqual(approval.map((line) => [line.accountId, line.side, line.amountCents]), [["exp_utilities", "debit", 41238], ["exp_program", "debit", 24000], ["ap", "credit", 65238]]);
  assert.equal(approval[1].fundRestrictionId, "fund_youth", "the fund follows the line into the books");
  assert.deepEqual(postingBalance(approval), { debitCents: 65238, creditCents: 65238, balanced: true });
  assert.throws(() => approvalPostingLines({ lines: [{ key: "x", amountCents: 100 }] }, "ap"), /account/);
  const payment = paymentPostingLines({ amountCents: 50000, financialTransactionId: "txn_1", reference: "Cheque 12" }, "ap", "bank");
  assert.deepEqual(payment.map((line) => [line.accountId, line.side, line.amountCents, line.financialTransactionId]), [["ap", "debit", 50000, "txn_1"], ["bank", "credit", 50000, "txn_1"]]);
  assert.ok(postingBalance(payment).balanced);
  const reversal = reversalLines(approval);
  assert.ok(postingBalance(reversal).balanced);
  const net = new Map<string, number>();
  for (const line of [...approval, ...reversal]) net.set(line.accountId, (net.get(line.accountId) ?? 0) + (line.side === "debit" ? line.amountCents : -line.amountCents));
  assert.ok([...net.values()].every((value) => value === 0), "approval plus reversal leaves every account at zero");
}

// ---- cash basis: the paid share of each line, in whole cents, never more than the line
{
  const lines: BillLine[] = [
    { key: "a", accountId: "exp_utilities", amountCents: 10001, memo: "Hydro", tagIds: ["tag_youth"] },
    { key: "b", accountId: "exp_program", amountCents: 3333, fundRestrictionId: "fund_youth" },
    { key: "c", accountId: "exp_program", amountCents: 0 },
    { key: "d", accountId: "exp_program", amountCents: 1 },
  ];
  const total = billTotalCents(lines);
  const first = cashBasisShares(lines, new Map(), 5000);
  assert.equal(first.reduce((sum, share) => sum + share.amountCents, 0), 5000, "the shares add up to the payment");
  assert.ok(!first.some((share) => share.key === "c"), "zero lines get no share");
  const payments: Array<{ amountCents: number; cashBasisShares?: Array<{ key: string; amountCents: number }> }> = [{ amountCents: 5000, cashBasisShares: first }];
  for (const amountCents of [1, 7, 4321]) {
    const shares = cashBasisShares(lines, recognizedCashShares(lines, payments), amountCents);
    assert.equal(shares.reduce((sum, share) => sum + share.amountCents, 0), amountCents);
    payments.push({ amountCents, cashBasisShares: shares });
  }
  const last = total - payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  payments.push({ amountCents: last, cashBasisShares: cashBasisShares(lines, recognizedCashShares(lines, payments), last) });
  const recognized = recognizedCashShares(lines, payments);
  assert.deepEqual(lines.filter((line) => line.amountCents > 0).map((line) => recognized.get(line.key)), [10001, 3333, 1], "a fully paid bill recognises every line in full");
  assert.deepEqual(recognizedCashShares(lines, [{ amountCents: 5000 }]), new Map(first.map((share) => [share.key, share.amountCents])), "payments without stored shares replay the same allocation");
  assert.deepEqual(cashBasisShares(lines, recognized, 100), [], "nothing is left to recognise");
  const posting = cashBasisPostingLines({ lines, billNumber: "CH-1", vendorName: "Coastal Hydro" }, first, "ap");
  assert.ok(postingBalance(posting).balanced);
  assert.deepEqual(posting.at(-1), { accountId: "ap", side: "credit", amountCents: 5000, description: "Accounts payable paid: Coastal Hydro bill CH-1" });
  assert.deepEqual(posting[0].tagIds, ["tag_youth"], "tags follow the line into the cash-only entry");
  assert.equal(posting[1].fundRestrictionId, "fund_youth", "and so does the fund");
}

// ---- duplicates
{
  assert.equal(normalizeBillNumber("INV-0042"), normalizeBillNumber("inv 42"));
  const others = [
    { _id: "b1", vendorId: "v1", billNumber: "INV-0042", lifecycle: "approved" },
    { _id: "b2", vendorId: "v2", billNumber: "INV-0042", lifecycle: "approved" },
    { _id: "b3", vendorId: "v1", billNumber: "77", lifecycle: "canceled" },
  ];
  assert.equal(findDuplicateBill({ vendorId: "v1", billNumber: "inv 42" }, others)?._id, "b1", "same vendor, same number");
  assert.equal(findDuplicateBill({ _id: "b1", vendorId: "v1", billNumber: "INV-0042" }, others), null, "a bill is not its own duplicate");
  assert.equal(findDuplicateBill({ vendorId: "v1", billNumber: "77" }, others), null, "canceled bills don't count");
  assert.equal(findDuplicateBill({ vendorId: "v3", billNumber: "INV-0042" }, others), null, "another vendor's number is fine");
}

// ---- match suggestion scoring
{
  const bill = { billDate: "2026-04-01", dueDate: "2026-04-16", totalCents: 63000, balanceCents: 63000, vendorName: "Harbour Janitorial Ltd." };
  const suggestions = suggestBillPayments(bill, [
    { _id: "exact", date: "2026-04-16", amountCents: -63000, description: "ONLINE BANKING PAYMENT HARBOUR JANITORIAL" },
    { _id: "exact_no_name", date: "2026-04-30", amountCents: -63000, description: "ONLINE BANKING PAYMENT" },
    { _id: "partial_name", date: "2026-04-18", amountCents: -20000, description: "HARBOUR JANITORIAL DEPOSIT" },
    { _id: "money_in", date: "2026-04-16", amountCents: 63000, description: "HARBOUR JANITORIAL" },
    { _id: "too_big", date: "2026-04-16", amountCents: -99900, description: "HARBOUR JANITORIAL" },
    { _id: "too_early", date: "2026-03-01", amountCents: -63000, description: "HARBOUR JANITORIAL" },
    { _id: "too_late", date: "2026-06-15", amountCents: -63000, description: "HARBOUR JANITORIAL" },
    { _id: "unrelated", date: "2026-04-20", amountCents: -1234, description: "COFFEE" },
  ]);
  assert.deepEqual(suggestions.map((row) => row._id), ["exact", "exact_no_name", "partial_name"], "amount, date window and payee decide the order; out-of-window, money-in and oversized lines never appear");
  assert.ok(suggestions[0].exact && suggestions[0].reasons.includes("Payee matches the vendor"));
  assert.ok(suggestions[0].score > suggestions[1].score, "the payee name and a due-date payment outrank an amount-only match");
  // After a partial payment the balance, not the total, is the exact match.
  const rest = suggestBillPayments({ ...bill, balanceCents: 43000 }, [
    { _id: "balance", date: "2026-04-20", amountCents: -43000, description: "HARBOUR JANITORIAL" },
    { _id: "total", date: "2026-04-20", amountCents: -63000, description: "HARBOUR JANITORIAL" },
  ]);
  assert.deepEqual(rest.map((row) => row._id), ["balance"], "a line larger than the balance is not suggested");
}

// ---- portable handlers on the demo seed
const { tables, society } = await import("../src/lib/staticConvexFixtures");
const { MemoryDb } = await import("../shared/portable/memoryDb");
const { makeCapabilities } = await import("../shared/portable/capabilities");
const bills = await import("../shared/functions/bills");

type Row = PortableDoc;
const seed: Record<string, Row[]> = {};
for (const [key, rows] of Object.entries(tables as Record<string, Row[]>)) seed[key] = JSON.parse(JSON.stringify(rows));
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
seed.societies = [JSON.parse(JSON.stringify(society)), { _id: "other_society", name: "Elsewhere Ltd", entityType: "corporation" }];
seed.bills = [...seed.bills, { ...seed.bills[0], _id: "foreign_bill", societyId: "other_society" }];
const db = new MemoryDb({ seed });
const S = String(seed.users[0].societyId);
const contextFor = (user: Row): PortableMutationCtx => ({
  db,
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${user._id}`, issuer: "https://issuer.test", userId: user._id, societyId: S },
  capabilities: makeCapabilities({}),
  runQuery: async () => { throw new Error("nested"); },
  runMutation: async () => { throw new Error("nested"); },
});
const owner = seed.users.find((user) => user.role === "Owner")!;
const treasurer = seed.users.find((user) => user._id === "static_user_treasurer")!;
const secretary = seed.users.find((user) => user._id === "static_user_secretary")!;
const ctx = contextFor(owner);
const asTreasurer = contextFor(treasurer);
const asSecretary = contextFor(secretary);
const get = async (id: string) => (await db.get(id))!;
const workspace = () => bills.workspacePortable(ctx, { societyId: S });
const billById = async (id: string) => (await workspace()).bills.find((row) => row._id === id)!;
const postedEntries = async (source: string) => (await db.query("journalEntries").collect()).filter((entry) => entry.source === source && entry.status === "posted");
const linesOf = async (entryId: string) => (await db.query("journalLines").collect()).filter((line) => line.journalEntryId === entryId);
// Credits minus debits over posted entries on one basis (accrual unless
// asked): Accounts payable grows, a bank account paid from goes up too.
const creditBalance = async (accountId: string, basis: AccountingBasis = "accrual") => {
  const posted = new Set((await db.query("journalEntries").collect()).filter((entry) => entry.status === "posted" && entryCountsForBasis(entry, basis)).map((entry) => entry._id));
  return (await db.query("journalLines").collect())
    .filter((line) => line.accountId === accountId && posted.has(line.journalEntryId))
    .reduce((sum, line) => sum + (line.side === "credit" ? line.amountCents : -line.amountCents), 0);
};
// The balance sheet and statement of operations over all time, on one basis.
const ALL_TIME = [{ id: "all", label: "All time", start: "1900-01-01", end: "2999-12-31", toDate: null, clipped: false }];
const statements = async (basis: AccountingBasis) => {
  const ofSociety = async (table: string) => (await db.query(table).collect()).filter((row) => row.societyId === S);
  const input = { accounts: (await ofSociety("financialAccounts")) as unknown as BooksAccount[], entries: (await ofSociety("journalEntries")) as unknown as BooksEntry[], lines: (await ofSociety("journalLines")) as unknown as BooksLine[], basis, currency: "CAD", periods: ALL_TIME };
  const balance = buildBalanceSheet(input).summary[0].values;
  const operations = buildStatementOfOperations(input).summary[0].values;
  return { ...balance, expenses: operations.expenses, difference: balance.totalAssets - balance.totalLiabilities - balance.netAssets };
};
const AP = "static_financial_ap";
const CASH = "static_financial_cash";

let ws = await workspace();
const today = ws.today;
assert.equal(ws.bills.length, 8, "eight demo bills");
assert.deepEqual(new Set(ws.bills.map((row) => row.status)), new Set(["draft", "awaiting_approval", "open", "scheduled", "partially_paid", "paid", "overdue", "canceled"]), "one in every status");
assert.ok(ws.bills.every((row) => row.societyId === S), "never returns another workspace's bills");
assert.equal(ws.vendors.filter((vendor) => vendor.billCount > 0).length, 4);
assert.equal(ws.accounts.payables?._id, AP);
assert.ok(ws.summary.overdueCount === 1 && ws.summary.dueSoonCount >= 1, "an overdue bill and one due in the next 7 days");
const printing = ws.vendors.find((vendor) => vendor.name === "Westside Printing Co-op")!;
assert.equal(printing.paidCents, 50000, "vendor totals count what was paid");
assert.equal(printing.outstandingCents, 68000);
const apBefore = await creditBalance(AP);
assert.equal(apBefore, ws.summary.outstandingCents, "Accounts payable in the books equals what the bills say is owed");
assert.equal(await creditBalance(AP, "cash"), 0, "under cash basis the demo's Accounts payable nets to zero");
{
  const demoEntries = (await db.query("journalEntries").collect()).filter((entry) => String(entry.source).startsWith("bill"));
  assert.ok(demoEntries.filter((entry) => entry.source === "bill").every((entry) => entry.basis === "accrual-only"), "demo approvals are accrual-only");
  assert.ok(demoEntries.filter((entry) => entry.source === "bill_payment").every((entry) => entry.basis === "both"), "demo payments count on both bases");
  assert.equal(demoEntries.filter((entry) => entry.source === "bill_cash_basis" && entry.basis === "cash-only").length, demoEntries.filter((entry) => entry.source === "bill_payment").length, "one cash-only entry per demo payment");
}
const cashBeforeApproval = await statements("cash");
const accrualBeforeApproval = await statements("accrual");
assert.equal(cashBeforeApproval.difference, 0, "the cash-basis balance sheet balances");
assert.equal(accrualBeforeApproval.difference, 0, "the accrual-basis balance sheet balances");

// approval: the dual-approval bill gets its second approval from the owner and posts
const agm = ws.bills.find((row) => row.status === "awaiting_approval")!;
assert.equal(agm.requiredApprovals, 2);
assert.ok(agm.canApprove, "the owner can give the second approval");
// The treasurer submitted it (and, as a director, lacks finance edit access by default).
await assert.rejects(() => bills.decidePortable(asTreasurer, { id: agm._id, decision: "approve" }), /finance edit access|your own bill/);
await assert.rejects(() => bills.decidePortable(asSecretary, { id: agm._id, decision: "approve" }), /already approved/, "one vote per person");
await assert.rejects(() => bills.decidePortable(ctx, { id: agm._id, decision: "decline", reason: "" }), /reason/);
let outcome = await bills.decidePortable(ctx, { id: agm._id, decision: "approve" });
assert.equal(outcome.status, "approved");
let row = await billById(agm._id);
assert.equal(row.status, "open");
const agmEntry = await linesOf(String(row.journalEntryId));
assert.deepEqual(postingBalance(agmEntry), { debitCents: 145000, creditCents: 145000, balanced: true });
assert.equal(await creditBalance(AP), apBefore + 145000, "approval credits Accounts payable");
// posting is idempotent per bill: the same key is never posted twice
assert.equal((await postedEntries("bill")).filter((entry) => entry.sourceExternalId === `bill:${agm._id}`).length, 1);
assert.equal((await get(String(row.journalEntryId))).basis, "accrual-only", "the approval entry is accrual-only");
assert.deepEqual(agmEntry.filter((line) => line.tagIds).map((line) => [line.amountCents, line.tagIds]), [[27000, ["static_tag_fall_gala"]]], "a tagged bill line posts its tags onto the journal line");
// An approved, unpaid bill: accrual basis shows the expense and the payable; cash basis shows neither.
{
  const cash = await statements("cash");
  const accrual = await statements("accrual");
  assert.equal(cash.difference, 0, "cash basis still balances");
  assert.equal(accrual.difference, 0, "accrual basis still balances");
  assert.equal(accrual.expenses - accrualBeforeApproval.expenses, 145000, "accrual expenses include the unpaid bill");
  assert.equal(accrual.totalLiabilities - accrualBeforeApproval.totalLiabilities, 145000, "and Accounts payable owes it");
  assert.deepEqual([cash.expenses, cash.totalLiabilities, cash.totalAssets], [cashBeforeApproval.expenses, cashBeforeApproval.totalLiabilities, cashBeforeApproval.totalAssets], "cash basis is untouched until it's paid");
  assert.equal(await creditBalance(AP, "cash"), 0);
}

// draft → submit (by the owner, who then can't approve it) → declined, fixed, approved by the secretary
const draft = ws.bills.find((row) => row.status === "draft")!;
await assert.rejects(() => bills.decidePortable(ctx, { id: draft._id, decision: "approve" }), /waiting for approval/);
await bills.submitPortable(ctx, { id: draft._id });
await assert.rejects(() => bills.decidePortable(ctx, { id: draft._id, decision: "approve" }), /your own bill/);
await bills.decidePortable(asSecretary, { id: draft._id, decision: "decline", reason: "Only three visits happened in April" });
row = await billById(draft._id);
assert.equal(row.status, "draft");
assert.equal(row.declinedReason, "Only three visits happened in April");
await bills.upsertPortable(ctx, { id: draft._id, societyId: S, billNumber: "HJ-2318", vendorId: draft.vendorId, billDate: draft.billDate, terms: "net_15", lines: [{ accountId: "static_financial_facilities_expense", amountCents: 47250, memo: "Three visits" }] });
await bills.submitPortable(ctx, { id: draft._id });
await bills.decidePortable(asSecretary, { id: draft._id, decision: "approve" });
assert.equal((await billById(draft._id)).status, "open");
assert.ok((await billById(draft._id)).timeline.some((event) => event.kind === "declined"), "the trail keeps the decline");

// payment linked to the suggested bank line: matched, categorised to AP, AP cleared
ws = await workspace();
const overdue = ws.bills.find((row) => row.status === "overdue")!;
const suggestion = suggestBillPayments(overdue, ws.transactions.filter((txn) => !txn.linkedBillId && !txn.matchedElsewhere))[0];
assert.equal(suggestion?._id, "static_tx_bill_janitorial_march", "the unlinked Harbour Janitorial payment is suggested");
await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: overdue._id, date: today, amountCents: 1000, method: "eft", financialTransactionId: suggestion._id }), /must match the bank transaction/);
const apBeforePayment = await creditBalance(AP);
const cashBefore = await creditBalance(CASH);
const paid = await bills.recordPaymentPortable(ctx, { id: overdue._id, date: suggestion.date, amountCents: -suggestion.amountCents, method: "eft", financialTransactionId: suggestion._id });
assert.equal(paid.remainingCents, 0);
let txn = await get(suggestion._id);
assert.deepEqual([txn.matchedKind, txn.matchedId, txn.accountingAccountId, txn.category, txn.categorizedBy], ["bill", overdue._id, AP, "Accounts payable", "manual"], "the bank line is matched to the bill and categorised to Accounts payable");
assert.ok(txn.reconciledAtISO);
assert.equal(await creditBalance(AP), apBeforePayment - 63000, "payment debits Accounts payable");
assert.equal(await creditBalance(CASH), cashBefore + 63000, "and credits the bank account");
assert.equal((await billById(overdue._id)).status, "paid");
const paidPayment = (await billById(overdue._id)).payments[0];
assert.equal((await get(String(paidPayment.journalEntryId))).basis, "both", "the payment counts on both bases");
const cashEntry = await get(String(paidPayment.cashBasisJournalEntryId));
assert.deepEqual([cashEntry.source, cashEntry.basis, cashEntry.date], ["bill_cash_basis", "cash-only", suggestion.date], "a cash-only entry recognises the expense on the payment date");
assert.deepEqual((await linesOf(cashEntry._id)).map((line) => [line.accountId, line.side, line.amountCents]).sort(), [[AP, "credit", 63000], ["static_financial_facilities_expense", "debit", 63000]].sort());
assert.equal(await creditBalance(AP, "cash"), 0, "under cash basis Accounts payable nets to zero after the payment");
await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: agm._id, date: today, amountCents: 63000, method: "eft", financialTransactionId: suggestion._id }), /already linked/);
// undo: the entry is voided and the bank line goes back as it was
const paymentKey = (await billById(overdue._id)).payments[0].key;
await bills.removePaymentPortable(ctx, { id: overdue._id, paymentKey });
txn = await get(suggestion._id);
assert.deepEqual([txn.matchedKind, txn.matchedId, txn.accountingAccountId, txn.category, txn.reconciledAtISO], [undefined, undefined, undefined, undefined, undefined], "unlinking restores the bank line");
assert.equal(await creditBalance(AP), apBeforePayment, "the payment entry no longer counts");
assert.equal((await get(cashEntry._id)).status, "void", "removing the payment voids its cash-only entry too");
assert.equal(await creditBalance(AP, "cash"), 0);
assert.equal((await billById(overdue._id)).status, "overdue");

// partial payments without a bank line need the account it was paid from
const open = ws.bills.find((row) => row.status === "open" && row.vendorName === "Coastal Hydro")!;
await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: open._id, date: today, amountCents: 10000, method: "cheque" }), /paid from/);
await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: open._id, date: today, amountCents: 10000, method: "cheque", cashAccountId: "static_financial_program_expense" }), /isn't a bank/);
await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: open._id, date: today, amountCents: open.totalCents + 1, method: "cheque", cashAccountId: CASH }), /balance/);
await bills.recordPaymentPortable(ctx, { id: open._id, date: today, amountCents: 10000, method: "cheque", reference: "Cheque 3310", cashAccountId: CASH });
assert.equal((await billById(open._id)).status, "partially_paid");
{
  const partialCash = await get(String((await billById(open._id)).payments[0].cashBasisJournalEntryId));
  assert.deepEqual((await linesOf(partialCash._id)).filter((line) => line.side === "debit").map((line) => line.amountCents), [10000], "a partial payment recognises only the paid share");
}
await bills.recordPaymentPortable(ctx, { id: open._id, date: today, amountCents: open.totalCents - 10000, method: "cheque", cashAccountId: CASH });
row = await billById(open._id);
assert.equal(row.status, "paid");
assert.equal(row.balanceCents, 0);
await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: open._id, date: today, amountCents: 1, method: "cheque", cashAccountId: CASH }), /already paid/);

// closed fiscal period: approving or paying into it is refused with the period's name
const currentPeriod = (await db.query("accountingFiscalPeriods").collect()).find((period) => period.societyId === S && period.startDate <= today && period.endDate >= today)!;
await db.patch(currentPeriod._id, { status: "closed" });
const scheduled = ws.bills.find((row) => row.status === "scheduled")!;
await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: scheduled._id, date: today, amountCents: 1000, method: "cheque", cashAccountId: CASH }), new RegExp(`Fiscal period ${currentPeriod.periodLabel ?? currentPeriod.fiscalYear} is closed`));
await assert.rejects(() => bills.cancelPortable(ctx, { societyId: S, ids: [scheduled._id] }), new RegExp(`Fiscal period ${currentPeriod.periodLabel ?? currentPeriod.fiscalYear} is closed`), "the reversal can't land in a closed period either");
assert.equal((await get(scheduled._id)).status, "scheduled", "nothing changed");
await db.patch(currentPeriod._id, { status: "open" });

// books close date: approving, paying, removing a payment and canceling on or before it are refused; nothing changes
{
  const settingsId = await db.insert("booksSettings", { societyId: S, closeDate: today, createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() });
  const lockedMessage = new RegExp(`books are closed through ${today}`);
  await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: scheduled._id, date: today, amountCents: 1000, method: "cheque", cashAccountId: CASH }), lockedMessage);
  await assert.rejects(() => bills.cancelPortable(ctx, { societyId: S, ids: [scheduled._id] }), lockedMessage, "the reversal is dated today, inside the lock");
  const markLocked = bills.markPaidPortable(ctx, { societyId: S, ids: [scheduled._id], date: today, method: "eft", cashAccountId: CASH });
  await assert.rejects(() => markLocked, lockedMessage, "bulk mark paid stops rather than skipping every bill");
  const paidOpen = await billById(open._id);
  await assert.rejects(() => bills.removePaymentPortable(ctx, { id: open._id, paymentKey: paidOpen.payments[0].key }), /can't be voided/);
  assert.equal((await billById(open._id)).payments.length, 2, "the payment stays");
  assert.equal((await get(String(paidOpen.payments[0].cashBasisJournalEntryId))).status, "posted", "and so does its cash-only entry");
  assert.equal((await get(scheduled._id)).status, "scheduled", "nothing changed");
  // The close date itself is locked, whatever today is.
  await db.patch(settingsId, { closeDate: addDays(today, -1) });
  await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: scheduled._id, date: addDays(today, -1), amountCents: 1000, method: "cheque", cashAccountId: CASH }), /books are closed/);
  await db.delete(settingsId);
}

// cancel: an approved bill gets a reversing entry, a paid one is skipped
const apBeforeCancel = await creditBalance(AP);
const result = await bills.cancelPortable(ctx, { societyId: S, ids: [scheduled._id, open._id], reason: "Booking moved to the fall" });
assert.deepEqual(result, { canceled: 1, reversed: 1, skippedPaid: 1, skipped: 0 });
row = await billById(scheduled._id);
assert.equal(row.status, "canceled");
assert.equal(row.balanceCents, 0);
const reversal = await linesOf(String(row.reversalJournalEntryId));
assert.ok(postingBalance(reversal).balanced);
assert.equal(await creditBalance(AP), apBeforeCancel - 85000, "the reversal takes the bill out of Accounts payable");
assert.equal((await postedEntries("bill_reversal")).length, 1);

// vendors: add one, use its defaults, warn on a duplicate number, delete only unsent drafts
const vendorId = await bills.upsertVendorPortable(ctx, { societyId: S, name: "Granville Plumbing", defaultAccountId: "static_financial_facilities_expense", defaultTerms: "net_15", paymentMethod: "cheque" });
await assert.rejects(() => bills.upsertVendorPortable(ctx, { societyId: S, name: "granville plumbing" }), /already a vendor/);
await assert.rejects(() => bills.upsertVendorPortable(ctx, { societyId: S, name: "Bank vendor", defaultAccountId: CASH }), /not a bank account/);
const created = await bills.upsertPortable(ctx, { societyId: S, vendorId, billNumber: "GP-0001", billDate: today, lines: [{ accountId: "static_financial_facilities_expense", amountCents: 21000 }] });
assert.equal(created.duplicateOf, null);
assert.equal((await get(created.id)).terms, "net_15", "terms come from the vendor");
const again = await bills.upsertPortable(ctx, { societyId: S, vendorId, billNumber: "gp 1", billDate: today, lines: [] });
assert.equal(again.duplicateOf?._id, created.id, "same vendor and bill number is flagged");
await assert.rejects(() => bills.upsertPortable(ctx, { societyId: S, vendorId, billDate: today, lines: [{ accountId: CASH, amountCents: 100 }] }), /bank or card account/);
await bills.removePortable(ctx, { id: again.id });
// tags on bill lines: one per group, this organization's tags only (the transaction-line rule)
await assert.rejects(() => bills.upsertPortable(ctx, { id: created.id, societyId: S, vendorId, billDate: today, lines: [{ accountId: "static_financial_facilities_expense", amountCents: 21000, tagIds: ["static_tag_youth_mentoring", "static_tag_arts_nights"] }] }), /two tags from the same group/);
await assert.rejects(() => bills.upsertPortable(ctx, { id: created.id, societyId: S, vendorId, billDate: today, lines: [{ accountId: "static_financial_facilities_expense", amountCents: 21000, tagIds: ["static_tag_nope"] }] }), /no longer exists/);
await bills.upsertPortable(ctx, { id: created.id, societyId: S, vendorId, billNumber: "GP-0001", billDate: today, lines: [{ accountId: "static_financial_facilities_expense", amountCents: 21000, tagIds: ["static_tag_community_garden", "static_tag_city_neighbourhood"] }] });
assert.deepEqual((await get(created.id)).lines[0].tagIds, ["static_tag_community_garden", "static_tag_city_neighbourhood"], "valid tags are kept on the line");
{
  const demoTagged = (await db.query("journalLines").collect()).filter((line) => String(line._id).startsWith("static_jline_") && (line.tagIds ?? []).includes("static_tag_youth_mentoring"));
  assert.ok(demoTagged.some((line) => String(line.journalEntryId).startsWith("static_journal_bill_")) && demoTagged.some((line) => String(line.journalEntryId).startsWith("static_journal_cash_")), "demo bill postings carry their lines' tags, on the accrual and the cash-only entries");
}
await assert.rejects(() => bills.removePortable(ctx, { id: draft._id }), /Only drafts/);
await assert.rejects(() => bills.upsertPortable(ctx, { id: agm._id, societyId: S, billDate: today, lines: [] }), /Approved bills/);

// bulk mark paid: approved bills settle, others are skipped
const markResult = await bills.markPaidPortable(ctx, { societyId: S, ids: [agm._id, draft._id, created.id], date: today, method: "eft", cashAccountId: CASH });
assert.equal(markResult.paid, 2);
assert.equal(markResult.skipped.length, 1, "the unapproved draft is skipped");

// tenancy: a foreign id stops a batch before any write and is never echoed back
await assert.rejects(() => bills.cancelPortable(ctx, { societyId: S, ids: [created.id, "foreign_bill"] }), (error: Error) => !error.message.includes("foreign_bill"));
assert.equal((await get(created.id)).status, "draft");
await assert.rejects(() => bills.recordPaymentPortable(ctx, { id: "foreign_bill", date: today, amountCents: 100, method: "cash", cashAccountId: CASH }));

// the books still balance after everything above, on both bases
const allLines = await db.query("journalLines").collect();
const posted = new Set((await db.query("journalEntries").collect()).filter((entry) => entry.status === "posted").map((entry) => entry._id));
assert.ok(postingBalance(allLines.filter((line) => posted.has(line.journalEntryId))).balanced, "every posted entry together still balances");
assert.equal(await creditBalance(AP), (await workspace()).summary.outstandingCents, "Accounts payable still equals what the bills say is owed");
assert.equal(await creditBalance(AP, "cash"), 0, "and under cash basis it still nets to zero");
assert.equal((await statements("cash")).difference, 0);
assert.equal((await statements("accrual")).difference, 0);

console.log("Bill checks passed: status, partial payments, AP postings and reversal, cash and accrual basis, the close date, duplicates, match scoring and handlers.");
