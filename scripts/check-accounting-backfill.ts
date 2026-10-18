/**
 * Gate: "Backfill imports" never misstates the books silently.
 *
 * Reproduces the audit finding on the demo seed (opening balances posted on
 * 2026-01-01; total assets were $76,980 when it was found): the old backfill posted every imported
 * transaction, including those dated in 2025 (already reflected in the opening
 * balances), which moved total assets ($76,980 -> $78,535 on the original
 * fourteen-row seed). It also sent every unmapped row to the first
 * Income/Expense account. The demo now carries a generated bank feed of several
 * hundred rows, so the expected counts are derived from the seeded rows.
 *
 * The backfill now (1) skips transactions dated on or before the opening
 * balances unless explicitly included, and flags them when included; (2) posts
 * unmapped rows to an explicit suspense account, never to an arbitrary
 * income/expense account; (3) honours category choices from the review step.
 */
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { planTransactionBackfill, BEFORE_OPENING_FLAG, SUSPENSE_FLAG } from "../shared/accountingBackfill";
import { transactionLines } from "../shared/transactionLines";

async function demoClient() {
  const client = new StaticConvexClient({ databaseName: `societyer-backfill-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  const [society] = await client.query("society:list", {});
  return { client, societyId: society._id as string };
}

async function totalAssetsCents(client: StaticConvexClient, societyId: string) {
  const trial = await client.query("accounting:trialBalance", { societyId });
  return (trial as any[])
    .filter((row) => ["Asset", "Bank"].includes(row.account?.accountType))
    .reduce((sum, row) => sum + row.balanceCents, 0);
}

// --- Pure planner ---------------------------------------------------------
{
  const accounts = [
    { _id: "cash", code: "1000", name: "Cash", accountType: "Bank" },
    { _id: "rent", code: "5200", name: "Rent", accountType: "Expense" },
    { _id: "income", code: "4000", name: "Donations", accountType: "Income" },
  ];
  const transactions = [
    { _id: "t1", date: "2025-12-31", amountCents: -100, accountId: "cash", category: "Rent", description: "Dec rent" },
    { _id: "t2", date: "2026-01-01", amountCents: -100, accountId: "cash", category: "Rent", description: "Opening-day rent" },
    { _id: "t3", date: "2026-02-01", amountCents: -100, accountId: "cash", category: "Rent", description: "Feb rent" },
    { _id: "t4", date: "2026-02-02", amountCents: 500, accountId: "cash", category: "Gifts", description: "Gift" },
    { _id: "t5", date: "2026-02-03", amountCents: -50, accountId: "missing", category: "Rent", description: "Orphan" },
  ];
  const base = { transactions, accounts, mappings: [{ _id: "m1", status: "active", externalCategory: "rent", financialAccountId: "rent" }], postedTransactionIds: [], openingBalanceDate: "2026-01-01" };
  const plan = planTransactionBackfill(base);
  const byId = Object.fromEntries(plan.rows.map((row) => [row.transactionId, row]));
  assert.equal(byId.t1.status, "before_opening", "a transaction before the opening balances is held back");
  assert.equal(byId.t2.status, "before_opening", "a transaction ON the opening-balance date is held back too");
  assert.equal(byId.t3.status, "post");
  assert.equal(byId.t3.offsetSource, "mapping");
  assert.equal(byId.t3.offsetAccountId, "rent");
  assert.equal(byId.t4.offsetSource, "suspense", "unmapped income goes to suspense, not the first income account");
  assert.notEqual(byId.t4.offsetAccountId, "income");
  assert.equal(byId.t5.status, "no_cash_account");
  assert.equal(plan.summary.toSuspense, 1);
  const noSuspense = planTransactionBackfill({ ...base, useSuspense: false });
  assert.equal(noSuspense.rows.find((row) => row.transactionId === "t4")?.status, "needs_mapping");
  const chosen = planTransactionBackfill({ ...base, categoryChoices: [{ category: "gifts", accountId: "income" }] });
  assert.equal(chosen.rows.find((row) => row.transactionId === "t4")?.offsetSource, "choice");
  assert.equal(chosen.rows.find((row) => row.transactionId === "t4")?.offsetAccountId, "income");
  const included = planTransactionBackfill({ ...base, includeBeforeOpening: true });
  assert.equal(included.summary.beforeOpeningIncluded, 2);
  const already = planTransactionBackfill({ ...base, postedTransactionIds: ["t3"] });
  assert.equal(already.rows.find((row) => row.transactionId === "t3")?.status, "already_posted");
}

// --- Demo seed: the opening-balance cutoff on the generated bank feed --------
// The demo's bank feed (shared/demoData/bankFeed.ts) runs from April 2025 to
// the demo's today, so most of it predates the 2026-01-01 opening balances.
// Expectations are derived from the seeded rows, not hard-coded, because the
// feed grows with the clock; the rules under test are fixed.
const OPENING = "2026-01-01";

async function feedFacts(client: StaticConvexClient, societyId: string) {
  const transactions: any[] = await client.query("financialHub:transactions", { societyId, limit: 10_000 });
  const accounts: any[] = await client.query("financialHub:accounts", { societyId });
  const mappings: any[] = await client.query("accounting:accountMappings", { societyId });
  const ledger: any[] = await client.query("accounting:generalLedger", { societyId });
  const posted = new Set(ledger.map((line) => String(line.financialTransactionId ?? "")).filter(Boolean));
  const assetAccountIds = new Set(accounts.filter((account) => ["Asset", "Bank"].includes(account.accountType)).map((account) => String(account._id)));
  const mappedCategories = new Set(
    mappings.filter((mapping) => mapping.status === "active").map((mapping) => String(mapping.externalCategory ?? mapping.externalAccountName ?? "").trim().toLowerCase()),
  );
  const open = transactions.filter((row) => !posted.has(String(row._id)) && row.amountCents !== 0);
  const preOpening = open.filter((row) => row.date <= OPENING);
  const postOpening = open.filter((row) => row.date > OPENING);
  const assetNet = (rows: any[]) => rows.filter((row) => assetAccountIds.has(String(row.accountId))).reduce((sum, row) => sum + row.amountCents, 0);
  // Each line item posts its own offset line: a split line coded to a ledger
  // account needs no mapping, any other unmapped line goes to suspense.
  const accountIds = new Set(accounts.map((account) => String(account._id)));
  const unmappedLines = (row: any) =>
    transactionLines(row).filter((line) => !(line.accountingAccountId && accountIds.has(String(line.accountingAccountId))) && !mappedCategories.has(String(line.category ?? "").trim().toLowerCase()));
  const postOpeningUnmapped = postOpening.filter((row) => unmappedLines(row).length > 0);
  return {
    transactions,
    posted,
    preOpening,
    postOpening,
    postOpeningUnmapped,
    postOpeningUnmappedLines: postOpeningUnmapped.reduce((sum, row) => sum + unmappedLines(row).length, 0),
    assetNet,
  };
}

{
  const { client, societyId } = await demoClient();
  const before = await totalAssetsCents(client, societyId);
  const facts = await feedFacts(client, societyId);
  // The demo ledger (shared/demoData/journals.ts) carries the $62,400 of cash
  // in the 2026-01-01 opening balances plus every bank line already posted.
  // The invoicing demo is in the books too (shared/demoData/invoiceLedger.ts):
  // what posted invoices still owe sits in Accounts receivable, and payments
  // not linked to a bank deposit sit in Undeposited funds.
  type InvoicePayment = { journalEntryId?: string; financialTransactionId?: string; amountCents: number };
  type InvoiceFacts = { invoices: Array<{ journalEntryId?: string; lifecycle: string; balanceCents: number; payments: InvoicePayment[] }> };
  const invoices = (await client.query("invoices:workspace", { societyId })) as InvoiceFacts;
  const postedInvoices = invoices.invoices.filter((row) => row.journalEntryId && row.lifecycle === "sent");
  const receivable = postedInvoices.reduce((sum, row) => sum + row.balanceCents, 0);
  const undeposited = postedInvoices.flatMap((row) => row.payments).filter((payment) => payment.journalEntryId && !payment.financialTransactionId).reduce((sum, payment) => sum + payment.amountCents, 0);
  assert.ok(receivable > 0 && undeposited > 0, "the invoicing demo leaves receivables and undeposited payments in the books");
  assert.equal(before, 6_240_000 + facts.assetNet(facts.transactions.filter((row) => facts.posted.has(String(row._id)))) + receivable + undeposited, "demo seed starts at the opening balances plus the posted bank lines and the invoices' receivables");
  assert.ok(facts.transactions.length >= 400, `the demo bank feed is dense (${facts.transactions.length} rows)`);
  assert.ok(facts.preOpening.length >= 100, "a year of 2025 imports predates the opening balances");
  assert.ok(facts.postOpening.length > 0 && facts.postOpeningUnmapped.length > 0, "2026 imports include unmapped categories");

  const preview: any = await client.query("accounting:backfillPreview", { societyId });
  assert.equal(preview.openingBalanceDate, OPENING);
  assert.equal(preview.summary.beforeOpening, facts.preOpening.length, "every import dated on or before the opening balances is held back");
  assert.equal(preview.summary.toPost, facts.postOpening.length);
  assert.equal(preview.summary.toSuspense, facts.postOpeningUnmapped.length, "unmapped 2026 imports are routed to suspense");
  assert.ok(preview.summary.alreadyPosted >= 2, "rows already in the journal are recognised");
  const accounts: any[] = await client.query("accounting:chartAccounts", { societyId });
  const equipment = accounts.find((account) => account.code === "5500");
  assert.ok(equipment);
  assert.ok(!preview.rows.some((row: any) => row.offsetAccountId === equipment._id), "nothing falls back to 5500 Equipment and technology");

  const result: any = await client.mutation("accounting:backfillFinancialTransactionsToJournal", { societyId, limit: 10_000 });
  assert.equal(result.posted, facts.postOpening.length);
  assert.equal(result.postedToSuspense, facts.postOpeningUnmapped.length);
  assert.equal(result.skippedBeforeOpening, facts.preOpening.length);
  assert.equal(result.flaggedBeforeOpening, 0);
  const after = await totalAssetsCents(client, societyId);
  assert.equal(after, before + facts.assetNet(facts.postOpening), "only post-opening activity changes the balance sheet");
  assert.notEqual(after, before + facts.assetNet([...facts.preOpening, ...facts.postOpening]), "the pre-opening drift does not recur");
  const chart: any[] = await client.query("accounting:chartAccounts", { societyId });
  const suspense = chart.find((account) => account.code === "2999");
  assert.ok(suspense && suspense.subtype === "suspense", "an explicit suspense account is created");
  const ledger: any[] = await client.query("accounting:generalLedger", { societyId });
  assert.ok(!ledger.some((line) => line.accountId === equipment._id), "no line was posted to the old fallback account");
  assert.equal(ledger.filter((line) => line.accountId === suspense._id).length, facts.postOpeningUnmappedLines, "one suspense line per unmapped line item");
  const entries: any[] = await client.query("accounting:journalEntries", { societyId, limit: 10_000 });
  assert.equal(entries.filter((entry) => entry.reviewFlags?.includes(SUSPENSE_FLAG)).length, facts.postOpeningUnmapped.length);

  const rerun: any = await client.mutation("accounting:backfillFinancialTransactionsToJournal", { societyId, limit: 10_000 });
  assert.equal(rerun.posted, 0, "backfill stays idempotent");
}

{
  // Explicitly including pre-opening rows reproduces the drift, and every such
  // entry is flagged rather than silently posted.
  const { client, societyId } = await demoClient();
  const before = await totalAssetsCents(client, societyId);
  const facts = await feedFacts(client, societyId);
  const accounts: any[] = await client.query("accounting:chartAccounts", { societyId });
  const programExpense = accounts.find((account) => account.code === "5000");
  const choice = [{ category: "Program delivery", accountId: programExpense._id }];
  const preview: any = await client.query("accounting:backfillPreview", { societyId, includeBeforeOpening: true, categoryChoices: choice });
  const delivery = preview.rows.find((row: any) => row.category === "Program delivery");
  assert.equal(delivery.offsetSource, "choice");
  assert.equal(delivery.offsetAccountId, programExpense._id);
  const result: any = await client.mutation("accounting:backfillFinancialTransactionsToJournal", {
    societyId,
    includeBeforeOpening: true,
    categoryChoices: choice,
    rememberMappings: true,
    limit: 10_000,
  });
  assert.equal(result.posted, facts.preOpening.length + facts.postOpening.length);
  assert.equal(result.flaggedBeforeOpening, facts.preOpening.length);
  assert.equal(result.mappingsSaved, 1);
  assert.equal(
    await totalAssetsCents(client, societyId),
    before + facts.assetNet([...facts.preOpening, ...facts.postOpening]),
    "including pre-opening rows reproduces the drift",
  );
  const entries: any[] = await client.query("accounting:journalEntries", { societyId, limit: 10_000 });
  const flagged = entries.filter((entry) => entry.reviewFlags?.includes(BEFORE_OPENING_FLAG));
  assert.equal(flagged.length, facts.preOpening.length);
  assert.ok(flagged.every((entry) => entry.memo.startsWith(`[Before opening balances ${OPENING}]`)));
  const mappings: any[] = await client.query("accounting:accountMappings", { societyId });
  assert.ok(mappings.some((mapping) => mapping.externalCategory === "Program delivery" && mapping.financialAccountId === programExpense._id));
}

console.log("Accounting backfill checks passed: opening-balance cutoff, suspense routing, review choices, idempotency.");
process.exit(0);
