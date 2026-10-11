/**
 * Gate: "Backfill imports" never misstates the books silently.
 *
 * Reproduces the audit finding on the demo seed (opening balances posted on
 * 2026-01-01, total assets $76,980): the old backfill posted fourteen imported
 * transactions, eleven of them dated in 2025 (already reflected in the opening
 * balances), and moved total assets to $78,535. It also sent every unmapped
 * row to the first Income/Expense account.
 *
 * The backfill now (1) skips transactions dated on or before the opening
 * balances unless explicitly included, and flags them when included; (2) posts
 * unmapped rows to an explicit suspense account, never to an arbitrary
 * income/expense account; (3) honours category choices from the review step.
 */
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { planTransactionBackfill, BEFORE_OPENING_FLAG, SUSPENSE_FLAG } from "../shared/accountingBackfill";

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

// --- Demo seed: reproduce the $76,980 -> $78,535 drift and prove it is gone ---
{
  const { client, societyId } = await demoClient();
  const before = await totalAssetsCents(client, societyId);
  assert.equal(before, 7_698_000, "demo seed starts at total assets $76,980");

  const preview: any = await client.query("accounting:backfillPreview", { societyId });
  assert.equal(preview.openingBalanceDate, "2026-01-01");
  assert.equal(preview.summary.beforeOpening, 11, "eleven 2025 imports predate the opening balances");
  assert.equal(preview.summary.toPost, 3);
  assert.equal(preview.summary.toSuspense, 3, "unmapped 2026 imports are routed to suspense");
  const accounts: any[] = await client.query("accounting:chartAccounts", { societyId });
  const equipment = accounts.find((account) => account.code === "5500");
  assert.ok(equipment);
  assert.ok(!preview.rows.some((row: any) => row.offsetAccountId === equipment._id), "nothing falls back to 5500 Equipment and technology");

  const result: any = await client.mutation("accounting:backfillFinancialTransactionsToJournal", { societyId });
  assert.equal(result.posted, 3);
  assert.equal(result.postedToSuspense, 3);
  assert.equal(result.skippedBeforeOpening, 11);
  assert.equal(result.flaggedBeforeOpening, 0);
  const after = await totalAssetsCents(client, societyId);
  const net2026 = preview.rows.filter((row: any) => row.status === "post").reduce((sum: number, row: any) => sum + row.amountCents, 0);
  assert.equal(net2026, -457_500);
  assert.equal(after, before + net2026, "only post-opening activity changes the balance sheet");
  assert.notEqual(after, 7_853_500, "the audited $78,535 drift does not recur");
  const chart: any[] = await client.query("accounting:chartAccounts", { societyId });
  const suspense = chart.find((account) => account.code === "2999");
  assert.ok(suspense && suspense.subtype === "suspense", "an explicit suspense account is created");
  const ledger: any[] = await client.query("accounting:generalLedger", { societyId });
  assert.ok(!ledger.some((line) => line.accountId === equipment._id), "no line was posted to the old fallback account");
  assert.equal(ledger.filter((line) => line.accountId === suspense._id).length, 3);
  const entries: any[] = await client.query("accounting:journalEntries", { societyId });
  assert.equal(entries.filter((entry) => entry.reviewFlags?.includes(SUSPENSE_FLAG)).length, 3);

  const rerun: any = await client.mutation("accounting:backfillFinancialTransactionsToJournal", { societyId });
  assert.equal(rerun.posted, 0, "backfill stays idempotent");
}

{
  // Explicitly including pre-opening rows reproduces the audited figure, and
  // every such entry is flagged rather than silently posted.
  const { client, societyId } = await demoClient();
  const accounts: any[] = await client.query("accounting:chartAccounts", { societyId });
  const facilities = accounts.find((account) => account.code === "5200");
  const preview: any = await client.query("accounting:backfillPreview", {
    societyId,
    includeBeforeOpening: true,
    categoryChoices: [{ category: "Utilities", accountId: facilities._id }],
  });
  const utilities = preview.rows.find((row: any) => row.category === "Utilities");
  assert.equal(utilities.offsetSource, "choice");
  assert.equal(utilities.offsetAccountId, facilities._id);
  const result: any = await client.mutation("accounting:backfillFinancialTransactionsToJournal", {
    societyId,
    includeBeforeOpening: true,
    categoryChoices: [{ category: "Utilities", accountId: facilities._id }],
    rememberMappings: true,
  });
  assert.equal(result.posted, 14);
  assert.equal(result.flaggedBeforeOpening, 11);
  assert.equal(result.mappingsSaved, 1);
  assert.equal(await totalAssetsCents(client, societyId), 7_853_500, "including pre-opening rows reproduces the audited $78,535");
  const entries: any[] = await client.query("accounting:journalEntries", { societyId, limit: 200 });
  const flagged = entries.filter((entry) => entry.reviewFlags?.includes(BEFORE_OPENING_FLAG));
  assert.equal(flagged.length, 11);
  assert.ok(flagged.every((entry) => entry.memo.startsWith("[Before opening balances 2026-01-01]")));
  const mappings: any[] = await client.query("accounting:accountMappings", { societyId });
  assert.ok(mappings.some((mapping) => mapping.externalCategory === "Utilities" && mapping.financialAccountId === facilities._id));
}

console.log("Accounting backfill checks passed: opening-balance cutoff, suspense routing, review choices, idempotency.");
process.exit(0);
