// Banking workflows: receipt file-name prefill and match scoring, the
// reconciliation month strip, running balances and auto-reconcile, mileage
// claims under the claim policy, spend-budget cycles and spend sources, and
// the money-account helpers; then end to end on the portable engine seeded
// with the demo workspace (receipt inbox, auto-reconcile, Add account,
// mileage claims and spend budgets).
import assert from "node:assert/strict";
import { tables } from "../src/lib/staticConvexFixtures";
import { MemoryDb } from "../shared/portable/memoryDb";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import { makeCapabilities } from "../shared/portable/capabilities";
import { highConfidencePairs, merchantSimilarity, parseReceiptFilename, rankReceiptCandidates, scoreReceiptMatch } from "../shared/receiptMatching";
import { autoReconcileReadiness, balanceBefore, monthStatus, monthStatusesForYear, withRunningBalance } from "../shared/reconciliationMonths";
import { evaluateClaimPolicy, mileageAmountCents, normalizeClaimPolicy, validateClaimPolicy, validateMileage, describeClaimPolicy } from "../shared/expensePolicy";
import { budgetSpend, claimSpendEntries, cycleWindow, isAssignedToBudget, spendBudgetStatus, transactionSpendEntries, validateSpendBudget, type SpendEntry } from "../shared/spendBudgets";
import { bankAccountBalanceCents, bankAccountHealth, bankAccountKind, bankAccountSource, nextLedgerCode } from "../shared/bankAccounts";
import * as recon from "../shared/functions/reconciliation";
import * as inbox from "../shared/functions/receiptInbox";
import * as accounts from "../shared/functions/bankAccounts";
import * as budgets from "../shared/functions/spendBudgets";
import * as exp from "../shared/functions/expenseReports";
import * as hub from "../shared/functions/financialHub";
import { DEMO_MILEAGE_RATE_CENTS } from "../shared/demoData/banking";
import { todayDateOnly } from "../shared/dateOnly";

/* ------------------------------------------------ file-name prefill */

assert.deepEqual(parseReceiptFilename("2026-10-12_Coastal-Hydro_161.38.pdf"), { date: "2026-10-12", amountCents: 16138, merchant: "Coastal Hydro" });
assert.deepEqual(parseReceiptFilename("receipt 20261003 $42.50 Hillcrest Hardware.jpg"), { date: "2026-10-03", amountCents: 4250, merchant: "Hillcrest Hardware" });
assert.deepEqual(parseReceiptFilename("harbourline telecom invoice.pdf"), { merchant: "Harbourline Telecom" }, "no amount or date: merchant only, title-cased");
assert.deepEqual(parseReceiptFilename("Saffron Table Catering - 1,234.56.pdf"), { amountCents: 123456, merchant: "Saffron Table Catering" }, "thousands separator and a spaced dash");
assert.equal(parseReceiptFilename("2026.02.30_Bad-date_10.00.png").date, undefined, "February 30 is not a date");
assert.deepEqual(parseReceiptFilename("IMG_4821.jpg"), {}, "a phone photo name carries nothing; a bare number is not an amount");
assert.equal(parseReceiptFilename("Fernbrook 161,38.pdf").amountCents, 16138, "comma decimals");
assert.equal(parseReceiptFilename("2026_10_12 Ticketbay CAD25.pdf").amountCents, 2500, "a currency-marked whole amount");
assert.equal(parseReceiptFilename("folder/sub/2026-10-12_A_1.00.pdf").merchant, "A", "only the base name is read");

/* ------------------------------------------------ match scoring */

const txns = [
  { _id: "t1", date: "2026-10-13", amountCents: -16138, counterparty: "Coastal Hydro", description: "Coastal Hydro" },
  { _id: "t2", date: "2026-10-12", amountCents: -16200, counterparty: "Northshore Gas Co-op", description: "Northshore Gas Co-op" },
  { _id: "t3", date: "2026-09-01", amountCents: -16138, counterparty: "Coastal Hydro", description: "Coastal Hydro" },
  { _id: "t4", date: "2026-10-12", amountCents: 16138, counterparty: "Refund", description: "Refund" },
  { _id: "t5", date: "2026-10-12", amountCents: -16138, counterparty: "Coastal Hydro", receiptDocumentId: "doc" },
];
const receipt = { merchant: "Coastal Hydro", amountCents: 16138, date: "2026-10-12" };
assert.equal(scoreReceiptMatch(receipt, txns[3]), null, "money in is never a receipt's payment");
assert.equal(scoreReceiptMatch(receipt, txns[4]), null, "a line that already has a receipt is taken");
assert.equal(scoreReceiptMatch(receipt, txns[2]), null, "outside the date window");
const exact = scoreReceiptMatch(receipt, txns[0])!;
assert.equal(exact.amountKind, "exact");
assert.equal(exact.score, 60 + 23 + 15, "exact amount, one day apart, same merchant");
const close = scoreReceiptMatch(receipt, txns[1])!;
assert.equal(close.amountKind, "close", "within $1 counts as close");
assert.ok(close.score < exact.score);
assert.equal(scoreReceiptMatch({ ...receipt, amountCents: 20000 }, txns[0]), null, "more than 5% off is not a candidate");
const ranked = rankReceiptCandidates(receipt, txns);
assert.deepEqual(ranked.map((c) => c.transactionId), ["t1", "t2"], "exact first, then close");
assert.equal(ranked[0].confidence, "high");
assert.notEqual(ranked[1].confidence, "high");
assert.equal(rankReceiptCandidates({ merchant: "Coastal Hydro", date: "2026-10-12" }, txns)[0].confidence, "low", "merchant and date alone are never high confidence");
assert.equal(rankReceiptCandidates({ merchant: "Coastal Hydro" }, txns).length, 2, "a full merchant match alone still suggests");
assert.ok(merchantSimilarity("Coastal Hydro", "COASTAL HYDRO PAD 4421") >= 0.99);
assert.equal(merchantSimilarity("Hydro", "Telecom"), 0);
// Two receipts pointing at one line: neither is matched automatically.
assert.deepEqual(
  highConfidencePairs([{ _id: "a", ...receipt }, { _id: "b", ...receipt }], txns).length,
  0,
  "a transaction two receipts claim is left for a person",
);
assert.deepEqual(highConfidencePairs([{ _id: "a", ...receipt }], txns), [{ itemId: "a", transactionId: "t1", score: exact.score }]);

/* ------------------------------------------------ month strip */

const today = "2026-04-15";
const period = (id: string, startDate: string, endDate: string, effectiveStatus: string, differenceCents = 0) => ({ _id: id, startDate, endDate, effectiveStatus, differenceCents });
const periods = [
  period("jan", "2026-01-01", "2026-01-31", "completed"),
  period("feb", "2026-02-01", "2026-02-28", "out_of_balance", -8960),
  period("mar", "2026-03-01", "2026-03-31", "in_progress", -5606),
  period("q1", "2025-10-01", "2025-12-31", "auto_reconciled"),
];
const dates = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-02"];
const strip = monthStatusesForYear(2026, periods, dates, today);
assert.deepEqual(strip.slice(0, 5).map((m) => [m.kind, m.label]), [
  ["reconciled", "Reconciled"],
  ["difference", "Difference −$89.60"],
  ["difference", "Difference −$56.06"],
  ["not_started", "Not started"],
  ["upcoming", "Upcoming"],
]);
assert.equal(strip[1].periodId, "feb");
assert.equal(monthStatus("2025-11", periods, dates, today).label, "Auto-reconciled", "inside a quarterly auto-reconciled statement");
assert.equal(monthStatus("2026-03", [period("mar", "2026-03-01", "2026-03-31", "in_progress", 0)], dates, today).kind, "in_progress", "open and balanced reads in progress");
assert.equal(monthStatus("2026-03", [period("half", "2026-03-01", "2026-03-15", "completed")], dates, today).kind, "in_progress", "a closed statement covering half the month");
assert.equal(monthStatus("2026-04", [period("apr", "2026-04-01", "2026-04-15", "completed")], dates, today).kind, "reconciled", "the current month only needs covering up to today");
assert.equal(monthStatus("2026-02", [period("feb", "2026-02-01", "2026-02-28", "out_of_balance", 0)], dates, today).label, "Changed since reconciled");
assert.equal(strip[0].transactionCount, 1);

/* ------------------------------------------------ running balance, auto-reconcile */

const lines = [
  { _id: "b", date: "2026-03-02", amountCents: -500 },
  { _id: "a", date: "2026-03-01", amountCents: 1000 },
  { _id: "c", date: "2026-03-02", amountCents: 250 },
];
assert.deepEqual(withRunningBalance(lines, 10_000).map((l) => [l._id, l.balanceCents]), [["a", 11_000], ["b", 10_500], ["c", 10_750]]);
assert.equal(balanceBefore(10_750, lines, "2026-03-02"), 11_000, "working back from the current balance");
const readyLines = [
  { _id: "m", amountCents: 1000, reconciledAtISO: "2026-04-01T00:00:00Z" },
  { _id: "k", amountCents: -400, category: "Facilities" },
  { _id: "l", amountCents: -100, accountingAccountId: "acct" },
];
assert.deepEqual(autoReconcileReadiness(0, 500, readyLines), { ready: true, projectedDifferenceCents: 0, toClearIds: ["k", "l"], blockingCount: 0, reason: undefined });
assert.equal(autoReconcileReadiness(0, 500, [...readyLines, { _id: "u", amountCents: 0, category: "Uncategorized" }]).ready, false, "an uncategorised line blocks");
assert.match(autoReconcileReadiness(0, 600, readyLines).reason ?? "", /difference of −?\$/, "categorised lines that still leave a difference");
assert.equal(autoReconcileReadiness(0, 0, []).ready, false, "an empty statement");

/* ------------------------------------------------ mileage and the claim policy */

assert.equal(mileageAmountCents(42, 70), 2940);
assert.equal(mileageAmountCents(18.5, 70), 1295);
assert.equal(mileageAmountCents(25, 67), 1675, "rounds to the cent");
assert.equal(mileageAmountCents(1.15, 50), 58, "a half cent rounds up although 1.15 × 50 is 57.4999… in floating point");
assert.equal(mileageAmountCents(2.05, 70), 144, "and 2.05 × 70 (143.4999…)");
assert.equal(mileageAmountCents(0.01, 49), 0, "under half a cent rounds down");
assert.match(validateMileage({ distanceKm: 10, tripDescription: "x" }, null)[0], /mileage rate/, "mileage needs the organisation's rate");
assert.deepEqual(validateMileage({ distanceKm: 42.35, tripDescription: "Site visit" }, 70), []);
assert.deepEqual(validateMileage({ distanceKm: 12, fromLocation: "Hall", toLocation: "Library" }, 70), [], "from and to describe the trip");
assert.equal(validateMileage({ distanceKm: 0, tripDescription: "x" }, 70).length, 1);
assert.equal(validateMileage({ distanceKm: 1.234, tripDescription: "x" }, 70).length, 1, "at most two decimals");
assert.equal(validateMileage({ distanceKm: 5 }, 70).length, 1, "a trip needs a description or both ends");
const policy = normalizeClaimPolicy({ receiptOverCents: 1000, noteOverCents: null, maxAgeDays: null, enforcement: "block", mileageRateCentsPerKm: 70 });
assert.equal(policy.mileageRateCentsPerKm, 70);
assert.deepEqual(evaluateClaimPolicy(policy, { claimType: "mileage", amountCents: 5000 }, "2026-04-01"), [], "mileage claims need no receipt");
assert.deepEqual(evaluateClaimPolicy(policy, { amountCents: 5000 }, "2026-04-01").map((i) => i.code), ["receipt"], "other claims still do");
assert.deepEqual(validateClaimPolicy({ ...policy, mileageRateCentsPerKm: 0 }).length, 1, "a zero rate is refused");
assert.deepEqual(validateClaimPolicy({ ...policy, mileageRateCentsPerKm: 501 }).length, 1, "a rate over $5/km is refused");
assert.match(describeClaimPolicy(policy), /mileage at \$0\.70\/km/);
assert.equal(normalizeClaimPolicy({ enforcement: "warn" }).mileageRateCentsPerKm, null, "no rate unless the organisation sets one");

/* ------------------------------------------------ spend budgets */

const monthly = { _id: "m", limitCents: 30_000, cycle: "monthly", startDate: "2026-01-15" };
assert.deepEqual(cycleWindow(monthly, "2026-01-20"), { start: "2026-01-15", end: "2026-01-31" }, "the first cycle starts on the start date");
assert.deepEqual(cycleWindow(monthly, "2026-02-10"), { start: "2026-02-01", end: "2026-02-28" });
assert.deepEqual(cycleWindow({ ...monthly, cycle: "weekly" }, "2026-04-15"), { start: "2026-04-13", end: "2026-04-19" }, "weeks run Monday to Sunday");
assert.deepEqual(cycleWindow({ ...monthly, cycle: "quarterly" }, "2026-05-02"), { start: "2026-04-01", end: "2026-06-30" });
assert.deepEqual(cycleWindow({ ...monthly, cycle: "quarterly", endDate: "2026-05-15" }, "2026-05-02"), { start: "2026-04-01", end: "2026-05-15" }, "clipped to the end date");
assert.deepEqual(cycleWindow({ ...monthly, cycle: "once", endDate: "2026-06-30" }, "2026-03-01"), { start: "2026-01-15", end: "2026-06-30" });
assert.equal(spendBudgetStatus({ startDate: "2026-05-01" }, "2026-04-15"), "upcoming");
assert.equal(spendBudgetStatus({ startDate: "2026-01-01", endDate: "2026-03-31" }, "2026-04-15"), "ended");
assert.equal(spendBudgetStatus({ startDate: "2026-01-01" }, "2026-04-15"), "active");
const claims = [
  { _id: "c1", spendBudgetId: "m", amountCents: 12_000, incurredAtISO: "2026-04-02", status: "Paid" },
  { _id: "c2", spendBudgetId: "m", amountCents: 9_000, incurredAtISO: "2026-04-10", status: "Submitted" },
  { _id: "c3", spendBudgetId: "m", amountCents: 50_000, incurredAtISO: "2026-04-11", status: "Draft" },
  { _id: "c4", spendBudgetId: "m", amountCents: 7_000, incurredAtISO: "2026-03-30", status: "Approved" },
  { _id: "c5", spendBudgetId: "other", amountCents: 1_000, incurredAtISO: "2026-04-03", status: "Paid" },
];
const claimEntries = claimSpendEntries(claims);
assert.deepEqual(claimEntries.map((e) => e.sourceId), ["c1", "c2", "c4", "c5"], "drafts don't count");
const spend = budgetSpend(monthly, [() => claimEntries], "2026-04-15");
assert.deepEqual([spend.spentCents, spend.remainingCents, spend.percentSpent, spend.entryCount], [21_000, 9_000, 70, 2], "this cycle only");
// The extension point: another source (bank transactions) adds to the same budget.
const bankEntries: SpendEntry[] = [{ source: "transaction", sourceId: "t9", budgetId: "m", amountCents: 12_000, date: "2026-04-12" }];
const withBank = budgetSpend(monthly, [() => claimEntries, () => bankEntries], "2026-04-15");
assert.deepEqual([withBank.spentCents, withBank.overLimit, withBank.bySource.transaction, withBank.bySource.claim], [33_000, true, 12_000, 21_000]);
// Bank transactions as a source: money out only, and a claim's payout line isn't counted twice.
{
  const lines = [
    { _id: "b1", spendBudgetId: "m", amountCents: -4_000, date: "2026-04-05" },
    { _id: "b2", spendBudgetId: "m", amountCents: 6_000, date: "2026-04-06" },
    { _id: "b3", spendBudgetId: "m", amountCents: -12_000, date: "2026-04-07", matchedKind: "expenseReport", matchedId: "c1" },
    { _id: "b4", spendBudgetId: "m", amountCents: -1_000, date: "2026-04-08", matchedKind: "expenseReport", matchedId: "c5" },
    { _id: "b5", amountCents: -9_999, date: "2026-04-09" },
  ];
  const entries = transactionSpendEntries(lines, claims);
  assert.deepEqual(entries.map((entry) => [entry.sourceId, entry.amountCents]), [["b1", 4_000], ["b4", 1_000]], "money in, unassigned lines and the payout of a claim on the same budget don't count");
  const both = budgetSpend(monthly, [() => claimEntries, () => entries], "2026-04-15");
  assert.deepEqual([both.bySource.claim, both.bySource.transaction, both.spentCents], [21_000, 5_000, 26_000], "c1 counts once, as the claim");
}
const members = [
  { committeeId: "finance", name: "Jordan Lee", email: "jordan@riverside.example" },
  { committeeId: "finance", name: "Old Member", leftAt: "2025-01-01" },
];
assert.ok(isAssignedToBudget({ committeeId: "finance" }, { _id: "u1", displayName: "jordan lee" }, members, today), "committee member by name");
assert.ok(isAssignedToBudget({ committeeId: "finance" }, { _id: "u2", displayName: "J. Lee", email: "JORDAN@riverside.example" }, members, today), "or by email");
assert.ok(!isAssignedToBudget({ committeeId: "finance" }, { _id: "u3", displayName: "Old Member" }, members, today), "former members are not");
assert.ok(isAssignedToBudget({ memberUserIds: ["u9"] }, { _id: "u9" }, [], today), "named people");
assert.match(validateSpendBudget({ name: "x", limitCents: 100, cycle: "once", startDate: "2026-01-01", memberUserIds: ["u"] })[0], /end date/);
assert.match(validateSpendBudget({ name: "x", limitCents: 100, cycle: "monthly", startDate: "2026-01-01" })[0], /committee or at least one person/);

/* ------------------------------------------------ money accounts */

assert.equal(nextLedgerCode(["1000", "1010", "1100"], "bank"), "1020");
assert.equal(nextLedgerCode(["2100"], "credit"), "2110");
assert.equal(nextLedgerCode(["1000"], "payments"), "1050");
assert.equal(bankAccountKind({ accountType: "Bank", name: "Stripe balance" }), "payments");
assert.equal(bankAccountKind({ accountType: "Credit" }), "credit");
assert.equal(bankAccountSource({ profileOrigin: "manual", connectionProvider: "wave" }), "manual", "added by hand stays manual");
assert.equal(bankAccountSource({ connectionProvider: "wave" }), "wave");
assert.equal(bankAccountSource({ hasCsvLines: true }), "csv");
assert.equal(bankAccountHealth({ source: "wave", connectionStatus: "error", connectionError: "token expired" }).status, "needs_attention");
assert.equal(bankAccountHealth({ source: "wave", connectionStatus: "disconnected" }).status, "not_connected");
assert.equal(bankAccountHealth({ source: "csv", outOfBalanceCount: 1 }).status, "needs_attention");
assert.equal(bankAccountBalanceCents({ balanceCents: 999 }, { openingBalanceCents: 25_000, openingDate: "2026-01-01" }, [{ date: "2025-12-31", amountCents: -5 }, { date: "2026-01-02", amountCents: -1_000 }]), 24_000);

/* ------------------------------------------------ end to end on the demo */

type SeedRow = Record<string, unknown> & { _id: string };
const seed: Record<string, SeedRow[]> = JSON.parse(JSON.stringify(tables));
seed.users = seed.users.map((u) => ({ ...u, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${u._id}` }));
const db = new MemoryDb({ seed });
const S = String(seed.users[0].societyId);
const nested = async (): Promise<never> => { throw new Error("nested"); };
const ctxFor = (userId: string): PortableMutationCtx => ({
  db,
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${userId}`, issuer: "https://issuer.test", userId, societyId: S },
  capabilities: makeCapabilities({}),
  runQuery: nested,
  runMutation: nested,
});
const mina = ctxFor(seed.users[0]._id);
const jordan = ctxFor("static_user_treasurer");

// Receipt inbox: two exact matches are high confidence; match all attaches them through updateTransaction.
let box = await inbox.listPortable(mina, { societyId: S });
assert.equal(box.counts.unmatched, 4);
assert.equal(box.highConfidenceCount, 2);
const photo = box.rows.find((row) => row.fileName === "IMG_2041.jpg")!;
assert.deepEqual(photo.candidates, [], "nothing to go on yet");
const bulk = await inbox.matchAllHighConfidencePortable(mina, { societyId: S });
assert.equal(bulk.matched, 2);
box = await inbox.listPortable(mina, { societyId: S });
const matched = box.rows.filter((row) => row.status === "matched");
for (const row of matched) {
  const txn = await db.get(row.matchedTransaction!._id);
  assert.equal(txn?.receiptDocumentId, row.documentId, "the receipt is the inbox document");
  assert.equal(txn?.receiptStatus, "attached", "receipt status follows, as from the transaction panel");
}
await inbox.unmatchPortable(mina, { id: matched[0]._id });
const released = await db.get(matched[0].matchedTransaction!._id);
assert.equal(released?.receiptDocumentId, undefined);
assert.equal(released?.receiptStatus, "missing");
// Typing the details in brings suggestions; confirming one attaches it.
const hydro = box.rows.find((row) => row.fileName.startsWith("coastal-hydro"))!;
const hydroLine = seed.financialTransactions.find((row) => row._id === hydro.candidates[0].transactionId)!;
await inbox.updatePortable(mina, { id: hydro._id, amountCents: Math.abs(Number(hydroLine.amountCents)) });
box = await inbox.listPortable(mina, { societyId: S });
const hydroAfter = box.rows.find((row) => row._id === hydro._id)!;
assert.equal(hydroAfter.candidates[0].confidence, "high", "the amount makes the hydro bill a confident match");
await inbox.confirmMatchPortable(mina, { id: hydro._id, transactionId: hydroAfter.candidates[0].transactionId });
await assert.rejects(inbox.confirmMatchPortable(mina, { id: photo._id, transactionId: hydroAfter.candidates[0].transactionId }), /already has a receipt/);
await inbox.setDiscardedPortable(mina, { id: photo._id, discarded: true });
box = await inbox.listPortable(mina, { societyId: S });
assert.deepEqual(box.counts, { unmatched: 1, matched: 2, discarded: 1 });

// Reconciliation by month: March is open with a difference but every line is
// matched or categorised, so it auto-reconciles in one step.
const year = 2026;
let months = await recon.accountMonthsPortable(mina, { societyId: S, accountId: "static_financial_cash", year, month: "2026-03" });
assert.equal(months.months[2].kind, "difference");
assert.ok(months.detail?.autoReconcile?.ready, "March can be auto-reconciled");
const first = months.detail!.lines[0];
assert.equal(first.balanceCents, months.detail!.openingBalanceCents + first.amountCents, "running balance from the month's opening balance");
assert.equal(months.detail!.lines.at(-1)!.balanceCents, months.detail!.feedEndingBalanceCents);
const result = await recon.autoReconcilePeriodPortable(mina, { id: months.detail!.period!._id });
assert.equal(result.cleared, months.detail!.autoReconcile!.toClearIds.length);
months = await recon.accountMonthsPortable(mina, { societyId: S, accountId: "static_financial_cash", year, month: "2026-03" });
assert.deepEqual([months.months[2].kind, months.months[2].label], ["reconciled", "Auto-reconciled"]);
await assert.rejects(recon.autoReconcilePeriodPortable(mina, { id: months.detail!.period!._id }), /already closed/);
assert.equal(months.months[1].kind, "difference", "February still reads out of balance");

// Add account: a manual account is its own ledger account under the next free code
// (1050 when free; the invoices demo may already hold it for Undeposited funds).
const codesBefore = (await db.query("financialAccounts").collect()).filter((row) => row.societyId === S && row.code).map((row) => String(row.code));
const expectedCode = nextLedgerCode(codesBefore, "payments");
const created = await accounts.createManualAccountPortable(mina, { societyId: S, name: "Stripe balance", kind: "payments", openingBalanceCents: 12_500, openingDate: "2026-04-01", lastFour: "9001" });
assert.equal(created.code, expectedCode);
await assert.rejects(accounts.createManualAccountPortable(mina, { societyId: S, name: "stripe balance", kind: "bank", openingBalanceCents: 0, openingDate: "2026-04-01" }), /already exists/);
let overview = await accounts.overviewPortable(mina, { societyId: S });
const stripe = overview.rows.find((row) => row._id === created.accountId)!;
assert.deepEqual([stripe.source, stripe.kind, stripe.balanceCents, stripe.ledgerAccount?.label, stripe.status], ["manual", "payments", 12_500, `${expectedCode} · Stripe balance`, "not_connected"]);
assert.equal(overview.counts.payments, 1);
assert.equal(overview.counts.manual, 2, "petty cash and the new account");
const periodsAfter = await recon.periodsPortable(mina, { societyId: S });
assert.equal(periodsAfter.accounts.find((row) => row._id === created.accountId)?.suggestedOpeningBalanceCents, 12_500, "the opening balance seeds the first statement");
await accounts.linkLedgerAccountPortable(mina, { id: created.accountId, ledgerAccountId: "static_financial_cash" });
overview = await accounts.overviewPortable(mina, { societyId: S });
assert.equal(overview.rows.find((row) => row._id === created.accountId)?.ledgerAccount?.isSelf, false);
await assert.rejects(accounts.linkLedgerAccountPortable(mina, { id: created.accountId, ledgerAccountId: "static_financial_facilities_expense" }), /bank, credit, asset or liability/, "an expense account is not a ledger account for money");
// Linking moves postings: the account's lines post their cash side to the linked ledger account.
{
  const accounting = await import("../shared/functions/accounting");
  const stripeAccount = (await db.get(created.accountId))!;
  const fee = await db.insert("financialTransactions", { societyId: S, connectionId: stripeAccount.connectionId, accountId: created.accountId, externalId: "stripe-fee-1", date: "2026-04-02", description: "Stripe fee", amountCents: -1_500, category: "Bank fees", accountingAccountId: "static_financial_facilities_expense" });
  await accounting.backfillFinancialTransactionsToJournalPortable(mina, { societyId: S, transactionIds: [fee], includeBeforeOpening: true });
  const posted = await accounting.postedJournalForTransaction(mina, fee);
  const cashLine = posted.lines.find((line) => line.lineOrder === 0)!;
  assert.deepEqual([cashLine.accountId, cashLine.side, cashLine.amountCents], ["static_financial_cash", "credit", 1_500], "the bank line posts to the linked ledger account, not the feed account");
  assert.equal(await accounts.cashLedgerAccountId(mina, S, created.accountId), "static_financial_cash", "bill and invoice payments resolve the same account");
  // One feed per ledger account, and no chains.
  const square = await accounts.createManualAccountPortable(mina, { societyId: S, name: "Square balance", kind: "payments", openingBalanceCents: 0, openingDate: "2026-04-01" });
  await assert.rejects(accounts.linkLedgerAccountPortable(mina, { id: square.accountId, ledgerAccountId: "static_financial_cash" }), /already the ledger account for Stripe balance/);
  await assert.rejects(accounts.linkLedgerAccountPortable(mina, { id: "static_financial_cash", ledgerAccountId: square.accountId }), /Stripe balance posts to this account/);
  await accounts.setArchivedPortable(mina, { id: square.accountId, archived: true });
}
await accounts.updateAccountPortable(mina, { id: created.accountId, name: "Stripe payouts" });
await accounts.setArchivedPortable(mina, { id: created.accountId, archived: true });
overview = await accounts.overviewPortable(mina, { societyId: S });
assert.equal(overview.counts.payments, 0, "archived accounts leave the tabs");
assert.equal(overview.archivedCount, 2, "Stripe, and Square from the link checks");
await assert.rejects(accounts.createManualAccountPortable(jordan, { societyId: S, name: "Nope", kind: "bank", openingBalanceCents: 0, openingDate: "2026-04-01" }), /financials:write/, "read-only finance access can't add accounts");

// Mileage claims are priced at the organisation's rate and need no receipt.
let queue = await exp.approvalQueuePortable(mina, { societyId: S });
assert.equal(queue.claimPolicy.mileageRateCentsPerKm, DEMO_MILEAGE_RATE_CENTS);
const mileageId = await exp.upsertPortable(jordan, {
  societyId: S, claimantName: "Jordan Lee", claimantUserId: "static_user_treasurer", title: "Mileage – supplier pickup", category: "Travel",
  amountCents: 1, currency: "CAD", incurredAtISO: todayDateOnly(), status: "Submitted",
  claimType: "mileage", mileage: { distanceKm: 150, fromLocation: "Hall", toLocation: "Warehouse" },
  spendBudgetId: "static_spend_budget_volunteer_mileage",
});
const mileageRow = await db.get(String(mileageId));
assert.equal(mileageRow?.amountCents, 150 * DEMO_MILEAGE_RATE_CENTS, "the server prices the trip");
queue = await exp.approvalQueuePortable(mina, { societyId: S });
const mileageQueued = queue.rows.find((row) => row._id === String(mileageId))!;
assert.equal(mileageQueued.claimType, "mileage");
assert.deepEqual(mileageQueued.policyIssues.filter((issue) => issue.code === "receipt"), [], "no receipt needed although it is over the receipt threshold");
await exp.saveClaimPolicyPortable(mina, { societyId: S, receiptOverCents: 7_500, noteOverCents: 50_000, maxAgeDays: 60, enforcement: "warn", mileageRateCentsPerKm: 80 });
await exp.upsertPortable(jordan, { id: String(mileageId), societyId: S, claimantName: "Jordan Lee", claimantUserId: "static_user_treasurer", title: "Mileage – supplier pickup", category: "Travel", amountCents: 1, currency: "CAD", incurredAtISO: todayDateOnly(), status: "Submitted", claimType: "mileage", mileage: { distanceKm: 150, fromLocation: "Hall", toLocation: "Warehouse" }, spendBudgetId: "static_spend_budget_volunteer_mileage" });
assert.equal((await db.get(String(mileageId)))?.amountCents, 150 * DEMO_MILEAGE_RATE_CENTS, "an unchanged trip keeps the rate it was claimed at");

// Spend budgets: only assigned claimants can charge a budget; the queue warns when a claim would go over.
await assert.rejects(
  exp.upsertPortable(jordan, { societyId: S, claimantName: "Jordan Lee", claimantUserId: "static_user_treasurer", title: "Paint", category: "Supplies", amountCents: 1_000, currency: "CAD", incurredAtISO: todayDateOnly(), status: "Draft", spendBudgetId: "static_spend_budget_youth_supplies" }),
  /isn't assigned/,
);
const options = await budgets.optionsForClaimPortable(jordan, { societyId: S, claimantUserId: "static_user_treasurer", incurredAtISO: todayDateOnly(), amountCents: 9_500 });
assert.deepEqual(options.map((row) => row.name), ["Finance committee expenses", "Volunteer mileage"], "through the finance committee, and by name");
assert.equal(options[0].exceeds, true, "$95 would take the committee budget over its limit");
const software = queue.rows.find((row) => row.title === "Statement software, annual plan")!;
assert.equal(software.spendBudget?.exceeds, true, "the draft claim is flagged");
const list = await budgets.listPortable(mina, { societyId: S });
const mileageBudget = list.rows.find((row) => row.name === "Volunteer mileage")!;
assert.equal(mileageBudget.spend.spentCents, 2_940 + 1_750 + 150 * DEMO_MILEAGE_RATE_CENTS, "submitted and approved mileage this month; the draft doesn't count");
assert.deepEqual(list.rows.map((row) => row.status).sort(), ["active", "active", "active", "ended", "upcoming"]);
await assert.rejects(budgets.removePortable(mina, { id: "static_spend_budget_finance_committee" }), /Archive it instead/);
// The budget is checked when it (or the claimant) changes, against membership on the day of the expense.
{
  const financeBudget = "static_spend_budget_finance_committee";
  await db.patch("static_committee_member_finance_jordan", { leftAt: "2026-04-01" });
  const claim = { societyId: S, claimantName: "Jordan Lee", claimantUserId: "static_user_treasurer", title: "Statement paper", category: "Supplies", amountCents: 1_200, currency: "CAD", status: "Draft", spendBudgetId: financeBudget };
  const march = await exp.upsertPortable(jordan, { ...claim, incurredAtISO: "2026-03-20" });
  assert.equal((await db.get(String(march)))?.spendBudgetId, financeBudget, "on the committee in March, so March spend may go to its budget");
  await assert.rejects(exp.upsertPortable(jordan, { ...claim, incurredAtISO: todayDateOnly() }), /isn't assigned/, "not after leaving");
  await budgets.setArchivedPortable(mina, { id: financeBudget, archived: true });
  await exp.upsertPortable(jordan, { ...claim, id: String(march), incurredAtISO: "2026-03-20", title: "Statement paper (2 reams)" });
  assert.equal((await db.get(String(march)))?.title, "Statement paper (2 reams)", "an old claim stays editable after its budget is archived and the claimant has left");
  await assert.rejects(exp.upsertPortable(jordan, { ...claim, incurredAtISO: "2026-03-21", spendBudgetId: undefined }).then((id) => exp.upsertPortable(jordan, { ...claim, id: String(id), incurredAtISO: "2026-03-21" })), /archived/, "choosing an archived budget is still refused");
  await budgets.setArchivedPortable(mina, { id: financeBudget, archived: false });
  await db.patch("static_committee_member_finance_jordan", { leftAt: undefined });
  for (const row of (await db.query("expenseReports").collect()).filter((report) => String(report.title).startsWith("Statement paper"))) await db.delete(row._id);
}

// Bank transactions charged to a spend budget, from the transaction panel and the bulk bar.
{
  const youthId = "static_spend_budget_youth_supplies";
  const before = (await budgets.listPortable(mina, { societyId: S })).rows.find((row) => row._id === youthId)!;
  const window = before.spend.window;
  const allTxns = (await db.query("financialTransactions").collect()).filter((row) => row.societyId === S && !row.spendBudgetId);
  const out = allTxns.filter((row) => Number(row.amountCents) < 0 && row.date >= window.start && row.date <= window.end && !row.matchedKind).slice(0, 2);
  const moneyIn = allTxns.find((row) => Number(row.amountCents) > 0 && row.date >= window.start)!;
  const early = allTxns.find((row) => Number(row.amountCents) < 0 && row.date < "2026-01-01")!;
  assert.ok(out.length === 2 && moneyIn && early, "demo lines to charge");
  await hub.updateTransactionPortable(mina, { id: out[0]._id, patch: { spendBudgetId: youthId } });
  let after = (await budgets.listPortable(mina, { societyId: S })).rows.find((row) => row._id === youthId)!;
  assert.equal(after.spend.spentCents - before.spend.spentCents, -Number(out[0].amountCents), "a charged money-out line adds its amount");
  assert.equal(after.spend.bySource.transaction, -Number(out[0].amountCents));
  assert.deepEqual(after.transactions.map((row) => row._id), [out[0]._id], "and is listed on the budget");
  await assert.rejects(hub.updateTransactionPortable(mina, { id: moneyIn._id, patch: { spendBudgetId: youthId } }), /money-out/);
  await assert.rejects(hub.updateTransactionPortable(mina, { id: early._id, patch: { spendBudgetId: youthId } }), /isn't active on the date/);
  await assert.rejects(hub.updateTransactionPortable(mina, { id: out[1]._id, patch: { spendBudgetId: "static_spend_budget_plant_sale" } }), /isn't active on the date/, "an ended budget can't take new spend");
  const bulkCharge = await hub.bulkUpdateTransactionsPortable(mina, { societyId: S, ids: [out[1]._id, moneyIn._id], patch: { spendBudgetId: youthId } });
  assert.deepEqual([bulkCharge.updated, bulkCharge.budgetSkipped], [1, 1], "the bulk bar charges what it can and counts the rest");
  after = (await budgets.listPortable(mina, { societyId: S })).rows.find((row) => row._id === youthId)!;
  assert.equal(after.spend.bySource.transaction, -Number(out[0].amountCents) - Number(out[1].amountCents));
  await hub.restoreTransactionsPortable(mina, { societyId: S, rows: bulkCharge.previous });
  assert.equal((await db.get(out[1]._id))?.spendBudgetId, undefined, "Undo takes the line off the budget");
  await assert.rejects(budgets.removePortable(mina, { id: youthId }), /Archive it instead/, "a budget with bank spend can't be deleted");
  // A claim's payout line, matched to the claim, can't be charged to the claim's budget too.
  const claim = (await db.query("expenseReports").collect()).find((row) => row.spendBudgetId === youthId && ["Submitted", "Approved", "Paid"].includes(String(row.status)))!;
  assert.ok(claim, "a demo claim on the youth budget");
  await db.patch(out[1]._id, { matchedKind: "expenseReport", matchedId: claim._id });
  await assert.rejects(hub.updateTransactionPortable(mina, { id: out[1]._id, patch: { spendBudgetId: youthId } }), /count twice/);
  await db.patch(out[1]._id, { spendBudgetId: youthId });
  after = (await budgets.listPortable(mina, { societyId: S })).rows.find((row) => row._id === youthId)!;
  assert.equal(after.spend.bySource.transaction, -Number(out[0].amountCents), "even when set, the payout line doesn't count again");
  await hub.updateTransactionPortable(mina, { id: out[0]._id, patch: { spendBudgetId: null } });
  assert.equal((await db.get(out[0]._id))?.spendBudgetId, undefined, "null clears the budget");
}

console.log("Banking workflow checks passed: receipt prefill and matching, month strip, running balance and auto-reconcile, Add account, mileage claims and spend budgets (claims and bank transactions).");
