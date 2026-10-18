// Invoices-in-the-books gate (npm run test:invoices runs it after
// check-invoices.ts): the accrual (balanced, with tax, discount and tags),
// payment and cash-basis postings, mapping resolution and each "needs action"
// flag as pure helpers, then the portable handlers on the demo seed: the
// seeded invoices are already posted (so "Post existing invoices" finds
// nothing), sending posts, payments post and link deposits (matched and
// categorised to Accounts receivable, put back on removal), voiding reverses,
// restoring re-posts under a new key, postings are idempotent, closed fiscal
// periods and closed books refuse, and the mapping drawer's save resolves.
import assert from "node:assert/strict";
import { computeInvoiceTotals, type InvoiceLine } from "../shared/invoicing";
import {
  INVOICE_POSTINGS,
  accrualKey,
  accrualPostingLines,
  cashBasisPostingLines,
  foreignCurrencySummary,
  invoiceNeedsAction,
  isBeforeBooksStart,
  ledgerBalance,
  mirrorLines,
  paymentPostingLines,
  resolveLineRevenue,
  unrecognisedInvoiceRevenue,
  type InvoiceLedgerLine,
  type NeedsActionInput,
} from "../shared/invoiceLedger";
import { journalBasisOf } from "../shared/booksReports";
import type { PortableDoc, PortableMutationCtx } from "../shared/portable/ctx";

const line = (item: string, quantity: number, unitPriceCents: number, extra: Partial<InvoiceLine> = {}): InvoiceLine => ({ key: `${item}-${quantity}`, item, quantity, unitPriceCents, ...extra });
const net = (lines: ReadonlyArray<{ accountId: string; side: string; amountCents: number }>) => {
  const byAccount = new Map<string, number>();
  for (const row of lines) byAccount.set(row.accountId, (byAccount.get(row.accountId) ?? 0) + (row.side === "debit" ? row.amountCents : -row.amountCents));
  return byAccount;
};

// ---- the accrual: balanced with tax and a discount; tags follow the revenue line
{
  const invoice = {
    number: "INV-0001",
    billToName: "Westside Yoga",
    lines: [line("Hall", 1, 30000, { taxRatePercent: 5, taxLabel: "GST", tagIds: ["tag_event"] }), line("Workshop", 2, 5000), line("Free", 1, 0)],
    discount: { kind: "percent" as const, value: 10 },
  };
  const accounts: Record<string, string> = { Hall: "rev_rental", Workshop: "rev_program", Free: "rev_program" };
  const lines = accrualPostingLines(invoice, (row) => accounts[row.item], { receivableAccountId: "ar", taxPayableAccountId: "gst" });
  const totals = computeInvoiceTotals(invoice.lines, invoice.discount);
  assert.equal(totals.totalCents, 40000 - 4000 + 1350);
  assert.deepEqual(lines.map((row) => [row.accountId, row.side, row.amountCents]), [["ar", "debit", 37350], ["rev_rental", "credit", 27000], ["rev_program", "credit", 9000], ["gst", "credit", 1350]], "Dr AR total / Cr revenue net of the discount share / Cr GST; the zero line is left out");
  assert.deepEqual(ledgerBalance(lines), { debitCents: 37350, creditCents: 37350, balanced: true });
  assert.deepEqual(lines[1].tagIds, ["tag_event"], "the line's tags go onto its revenue line");
  assert.equal(lines[0].tagIds, undefined, "the receivable line carries no tags");
  assert.throws(() => accrualPostingLines(invoice, (row) => (row.item === "Workshop" ? null : accounts[row.item]), { receivableAccountId: "ar", taxPayableAccountId: "gst" }), /Workshop\) has no revenue account/);
  assert.throws(() => accrualPostingLines({ ...invoice, lines: [line("Hall", 1, 100, { taxRatePercent: 5, taxLabel: "GST" })] }, () => "rev", { receivableAccountId: "ar" }), /sales tax/);
  // The reversal nets every account to zero.
  assert.ok([...net([...lines, ...mirrorLines(lines)]).values()].every((value) => value === 0));

  // Payments: Dr deposit / Cr AR, linked bank line on both lines.
  const payment = paymentPostingLines({ amountCents: 20000, financialTransactionId: "txn_1", reference: "E-transfer" }, { depositAccountId: "bank", receivableAccountId: "ar" });
  assert.deepEqual(payment.map((row) => [row.accountId, row.side, row.amountCents, row.financialTransactionId]), [["bank", "debit", 20000, "txn_1"], ["ar", "credit", 20000, "txn_1"]]);

  // Cash basis: partial payments recognise the paid share; together they equal the accrual's credits.
  const first = cashBasisPostingLines(lines, { paymentCents: 12345, receivableAccountId: "ar" });
  const second = cashBasisPostingLines(lines, { paymentCents: 25005, receivableAccountId: "ar", recognised: first });
  assert.ok(ledgerBalance(first).balanced && ledgerBalance(second).balanced);
  assert.equal(first[0].amountCents, 12345, "the receivable is debited for exactly the payment");
  const recognised = net([...first, ...second].filter((row) => row.side === "credit"));
  assert.deepEqual([...recognised.entries()].sort(), [["gst", -1350], ["rev_program", -9000], ["rev_rental", -27000]], "once paid, cash-basis revenue and tax equal the accrual");
  assert.equal(first.find((row) => row.accountId === "rev_rental")?.tagIds?.[0], "tag_event", "tags follow onto the cash-basis line");
  assert.deepEqual(cashBasisPostingLines(lines, { paymentCents: 500, receivableAccountId: "ar", recognised: [...first, ...second] }), [], "an overpayment recognises no revenue");
  // Under accrual reports the cash-basis entry drops out, and vice versa.
  assert.equal(journalBasisOf({ source: INVOICE_POSTINGS.accrual.source }), "accrual-only");
  assert.equal(journalBasisOf({ source: INVOICE_POSTINGS.accrualReversal.source }), "accrual-only");
  assert.equal(journalBasisOf({ source: INVOICE_POSTINGS.cashBasis.source }), "cash-only");
  assert.equal(journalBasisOf({ source: INVOICE_POSTINGS.payment.source }), "both");
  for (const posting of Object.values(INVOICE_POSTINGS)) assert.equal(journalBasisOf({ source: posting.source }), posting.basis, `${posting.source} falls back to its basis`);
}

// ---- cash basis over what's still unrecognised: never past the payment or the accrual
{
  const gst = { taxRatePercent: 5, taxLabel: "GST" };
  const invoice = { number: "INV-0002", billToName: "Rounding Co", lines: [line("A", 1, 20000, gst), line("B", 1, 12500, gst), line("C", 1, 100, gst)] };
  const accounts: Record<string, string> = { A: "rev_a", B: "rev_b", C: "rev_c" };
  const accrual = accrualPostingLines(invoice, (row) => accounts[row.item], { receivableAccountId: "ar", taxPayableAccountId: "gst" });
  assert.equal(accrual[0].amountCents, 34230, "$326 plus $16.30 GST");
  const recognised: InvoiceLedgerLine[] = [];
  const entries: InvoiceLedgerLine[][] = [];
  for (const paymentCents of [32300, 100, 1830]) {
    const posting = cashBasisPostingLines(accrual, { paymentCents, receivableAccountId: "ar", recognised });
    assert.ok(ledgerBalance(posting).balanced, "each recognition balances");
    assert.equal(posting[0].amountCents, paymentCents, "Dr AR is exactly the payment, never more");
    entries.push(posting);
    recognised.push(...posting);
  }
  const accrualNet = net(accrual.slice(1));
  const recognisedNet = net(recognised.filter((row) => row.accountId !== "ar"));
  assert.deepEqual([...recognisedNet.entries()].sort(), [...accrualNet.entries()].sort(), "paid in full, every line is recognised exactly once");
  // Removing the $1 payment puts exactly its share back, and paying it again takes that remainder.
  const others = [...entries[0], ...entries[2]];
  const remaining = unrecognisedInvoiceRevenue(accrual, others, "ar");
  const middle = net(entries[1].filter((row) => row.accountId !== "ar"));
  for (const bucket of remaining) assert.equal(bucket.remainingCents, 0 - (middle.get(bucket.accountId) ?? 0), `${bucket.accountId} gets the removed payment's share back`);
  const again = cashBasisPostingLines(accrual, { paymentCents: 100, receivableAccountId: "ar", recognised: others });
  assert.deepEqual(net(again.slice(1)), middle, "the repaid share takes the exact remainder");
}

// ---- negative lines net per account: revenue and tax both come down, and the cash basis recognises them
{
  const gst = { taxRatePercent: 5, taxLabel: "GST" };
  const invoice = {
    number: "INV-0003",
    billToName: "Credit Co",
    lines: [line("Hall", 1, 30000, { ...gst, tagIds: ["tag_event"] }), line("Hall refund", 1, -5000, { ...gst, tagIds: ["tag_event"] }), line("Workshop", 1, 4000), line("Goodwill credit", 1, -2000, gst)],
  };
  const accounts: Record<string, string> = { Hall: "rev_rental", "Hall refund": "rev_rental", Workshop: "rev_program", "Goodwill credit": "rev_credits" };
  const accrual = accrualPostingLines(invoice, (row) => accounts[row.item], { receivableAccountId: "ar", taxPayableAccountId: "gst" });
  assert.deepEqual(
    accrual.map((row) => [row.accountId, row.side, row.amountCents]),
    [["ar", "debit", 28150], ["rev_rental", "credit", 25000], ["rev_program", "credit", 4000], ["rev_credits", "debit", 2000], ["gst", "credit", 1150]],
    "the refund nets against its revenue, a net credit posts as a debit, and GST is on the net",
  );
  assert.ok(ledgerBalance(accrual).balanced);
  const onlyNegativeTaxed = accrualPostingLines({ number: "INV-0004", billToName: "X", lines: [line("Room", 1, 10000), line("Discount", 1, -1000, gst)] }, () => "rev", { receivableAccountId: "ar", taxPayableAccountId: "gst" });
  assert.deepEqual(onlyNegativeTaxed.map((row) => [row.accountId, row.side, row.amountCents]), [["ar", "debit", 8950], ["rev", "credit", 9000], ["gst", "debit", 50]], "a negative line's tax alone posts as a debit, not a negative credit");
  const first = cashBasisPostingLines(accrual, { paymentCents: 10000, receivableAccountId: "ar" });
  const rest = cashBasisPostingLines(accrual, { paymentCents: 18150, receivableAccountId: "ar", recognised: first });
  assert.ok(ledgerBalance(first).balanced && ledgerBalance(rest).balanced);
  assert.ok(first.some((row) => row.accountId === "rev_credits" && row.side === "debit"), "the cash basis recognises the debit line too");
  assert.deepEqual([...net([...first, ...rest].filter((row) => row.accountId !== "ar")).entries()].sort(), [...net(accrual.slice(1)).entries()].sort(), "paid in full, the cash basis equals the netted accrual, GST included");
}

// ---- mapping resolution: item, then category, then default; gone accounts are skipped
{
  const catalogById = new Map([
    ["item_hall", { _id: "item_hall", category: "Rental income", accountingAccountId: "rev_hall" }],
    ["item_room", { _id: "item_room", category: "Rental income" }],
    ["item_gone", { _id: "item_gone", category: "Other", accountingAccountId: "deleted" }],
  ]);
  const mapping = { defaultRevenueAccountId: "rev_default", categoryAccounts: [{ category: "rental INCOME ", accountId: "rev_rental" }, { category: "Membership fees", accountId: "rev_dues" }] };
  const accountIds = new Set(["rev_hall", "rev_rental", "rev_default", "rev_dues"]);
  const resolve = (row: Partial<InvoiceLine>, invoiceSource?: string) => resolveLineRevenue(row, { mapping, catalogById, accountIds, invoiceSource });
  assert.deepEqual(resolve({ catalogItemId: "item_hall" }), { accountId: "rev_hall", via: "item" });
  assert.deepEqual(resolve({ catalogItemId: "item_room" }), { accountId: "rev_rental", via: "category" }, "categories match case- and space-insensitively");
  assert.deepEqual(resolve({ catalogItemId: "item_gone" }), { accountId: "rev_default", via: "default" }, "a deleted account falls through to the default");
  assert.deepEqual(resolve({}, "dues"), { accountId: "rev_dues", via: "category" }, "dues invoices map through Membership fees");
  assert.deepEqual(resolve({}), { accountId: "rev_default", via: "default" });
  assert.equal(resolveLineRevenue({}, { mapping: {}, catalogById, accountIds }), null);
}

// ---- needs action: each flag, with its fix
{
  const booksStart = { openingBalanceDate: "2026-01-01", booksStartDate: "2026-01-01" };
  assert.ok(isBeforeBooksStart("2026-01-01", booksStart), "the opening-balance date itself is in the opening balances");
  assert.ok(!isBeforeBooksStart("2026-01-02", booksStart));
  assert.ok(isBeforeBooksStart("2025-12-31", { openingBalanceDate: null, booksStartDate: "2026-01-01" }) && !isBeforeBooksStart("2026-01-01", { openingBalanceDate: null, booksStartDate: "2026-01-01" }));
  const base: NeedsActionInput = { lifecycle: "sent", totalCents: 10000, paidCents: 10000, currency: "CAD", issueDate: "2026-04-01", payments: [{ key: "p1", date: "2026-04-10", amountCents: 10000, financialTransactionId: "t1", transactionAmountCents: 10000 }], unmappedItems: [] };
  const flags = (input: Partial<NeedsActionInput>) => invoiceNeedsAction({ ...base, ...input }, { workspaceCurrency: "CAD", booksStart }).map((flag) => [flag.code, flag.fix]);
  assert.deepEqual(flags({}), [], "a paid invoice with a matching linked deposit needs nothing");
  assert.deepEqual(flags({ lifecycle: "draft", currency: "USD" }), [], "drafts are not flagged");
  assert.deepEqual(flags({ paidCents: 12000, payments: [...base.payments, { key: "p2", date: "2026-04-11", amountCents: 2000, financialTransactionId: "t2", transactionAmountCents: 2000 }] }), [["overpaid", "review_payments"]]);
  assert.deepEqual(flags({ payments: [{ key: "p1", date: "2026-04-10", amountCents: 10000 }] }), [["deposit_unlinked", "link_deposit"]]);
  assert.deepEqual(flags({ payments: [{ ...base.payments[0], transactionAmountCents: 9000 }] }), [["deposit_mismatch", "link_deposit"]]);
  assert.deepEqual(flags({ payments: [{ ...base.payments[0], transactionAmountCents: null }] }), [["deposit_mismatch", "link_deposit"]], "a link to a deleted bank line");
  assert.deepEqual(flags({ unmappedItems: ["Hall rental"] }), [["unmapped_revenue", "edit_mapping"]]);
  assert.deepEqual(flags({ issueDate: "2025-12-01" }), [["before_books_start", "record_manually"]]);
  assert.deepEqual(flags({ issueDate: "2025-12-20", payments: [{ ...base.payments[0], date: "2025-12-30" }] }), [["before_books_start", "record_manually"]], "one flag when the invoice itself predates the books");
  assert.deepEqual(flags({ issueDate: "2026-01-02", payments: [{ ...base.payments[0], date: "2026-01-01" }] }), [["before_books_start", "review_payments"]]);
  assert.deepEqual(flags({ currency: "usd" }), [["foreign_currency", "record_manually"]]);
  assert.deepEqual(foreignCurrencySummary([{ lifecycle: "sent", currency: "USD" }, { lifecycle: "void", currency: "EUR" }, { lifecycle: "draft", currency: "usd" }, { lifecycle: "sent", currency: "CAD" }], "CAD"), { count: 2, currencies: ["USD"] }, "the banner counts non-void invoices in another currency");
}

// ---- portable handlers on the demo seed
const { tables, society } = await import("../src/lib/staticConvexFixtures");
const { MemoryDb } = await import("../shared/portable/memoryDb");
const { makeCapabilities } = await import("../shared/portable/capabilities");
const inv = await import("../shared/functions/invoices");

type Row = PortableDoc;
const seed: Record<string, Row[]> = {};
for (const [key, rows] of Object.entries(tables as Record<string, Row[]>)) seed[key] = JSON.parse(JSON.stringify(rows));
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
seed.societies = [JSON.parse(JSON.stringify(society))];
const db = new MemoryDb({ seed });
const owner = seed.users.find((user) => user.role === "Owner")!;
const S = String(owner.societyId);
const ctx: PortableMutationCtx = {
  db,
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${owner._id}`, issuer: "https://issuer.test", userId: owner._id, societyId: S },
  capabilities: makeCapabilities({}),
  runQuery: async () => { throw new Error("nested"); },
  runMutation: async () => { throw new Error("nested"); },
};
const AR = "static_financial_ar";
const GST = "static_financial_gst_payable";
const UNDEPOSITED = "static_financial_undeposited";
const CASH = "static_financial_cash";
const DUES = "static_financial_ledger_dues";
const PROGRAM = "static_financial_ledger_programFees";
const OTHER = "static_financial_ledger_otherIncome";
const get = async (id: string) => (await db.get(id))!;
const workspace = () => inv.workspacePortable(ctx, { societyId: S });
const invoiceRow = async (id: string) => (await workspace()).invoices.find((row) => row._id === id)!;
type EntryRow = { _id: string; societyId: string; source: string; sourceExternalId?: string; basis?: string; status: string; date: string };
type LineRow = { _id: string; journalEntryId: string; accountId: string; side: string; amountCents: number; lineOrder: number; tagIds?: string[]; financialTransactionId?: string };
const entries = async () => (await db.query<EntryRow>("journalEntries").collect()).filter((entry) => entry.societyId === S);
const allLines = async () => db.query<LineRow>("journalLines").collect();
const linesOf = async (entryId: string) => (await allLines()).filter((row) => row.journalEntryId === entryId).sort((a, b) => a.lineOrder - b.lineOrder);
/** Debits minus credits on posted entries of one basis family (accrual books leave cash-only entries out). */
const balance = async (accountId: string, basis: "accrual" | "cash" = "accrual") => {
  const counted = new Set((await entries()).filter((entry) => entry.status === "posted" && journalBasisOf(entry) !== (basis === "accrual" ? "cash-only" : "accrual-only")).map((entry) => entry._id));
  return (await allLines()).filter((row) => row.accountId === accountId && counted.has(row.journalEntryId)).reduce((sum, row) => sum + (row.side === "debit" ? row.amountCents : -row.amountCents), 0);
};
const owedInBooks = async () => (await workspace()).invoices.filter((row) => row.ledger.state === "posted" || row.ledger.state === "ready").filter((row) => row.journalEntryId && row.lifecycle === "sent").reduce((sum, row) => sum + row.balanceCents, 0);

let ws = await workspace();
const today = ws.today;

// The seeded invoices are in the books, and the books agree with them.
const invoiceEntries = (await entries()).filter((entry) => String(entry.source).startsWith("invoice"));
assert.ok(invoiceEntries.length > 30, "the demo invoices posted their accruals and payments");
for (const entry of invoiceEntries) {
  assert.ok(ledgerBalance(await linesOf(entry._id)).balanced, `${entry.sourceExternalId} balances`);
  assert.equal(entry.basis, Object.values(INVOICE_POSTINGS).find((posting) => posting.source === entry.source)?.basis, `${entry.source} carries its basis`);
  assert.ok(String(entry.sourceExternalId).startsWith("invoice:"), "every invoice posting is keyed by its invoice");
}
assert.ok(ws.invoices.filter((row) => row.lifecycle === "sent").every((row) => row.ledger.state === "posted"), "every sent demo invoice is in the books");
assert.equal(await balance(AR), await owedInBooks(), "Accounts receivable equals what the invoices say is owed");
assert.equal(await balance(AR, "cash"), 0, "on the cash basis receivables net to zero");
assert.ok((await balance(GST)) < 0, "GST collected sits in GST/HST payable");
const preview = await inv.postingPreviewPortable(ctx, { societyId: S });
assert.deepEqual([preview.invoiceCount, preview.paymentCount, preview.blocked.length], [0, 0, 0], "Post existing invoices finds nothing left on the demo");
assert.deepEqual(await inv.postExistingPortable(ctx, { societyId: S }), { postedInvoices: 0, postedCents: 0, postedPayments: 0, blocked: 0, failed: [] }, "and running it posts nothing");
assert.equal(ws.settings.depositAccountId, UNDEPOSITED);
assert.ok(ws.ledger.accounts.revenue.some((account) => account._id === DUES) && ws.ledger.accounts.deposit.some((account) => account._id === UNDEPOSITED));
const flagged = ws.invoices.filter((row) => row.needsAction.some((flag) => flag.code === "deposit_unlinked"));
assert.ok(flagged.length > 0 && flagged.every((row) => row.status === "paid"), "paid demo invoices without a linked deposit need action");
assert.equal(ws.summary.needsActionCount, ws.invoices.filter((row) => row.needsAction.length).length);
const linkedDeposit = await get("static_tx_invoice_hannah");
assert.deepEqual([linkedDeposit.matchedKind, linkedDeposit.accountingAccountId, linkedDeposit.category], ["invoice", AR, "Accounts receivable"], "a linked demo deposit is matched and categorised to receivables");

// Sending posts: tax, a tag, a category mapping and the default.
const tag = (await db.query("financeTags").collect()).find((row) => row.societyId === S && !row.archivedAtISO)!;
const hall = ws.catalog.find((item) => item.name.startsWith("Main hall"))!;
const id = await inv.upsertPortable(ctx, {
  societyId: S, partyKind: "custom", billToName: "Ledger Test Party", issueDate: today, terms: "net_15",
  lines: [{ item: hall.name, catalogItemId: hall._id, quantity: 1, unitPriceCents: 45000, taxRatePercent: 5, taxLabel: "GST", tagIds: [tag._id] }, { item: "Coffee service", quantity: 3, unitPriceCents: 1000 }],
});
await assert.rejects(() => inv.upsertPortable(ctx, { societyId: S, partyKind: "custom", billToName: "X", issueDate: today, terms: "net_15", lines: [{ item: "A", quantity: 1, unitPriceCents: 100, tagIds: ["no_such_tag"] }] }), /no longer exists/);
let row = await invoiceRow(id);
assert.equal(row.ledger.state, "none", "a draft is not in the books");
let sent = await inv.markSentPortable(ctx, { societyId: S, ids: [id] });
assert.equal(sent.posted, 1);
row = await invoiceRow(id);
const accrual = await get(row.journalEntryId);
assert.deepEqual([accrual.source, accrual.basis, accrual.sourceExternalId, accrual.date], ["invoice", "accrual-only", accrualKey(id), today]);
let lines = await linesOf(accrual._id);
assert.deepEqual(lines.map((item) => [item.accountId, item.side, item.amountCents]), [[AR, "debit", 50250], [OTHER, "credit", 45000], [PROGRAM, "credit", 3000], [GST, "credit", 2250]], "hall rental via its category, coffee via the default, GST to payable");
assert.deepEqual(lines[1].tagIds, [tag._id], "the line's tag is on its journal line");
await inv.markSentPortable(ctx, { societyId: S, ids: [id] });
assert.equal((await entries()).filter((entry) => entry.sourceExternalId === accrualKey(id)).length, 1, "sending again posts nothing");

// Editing a posted invoice rewrites its entry in place.
await inv.upsertPortable(ctx, { id, societyId: S, partyKind: "custom", billToName: "Ledger Test Party", issueDate: today, terms: "net_15", lines: [{ item: hall.name, catalogItemId: hall._id, quantity: 1, unitPriceCents: 45000, taxRatePercent: 5, taxLabel: "GST", tagIds: [tag._id] }, { item: "Coffee service", quantity: 4, unitPriceCents: 1000 }] });
assert.equal((await invoiceRow(id)).journalEntryId, accrual._id, "same entry");
assert.equal((await linesOf(accrual._id))[0].amountCents, 51250, "with the new total");

// Payments: unlinked goes to Undeposited funds, with the cash-basis share.
const undepositedBefore = await balance(UNDEPOSITED);
const arBefore = await balance(AR);
const firstKey = await inv.recordPaymentPortable(ctx, { id, date: today, amountCents: 20000, method: "cheque", reference: "Cheque 77" });
row = await invoiceRow(id);
const first = row.payments.find((payment) => payment.key === firstKey)!;
assert.deepEqual([(await get(first.journalEntryId!)).basis, (await get(first.cashBasisEntryId!)).basis], ["both", "cash-only"]);
assert.equal(await balance(UNDEPOSITED), undepositedBefore + 20000);
assert.equal(await balance(AR), arBefore - 20000);
await assert.rejects(() => inv.upsertPortable(ctx, { id, societyId: S, partyKind: "custom", billToName: "Ledger Test Party", issueDate: today, terms: "net_15", lines: [{ item: "Coffee service", quantity: 30, unitPriceCents: 1000 }] }), /payments recognised/, "amounts can't change under recognised payments");
await inv.recordPaymentPortable(ctx, { id, date: today, amountCents: 51250 - 20000, method: "cash", depositAccountId: CASH });
row = await invoiceRow(id);
assert.equal(row.status, "paid");
assert.equal(row.payments[1].depositAccountId, CASH, "a chosen deposit account is used");
const cashRecognised = net((await Promise.all(row.payments.map((payment) => linesOf(payment.cashBasisEntryId!)))).flat().filter((item) => item.side === "credit"));
assert.deepEqual([cashRecognised.get(OTHER), cashRecognised.get(PROGRAM), cashRecognised.get(GST)], [-45000, -4000, -2250], "paid in full: the cash-basis entries recognise exactly the accrual");
assert.ok(row.needsAction.some((flag) => flag.code === "deposit_unlinked"), "paid without a linked deposit needs action");
// Link the cheque to a deposit that "Backfill imports" already posted: that entry steps aside, and comes back on unlink.
const backfilled = (await entries()).filter((entry) => entry.source === "financialTransactionBackfill" && entry.status === "posted" && entry.date > "2026-01-01");
let deposit: Row | undefined;
for (const entry of backfilled) {
  const txnId = (await linesOf(entry._id)).find((item) => item.financialTransactionId)?.financialTransactionId;
  const txn = txnId ? await get(txnId) : undefined;
  if (txn && txn.amountCents > 0 && !txn.matchedKind) { deposit = txn; break; }
}
if (!deposit) throw new Error("the demo has a posted money-in bank line to link");
await inv.linkDepositPortable(ctx, { id, paymentKey: firstKey, financialTransactionId: deposit._id });
row = await invoiceRow(id);
const relinked = row.payments.find((payment) => payment.key === firstKey)!;
assert.equal(relinked.financialTransactionId, deposit._id);
assert.equal((await get(first.journalEntryId!)).status, "void", "the old payment entry is voided");
const depositLines = await linesOf(relinked.journalEntryId!);
assert.equal(depositLines[0].accountId, deposit.accountId, "the payment now deposits into the bank line's account");
assert.ok(depositLines.every((item) => item.financialTransactionId === deposit._id));
const ownEntry = (await entries()).find((entry) => entry.source === "financialTransactionBackfill" && entry._id === relinked.voidedTransactionEntryId);
assert.equal(ownEntry?.status, "void", "the deposit's backfill entry is voided so it isn't in the books twice");
let txn = await get(deposit._id);
assert.deepEqual([txn.matchedKind, txn.matchedId, txn.accountingAccountId, txn.lines], ["invoice", id, AR, undefined]);
assert.ok(row.needsAction.some((flag) => flag.code === "deposit_mismatch"), "a deposit of a different amount is flagged");
await inv.linkDepositPortable(ctx, { id, paymentKey: firstKey });
txn = await get(deposit._id);
assert.deepEqual([txn.matchedKind, txn.accountingAccountId], [deposit.matchedKind, deposit.accountingAccountId], "unlinking puts the bank line back");
assert.equal((await get(relinked.voidedTransactionEntryId!)).status, "posted", "and its backfill entry");

// Removing a payment voids its entries; reverting voids the rest.
await inv.removePaymentPortable(ctx, { id, paymentKey: firstKey });
assert.equal((await get(first.cashBasisEntryId!)).status, "void");
await inv.revertToUnpaidPortable(ctx, { id });
assert.equal(await balance(AR), arBefore, "receivables are back to the full invoice");
assert.ok((await invoiceRow(id)).payments.length === 0);

// Linking a deposit on the payment itself: matched to the invoice and categorised to AR, restored on removal.
const noorTxn = await get("static_tx_invoice_noor");
const noorKey = await inv.recordPaymentPortable(ctx, { id: "static_invoice_dues_noor", date: noorTxn.date, amountCents: 2500, method: "e_transfer", financialTransactionId: noorTxn._id });
txn = await get(noorTxn._id);
assert.deepEqual([txn.matchedKind, txn.category, txn.accountingAccountId, txn.categorizedBy], ["invoice", "Accounts receivable", AR, "manual"]);
const noor = await invoiceRow("static_invoice_dues_noor");
assert.equal(noor.status, "paid");
assert.deepEqual(noor.needsAction, [], "paid with a matching linked deposit needs nothing");
assert.equal((await linesOf(noor.payments[0].journalEntryId!))[0].accountId, CASH);
await inv.removePaymentPortable(ctx, { id: "static_invoice_dues_noor", paymentKey: noorKey });
txn = await get(noorTxn._id);
assert.deepEqual([txn.matchedKind, txn.category, txn.accountingAccountId], [undefined, noorTxn.category, undefined], "removing the payment restores the deposit");
await assert.rejects(() => inv.recordPaymentPortable(ctx, { id, date: today, amountCents: 100, method: "cash", financialTransactionId: "static_tx_grant" }), /already in the books \(a wave entry/, "a deposit posted another way is refused");
assert.equal((await get("static_tx_grant")).matchedKind, undefined, "and left untouched");

// Void reverses; restore re-posts under a fresh key.
const voided = await inv.voidInvoicesPortable(ctx, { societyId: S, ids: [id] });
assert.equal(voided.reversed, 1);
row = await invoiceRow(id);
const reversal = await get(row.reversalJournalEntryId!);
assert.deepEqual([reversal.source, reversal.basis], ["invoice_accrual", "accrual-only"]);
assert.equal(await balance(AR), arBefore - 51250, "the reversal takes the invoice out of receivables");
await inv.restoreVoidedPortable(ctx, { id });
row = await invoiceRow(id);
assert.equal((await get(row.journalEntryId)).sourceExternalId, accrualKey(id, 2), "restored and posted again as round 2");
assert.equal(await balance(AR), arBefore);

// Closed fiscal period and closed books refuse, before anything changes.
const period = (await db.query("accountingFiscalPeriods").collect()).find((item) => item.societyId === S && item.startDate <= today && item.endDate >= today)!;
const draftId = await inv.upsertPortable(ctx, { societyId: S, partyKind: "custom", billToName: "Closed Period Co", issueDate: today, terms: "net_15", lines: [{ item: "Room", quantity: 1, unitPriceCents: 12000 }] });
await db.patch(period._id, { status: "closed" });
await assert.rejects(() => inv.markSentPortable(ctx, { societyId: S, ids: [draftId] }), /Fiscal period .* is closed/);
assert.equal((await get(draftId)).status, "draft", "nothing changed");
await assert.rejects(() => inv.recordPaymentPortable(ctx, { id, date: today, amountCents: 1000, method: "cash" }), /Fiscal period .* is closed/);
assert.equal((await get(id)).payments.length, 0);
await assert.rejects(() => inv.voidInvoicesPortable(ctx, { societyId: S, ids: [id] }), /Fiscal period .* is closed/);
await db.patch(period._id, { status: "open" });
const books = (await db.query("booksSettings").collect()).find((item) => item.societyId === S)!;
await db.patch(books._id, { closeDate: today });
await assert.rejects(() => inv.markSentPortable(ctx, { societyId: S, ids: [draftId] }), /books are closed through/);
await assert.rejects(() => inv.recordPaymentPortable(ctx, { id, date: today, amountCents: 1000, method: "cash" }), /books are closed through/);
await db.patch(books._id, { closeDate: undefined });

// Needs action and what keeps an invoice out of the books.
const usd = await inv.upsertPortable(ctx, { societyId: S, partyKind: "custom", billToName: "Seattle Partner", issueDate: today, terms: "net_15", currency: "USD", lines: [{ item: "Workshop", quantity: 1, unitPriceCents: 9000 }] });
const early = await inv.upsertPortable(ctx, { societyId: S, partyKind: "custom", billToName: "Old Booking", issueDate: "2025-12-15", terms: "net_15", lines: [{ item: "Room", quantity: 1, unitPriceCents: 12000 }] });
sent = await inv.markSentPortable(ctx, { societyId: S, ids: [usd, early] });
assert.equal(sent.posted, 0, "another currency and a pre-start invoice are sent but not posted");
ws = await workspace();
assert.deepEqual(ws.invoices.find((item) => item._id === usd)!.needsAction.map((flag) => flag.code), ["foreign_currency"]);
assert.deepEqual(ws.invoices.find((item) => item._id === early)!.needsAction.map((flag) => flag.code), ["before_books_start"]);
assert.deepEqual(ws.ledger.foreignCurrency, { count: 1, currencies: ["USD"] }, "the banner counts it");
const blocked = await inv.postingPreviewPortable(ctx, { societyId: S });
assert.deepEqual(blocked.blocked.map((item) => item.invoiceId).sort(), [early, usd].sort(), "the preview names what blocks posting");
assert.ok(blocked.blocked.find((item) => item.invoiceId === usd)!.reasons[0].includes("USD"));
// Overpaid (only reachable through imported data).
await db.patch(early, { payments: [{ key: "p_over", date: "2026-01-10", amountCents: 15000, method: "cash" }], paidCents: 15000 });
assert.ok((await invoiceRow(early)).needsAction.some((flag) => flag.code === "overpaid"));

// Unmapped revenue: without a default, an item with no account stays out until mapped.
const settings = ws.settings;
await inv.saveAccountMappingPortable(ctx, { societyId: S, receivableAccountId: AR, taxPayableAccountId: GST, depositAccountId: UNDEPOSITED, categoryAccounts: [...(settings.categoryAccounts ?? [])] });
const custom = await inv.upsertPortable(ctx, { societyId: S, partyKind: "custom", billToName: "Unmapped Co", issueDate: today, terms: "net_15", lines: [{ item: "Consulting", quantity: 1, unitPriceCents: 30000 }] });
sent = await inv.markSentPortable(ctx, { societyId: S, ids: [custom] });
assert.equal(sent.posted, 0);
row = await invoiceRow(custom);
assert.deepEqual([row.ledger.state, row.needsAction.map((flag) => flag.code)], ["blocked", ["unmapped_revenue"]]);
await assert.rejects(() => inv.saveAccountMappingPortable(ctx, { societyId: S, defaultRevenueAccountId: CASH, categoryAccounts: [] }), /can't be used here/);
// Item mapping beats the category; the default catches the rest.
const room = ws.catalog.find((item) => item.name.startsWith("Program room"))!;
await inv.saveAccountMappingPortable(ctx, { societyId: S, receivableAccountId: AR, taxPayableAccountId: GST, depositAccountId: UNDEPOSITED, defaultRevenueAccountId: PROGRAM, categoryAccounts: [...(settings.categoryAccounts ?? [])], itemAccounts: [{ catalogItemId: room._id, accountId: DUES }] });
assert.equal((await invoiceRow(custom)).ledger.state, "ready");
const posted = await inv.postExistingPortable(ctx, { societyId: S });
assert.deepEqual([posted.postedInvoices, posted.postedCents, posted.blocked, posted.failed], [1, 30000, 2, []], "Post existing invoices posts the newly mapped one and counts the blocked");
assert.deepEqual((await inv.postExistingPortable(ctx, { societyId: S })).postedInvoices, 0, "and is idempotent");
const roomInvoice = await inv.upsertPortable(ctx, { societyId: S, partyKind: "custom", billToName: "Room Co", issueDate: today, terms: "net_15", lines: [{ item: room.name, catalogItemId: room._id, quantity: 1, unitPriceCents: 12000 }] });
await inv.markSentPortable(ctx, { societyId: S, ids: [roomInvoice] });
lines = await linesOf((await invoiceRow(roomInvoice)).journalEntryId);
assert.equal(lines[1].accountId, DUES, "the item's own account wins over its category");

// A negative line (imported data; the editor takes none) nets against revenue and GST, sends, and is recognised on payment.
const creditInvoice = await inv.upsertPortable(ctx, { societyId: S, partyKind: "custom", billToName: "Credit Line Co", issueDate: today, terms: "net_15", lines: [{ item: "Room", quantity: 1, unitPriceCents: 10000 }] });
await db.patch(creditInvoice, { lines: [{ key: "l1", item: "Room", quantity: 1, unitPriceCents: 10000 }, { key: "l2", item: "Goodwill credit", quantity: 1, unitPriceCents: -1000, taxRatePercent: 5, taxLabel: "GST" }] });
assert.equal((await inv.markSentPortable(ctx, { societyId: S, ids: [creditInvoice] })).posted, 1, "a negative taxed line no longer makes sending throw");
const creditAccrual = await linesOf((await invoiceRow(creditInvoice)).journalEntryId);
assert.deepEqual(creditAccrual.map((item) => [item.accountId, item.side, item.amountCents]), [[AR, "debit", 8950], [PROGRAM, "credit", 9000], [GST, "debit", 50]], "revenue and GST both net; the net tax credit posts as a debit");
await inv.recordPaymentPortable(ctx, { id: creditInvoice, date: today, amountCents: 8950, method: "cash" });
const creditCash = await linesOf((await invoiceRow(creditInvoice)).payments[0].cashBasisEntryId!);
assert.deepEqual(creditCash.map((item) => [item.accountId, item.side, item.amountCents]), [[AR, "debit", 8950], [PROGRAM, "credit", 9000], [GST, "debit", 50]], "the cash basis recognises the netted revenue and tax");

// Everything posted still balances, and receivables still match the invoices.
const postedIds = new Set((await entries()).filter((entry) => entry.status === "posted").map((entry) => entry._id));
const postedLines: InvoiceLedgerLine[] = (await allLines()).filter((item) => postedIds.has(item.journalEntryId)).map((item) => ({ accountId: item.accountId, side: item.side === "debit" ? "debit" : "credit", amountCents: item.amountCents }));
assert.ok(ledgerBalance(postedLines).balanced, "every posted entry together balances");
assert.equal(await balance(AR), await owedInBooks(), "Accounts receivable still equals what posted invoices say is owed");

console.log("Invoice ledger checks passed: accrual with tax, discount and tags, payments and cash basis, deposits, reversal, idempotency, closed periods and books, needs action and mapping.");
