/**
 * Invoice postings: the database side of shared/invoiceLedger.ts, used by the
 * invoice handlers (shared/functions/invoices.ts).
 *
 * - The accounts invoices post to (Accounts receivable, GST/HST payable,
 *   Undeposited funds) are found in the chart or created on first use, never
 *   renamed or moved, as bills do for Accounts payable.
 * - Every posting is one balanced entry posted once per source and key (a
 *   posted entry with the same key is returned instead), refused when its date
 *   is in a closed fiscal period or on or before the books close date, and
 *   carries its accounting basis (`journalEntries.basis`).
 * - A bank deposit already posted by "Backfill imports" has that entry voided
 *   when an invoice payment takes it over (and restored when the payment goes),
 *   so the deposit is never in the books twice.
 */
import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { assertPeriodOpen, postedJournalForTransaction, TRANSACTION_BACKFILL_SOURCE } from "./accounting";
import { assertBooksOpen, booksSettingsRow } from "./booksLock";
import { cashLedgerAccountId } from "./bankAccounts";
import { validateBalancedJournalLines } from "../accountingCore";
import { openingBalanceDate } from "../accountingBackfill";
import { computeInvoiceTotals, type InvoiceDiscount, type InvoiceLine, type InvoicePayment } from "../invoicing";
import {
  INVOICE_POSTINGS,
  INVOICE_POSTING_SOURCES,
  accrualKey,
  accrualPostingLines,
  accrualReversalKey,
  cashBasisKey,
  cashBasisPostingLines,
  invoiceLabel,
  isBeforeBooksStart,
  booksStartLabel,
  mirrorLines,
  paymentEntryKey,
  paymentPostingLines,
  resolveLineRevenue,
  sameLedgerNet,
  type BooksStart,
  type CatalogMappingRef,
  type InvoiceGlMapping,
  type InvoiceLedgerLine,
  type InvoicePostingKind,
} from "../invoiceLedger";

/* ------------------------------------------------------------------ rows */

export type LedgerAccount = {
  _id: string;
  societyId: string;
  connectionId?: string;
  code?: string;
  name: string;
  currency?: string;
  accountType: string;
  subtype?: string;
};

export type LedgerEntry = {
  _id: string;
  societyId: string;
  source: string;
  sourceExternalId?: string;
  status: string;
  date: string;
  fiscalPeriodId?: string;
  basis?: string;
};

export type LedgerLineRow = {
  _id: string;
  societyId: string;
  journalEntryId: string;
  accountId: string;
  amountCents: number;
  side: string;
  description?: string;
  tagIds?: string[];
  financialTransactionId?: string;
  lineOrder: number;
};

type PeriodRow = { _id: string; societyId: string; periodLabel: string; startDate: string; endDate: string; status: string };

/** What linking a bank line changed on it, so unlinking puts it back. */
export type TransactionSnapshot = {
  category?: string;
  accountingAccountId?: string;
  categorizedBy?: string;
  ruleId?: string;
  ruleApplication?: { ruleName: string; batchId: string; appliedAtISO: string; previous?: unknown };
  reconciledAtISO?: string;
  reconciledByName?: string;
  matchedKind?: string;
  matchedId?: string;
  reconciliationNote?: string;
  lines?: PortableDoc[];
};

export type StoredInvoicePayment = InvoicePayment & {
  recordedByName?: string;
  transactionBefore?: TransactionSnapshot;
  /** The "Backfill imports" entry of the linked deposit, voided while this payment posts it. */
  voidedTransactionEntryId?: string;
};

export type StoredInvoice = {
  _id: string;
  societyId: string;
  number: string;
  status: string;
  billToName: string;
  counterpartyId?: string;
  issueDate: string;
  currency: string;
  lines: InvoiceLine[];
  discount?: InvoiceDiscount;
  source?: string;
  payments: StoredInvoicePayment[];
  journalEntryId?: string;
  reversalJournalEntryId?: string;
  ledgerRound?: number;
};

export type InvoiceSettingsRow = {
  _id: string;
  societyId: string;
  receivableAccountId?: string;
  taxPayableAccountId?: string;
  defaultRevenueAccountId?: string;
  depositAccountId?: string;
  categoryAccounts?: Array<{ category: string; accountId: string }>;
};

/* -------------------------------------------------------------- accounts */

export type LedgerAccountKind = "receivable" | "taxPayable" | "undeposited";

const TEMPLATES: Record<LedgerAccountKind, { codes: string[]; name: string; accountType: string; subtype: string; normalBalance: string }> = {
  receivable: { codes: ["1100", "1110", "1150"], name: "Accounts receivable", accountType: "Asset", subtype: "receivable", normalBalance: "debit" },
  taxPayable: { codes: ["2300", "2310", "2350"], name: "GST/HST payable", accountType: "Liability", subtype: "sales_tax_payable", normalBalance: "credit" },
  undeposited: { codes: ["1050", "1060", "1090"], name: "Undeposited funds", accountType: "Asset", subtype: "undeposited_funds", normalBalance: "debit" },
};

/** The chart's existing account of this kind, if any (by subtype, then by name). */
export function findLedgerAccount(kind: LedgerAccountKind, accounts: readonly LedgerAccount[]): LedgerAccount | undefined {
  const template = TEMPLATES[kind];
  const ofType = accounts.filter((account) => account.accountType === template.accountType);
  if (kind === "receivable") {
    return ofType.find((account) => account.subtype === "receivable" && account.code === "1100")
      ?? ofType.find((account) => account.subtype === "receivable")
      ?? ofType.find((account) => /accounts receivable/i.test(account.name));
  }
  if (kind === "taxPayable") {
    return ofType.find((account) => account.subtype === "sales_tax_payable")
      ?? ofType.find((account) => /\b(gst|hst|pst|qst|sales tax)\b/i.test(account.name));
  }
  return ofType.find((account) => account.subtype === "undeposited_funds") ?? ofType.find((account) => /undeposited/i.test(account.name));
}

export async function loadLedgerAccounts(ctx: PortableQueryCtx, societyId: string): Promise<LedgerAccount[]> {
  return ctx.db.query<LedgerAccount>("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

/** The account of this kind, created on first use when the chart has none. */
export async function ensureLedgerAccount(ctx: PortableMutationCtx, societyId: string, kind: LedgerAccountKind): Promise<LedgerAccount> {
  const accounts = await loadLedgerAccounts(ctx, societyId);
  const existing = findLedgerAccount(kind, accounts);
  if (existing) return existing;
  const template = TEMPLATES[kind];
  const connections = await ctx.db.query("financialConnections").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const connectionId = String(
    connections.find((row) => row.provider === "societyer")?._id ??
    (await ctx.db.insert("financialConnections", {
      societyId,
      provider: "societyer",
      status: "connected",
      accountLabel: "Societyer internal ledger",
      syncMode: "internal",
      connectedAtISO: new Date().toISOString(),
      demo: false,
    })),
  );
  const used = new Set(accounts.map((account) => account.code).filter(Boolean));
  const code = template.codes.find((candidate) => !used.has(candidate));
  const doc = {
    societyId,
    connectionId,
    externalId: `societyer:${template.codes[0]}`,
    ...(code ? { code } : {}),
    name: template.name,
    currency: accounts.find((account) => account.currency)?.currency ?? "CAD",
    accountType: template.accountType,
    subtype: template.subtype,
    balanceCents: 0,
    isRestricted: false,
    sourceSystem: "societyer",
    normalBalance: template.normalBalance,
  };
  const id = await ctx.db.insert("financialAccounts", doc);
  return { _id: id, ...doc };
}

/* --------------------------------------------------------------- context */

export type InvoiceLedgerContext = {
  societyId: string;
  accounts: LedgerAccount[];
  accountsById: Map<string, LedgerAccount>;
  accountIds: Set<string>;
  mapping: InvoiceGlMapping;
  catalogById: Map<string, CatalogMappingRef>;
  booksStart: BooksStart;
  closeDate: string | null;
  periods: PeriodRow[];
  workspaceCurrency: string;
};

export function mappingOf(settings: InvoiceSettingsRow | PortableDoc | null | undefined): InvoiceGlMapping {
  return {
    receivableAccountId: settings?.receivableAccountId,
    taxPayableAccountId: settings?.taxPayableAccountId,
    defaultRevenueAccountId: settings?.defaultRevenueAccountId,
    depositAccountId: settings?.depositAccountId,
    categoryAccounts: Array.isArray(settings?.categoryAccounts) ? settings.categoryAccounts : [],
  };
}

export async function loadInvoiceLedgerContext(ctx: PortableQueryCtx, societyId: string): Promise<InvoiceLedgerContext> {
  const [accounts, settings, catalog, openingEntries, periods, books] = await Promise.all([
    loadLedgerAccounts(ctx, societyId),
    ctx.db.query<InvoiceSettingsRow>("invoiceSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).first(),
    ctx.db.query<CatalogMappingRef & { societyId: string }>("invoiceCatalogItems").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<LedgerEntry>("journalEntries").withIndex("by_society_source", (q) => q.eq("societyId", societyId).eq("source", "opening_balance")).collect(),
    ctx.db.query<PeriodRow>("accountingFiscalPeriods").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    booksSettingsRow(ctx, societyId),
  ]);
  const accountsById = new Map(accounts.map((account) => [String(account._id), account]));
  const mapping = mappingOf(settings);
  const receivable = (mapping.receivableAccountId && accountsById.get(mapping.receivableAccountId)) || findLedgerAccount("receivable", accounts);
  const bank = accounts.find((account) => account.accountType === "Bank");
  return {
    societyId,
    accounts,
    accountsById,
    accountIds: new Set(accountsById.keys()),
    mapping,
    catalogById: new Map(catalog.map((item) => [String(item._id), item])),
    booksStart: { openingBalanceDate: openingBalanceDate(openingEntries), booksStartDate: books?.booksStartDate ?? null },
    closeDate: books?.closeDate ?? null,
    periods,
    workspaceCurrency: String(receivable?.currency ?? bank?.currency ?? "CAD").toUpperCase(),
  };
}

/** Why nothing can be posted on `date`, or null (closed fiscal period, closed books). */
export function dateBlock(lctx: InvoiceLedgerContext, date: string): string | null {
  if (lctx.closeDate && date <= lctx.closeDate) return `The books are closed through ${lctx.closeDate}.`;
  const period = lctx.periods.find((row) => row.startDate <= date && row.endDate >= date);
  if (period && period.status !== "open") return `Fiscal period ${period.periodLabel} is ${period.status}.`;
  return null;
}

/** Item names of the invoice's lines with an amount and no revenue account. */
export function unmappedItems(invoice: Pick<StoredInvoice, "lines" | "discount" | "source">, lctx: InvoiceLedgerContext): string[] {
  const totals = computeInvoiceTotals(invoice.lines ?? [], invoice.discount);
  return (invoice.lines ?? [])
    .filter((line, index) => totals.lineAmounts[index] !== 0 && !resolveLineRevenue(line, { mapping: lctx.mapping, catalogById: lctx.catalogById, invoiceSource: invoice.source, accountIds: lctx.accountIds }))
    .map((line) => line.item);
}

/** Why the invoice itself can't go into the books (beyond the posting date), empty when it can. */
export function accrualBlockers(invoice: StoredInvoice, lctx: InvoiceLedgerContext): string[] {
  const reasons: string[] = [];
  if (String(invoice.currency || lctx.workspaceCurrency).toUpperCase() !== lctx.workspaceCurrency) reasons.push(`Invoiced in ${invoice.currency}; the books are kept in ${lctx.workspaceCurrency}.`);
  const unmapped = unmappedItems(invoice, lctx);
  if (unmapped.length) reasons.push(`No revenue account for ${[...new Set(unmapped)].join(", ")}.`);
  const start = booksStartLabel(lctx.booksStart);
  if (start && isBeforeBooksStart(invoice.issueDate, lctx.booksStart)) reasons.push(`Issued before ${start}.`);
  return reasons;
}

/** Why one payment can't go into the books, or null. */
export function paymentBlock(payment: Pick<StoredInvoicePayment, "date">, lctx: InvoiceLedgerContext): string | null {
  const start = booksStartLabel(lctx.booksStart);
  if (start && isBeforeBooksStart(payment.date, lctx.booksStart)) return `Paid before ${start}.`;
  return dateBlock(lctx, payment.date);
}

/* --------------------------------------------------------------- entries */

export async function entryLines(ctx: PortableQueryCtx, entryId: string): Promise<LedgerLineRow[]> {
  const lines = await ctx.db.query<LedgerLineRow>("journalLines").withIndex("by_entry", (q) => q.eq("journalEntryId", entryId)).collect();
  return lines.sort((a, b) => a.lineOrder - b.lineOrder);
}

export async function postedEntry(ctx: PortableQueryCtx, societyId: string, entryId: string | undefined): Promise<LedgerEntry | null> {
  if (!entryId) return null;
  const entry = await ctx.db.get<LedgerEntry>(entryId, "journalEntries");
  return entry && entry.societyId === societyId && entry.status === "posted" ? entry : null;
}

/** Posted invoice entries by `source|sourceExternalId`. */
export async function postedInvoiceEntries(ctx: PortableQueryCtx, societyId: string): Promise<Map<string, LedgerEntry>> {
  const byKey = new Map<string, LedgerEntry>();
  for (const source of INVOICE_POSTING_SOURCES) {
    const rows = await ctx.db.query<LedgerEntry>("journalEntries").withIndex("by_society_source", (q) => q.eq("societyId", societyId).eq("source", source)).collect();
    for (const row of rows) if (row.status === "posted" && row.sourceExternalId) byKey.set(`${source}|${row.sourceExternalId}`, row);
  }
  return byKey;
}

type PostArgs = {
  societyId: string;
  kind: InvoicePostingKind;
  key: string;
  date: string;
  memo: string;
  lines: InvoiceLedgerLine[];
  counterpartyId?: string;
  createdByUserId?: string;
};

/**
 * Post one balanced entry, once: a posted entry with the same source and key
 * is returned instead of posting twice. Refused inside a closed fiscal period
 * or on or before the books close date.
 */
export async function postLedgerEntry(ctx: PortableMutationCtx, args: PostArgs): Promise<string> {
  const { source, basis } = INVOICE_POSTINGS[args.kind];
  const existing = await ctx.db
    .query<LedgerEntry>("journalEntries")
    .withIndex("by_society_source_external", (q) => q.eq("societyId", args.societyId).eq("source", source).eq("sourceExternalId", args.key))
    .collect();
  const already = existing.find((entry) => entry.status === "posted");
  if (already) return already._id;
  validateBalancedJournalLines(args.lines);
  await assertBooksOpen(ctx, args.societyId, [args.date], "posted");
  const period = (await assertPeriodOpen(ctx, { societyId: args.societyId, date: args.date })) as { _id: string; fiscalYear?: string } | null;
  const at = new Date().toISOString();
  const entryId = await ctx.db.insert("journalEntries", {
    societyId: args.societyId,
    ...(period ? { fiscalPeriodId: period._id, fiscalYear: period.fiscalYear } : {}),
    date: args.date,
    memo: args.memo,
    source,
    sourceExternalId: args.key,
    basis,
    status: "posted",
    ...(args.createdByUserId ? { createdByUserId: args.createdByUserId } : {}),
    postedAtISO: at,
    createdAtISO: at,
    updatedAtISO: at,
  });
  await insertLines(ctx, args.societyId, entryId, args.lines, args.counterpartyId, at);
  return entryId;
}

async function insertLines(ctx: PortableMutationCtx, societyId: string, entryId: string, lines: readonly InvoiceLedgerLine[], counterpartyId: string | undefined, at: string) {
  for (const [index, line] of lines.entries()) {
    await ctx.db.insert("journalLines", {
      societyId,
      journalEntryId: entryId,
      accountId: line.accountId,
      lineOrder: index,
      amountCents: line.amountCents,
      side: line.side,
      ...(line.description ? { description: line.description } : {}),
      ...(line.tagIds?.length ? { tagIds: line.tagIds } : {}),
      ...(line.financialTransactionId ? { financialTransactionId: line.financialTransactionId } : {}),
      ...(counterpartyId ? { counterpartyId } : {}),
      createdAtISO: at,
      updatedAtISO: at,
    });
  }
}

/**
 * Void a posted entry (refused in a closed period or closed books). With
 * `freeTransactions` its lines let go of their bank lines, so the backfill
 * may post them again.
 */
export async function voidLedgerEntry(ctx: PortableMutationCtx, societyId: string, entryId: string | undefined, options: { freeTransactions?: boolean } = {}): Promise<boolean> {
  const entry = await postedEntry(ctx, societyId, entryId);
  if (!entry) return false;
  await assertBooksOpen(ctx, societyId, [entry.date], "voided");
  await assertPeriodOpen(ctx, { societyId, date: entry.date, fiscalPeriodId: entry.fiscalPeriodId });
  const at = new Date().toISOString();
  await ctx.db.patch(entry._id, { status: "void", voidedAtISO: at, updatedAtISO: at });
  if (options.freeTransactions) {
    for (const line of await entryLines(ctx, entry._id)) {
      if (line.financialTransactionId) await ctx.db.patch(line._id, { financialTransactionId: undefined, updatedAtISO: at });
    }
  }
  return true;
}

/* -------------------------------------------------------------- deposits */

/**
 * Make a bank deposit available to an invoice payment: a live "Backfill
 * imports" entry for it is voided (and its id returned, to restore later);
 * an entry posted any other way stops the link.
 */
export async function claimDeposit(ctx: PortableMutationCtx, societyId: string, transactionId: string): Promise<string | undefined> {
  let voided: string | undefined;
  for (const entry of await claimableDepositEntries(ctx, transactionId)) {
    await voidLedgerEntry(ctx, societyId, entry._id);
    voided = entry._id;
  }
  return voided;
}

/**
 * The deposit's own "Backfill imports" entries an invoice payment would void;
 * throws when an entry posted another way (a sync, a manual entry) has it.
 * Read-only, so a link can be refused before anything is written.
 */
export async function claimableDepositEntries(ctx: PortableQueryCtx, transactionId: string): Promise<LedgerEntry[]> {
  const { entries } = await postedJournalForTransaction(ctx, transactionId);
  const claimable: LedgerEntry[] = [];
  for (const entry of entries as LedgerEntry[]) {
    if (INVOICE_POSTING_SOURCES.includes(String(entry.source))) continue;
    if (entry.source === TRANSACTION_BACKFILL_SOURCE && entry.status === "posted") {
      claimable.push(entry);
      continue;
    }
    throw new Error(`That deposit is already in the books (a ${entry.source} entry dated ${entry.date}). Void that entry, or link a different deposit.`);
  }
  return claimable;
}

/** Put back the "Backfill imports" entry a payment voided when it took the deposit over. */
export async function restoreDepositEntry(ctx: PortableMutationCtx, societyId: string, entryId: string | undefined) {
  if (!entryId) return;
  const entry = await ctx.db.get<LedgerEntry>(entryId, "journalEntries");
  if (!entry || entry.societyId !== societyId || entry.status !== "void") return;
  await assertBooksOpen(ctx, societyId, [entry.date], "posted");
  await assertPeriodOpen(ctx, { societyId, date: entry.date, fiscalPeriodId: entry.fiscalPeriodId });
  await ctx.db.patch(entry._id, { status: "posted", voidedAtISO: undefined, updatedAtISO: new Date().toISOString() });
}

/* -------------------------------------------------------------- postings */

function revenueResolver(invoice: StoredInvoice, lctx: InvoiceLedgerContext) {
  return (line: InvoiceLine) => resolveLineRevenue(line, { mapping: lctx.mapping, catalogById: lctx.catalogById, invoiceSource: invoice.source, accountIds: lctx.accountIds })?.accountId ?? null;
}

async function accountsForAccrual(ctx: PortableMutationCtx, invoice: StoredInvoice, lctx: InvoiceLedgerContext) {
  const mapped = (id: string | null | undefined) => (id && lctx.accountIds.has(id) ? id : undefined);
  const receivableAccountId = mapped(lctx.mapping.receivableAccountId) ?? (await ensureLedgerAccount(ctx, invoice.societyId, "receivable"))._id;
  const taxed = computeInvoiceTotals(invoice.lines ?? [], invoice.discount).taxes.some((tax) => tax.cents !== 0);
  const taxPayableAccountId = taxed ? mapped(lctx.mapping.taxPayableAccountId) ?? (await ensureLedgerAccount(ctx, invoice.societyId, "taxPayable"))._id : undefined;
  return { receivableAccountId, taxPayableAccountId };
}

export type AccrualOutcome = { entryId?: string; skipped?: string; changed: boolean };

/**
 * Post (or bring up to date) a sent invoice's accrual. Invoices that can't be
 * posted (another currency, an unmapped line, issued before the books start,
 * a zero total) are skipped with the reason; a closed period or closed books
 * throws. A posted accrual is rewritten in place when the invoice's lines
 * change, unless its payments are already recognised on the cash basis.
 */
export async function syncAccrual(ctx: PortableMutationCtx, invoice: StoredInvoice, lctx: InvoiceLedgerContext, createdByUserId?: string): Promise<AccrualOutcome> {
  if (invoice.status !== "sent") return { skipped: "Only sent invoices are in the books.", changed: false };
  const totals = computeInvoiceTotals(invoice.lines ?? [], invoice.discount);
  if (!(totals.totalCents > 0)) return { skipped: "Nothing to post: the total is zero.", changed: false };
  const blockers = accrualBlockers(invoice, lctx);
  const current = await postedEntry(ctx, invoice.societyId, invoice.journalEntryId);
  if (blockers.length) {
    if (current) throw new Error(`${invoice.number} is in the books, and the change would take it out: ${blockers.join(" ")}`);
    return { skipped: blockers.join(" "), changed: false };
  }
  const accounts = await accountsForAccrual(ctx, invoice, lctx);
  const lines = accrualPostingLines(invoice, revenueResolver(invoice, lctx), accounts);
  const memo = `Invoice ${invoiceLabel(invoice)}`;
  if (current) {
    const stored = await entryLines(ctx, current._id);
    // Compared net per account, so an entry posted before lines were netted still counts as the same.
    if (current.date === invoice.issueDate && sameLedgerNet(stored, lines)) return { entryId: current._id, changed: false };
    if ((invoice.payments ?? []).some((payment) => payment.cashBasisEntryId)) {
      throw new Error(`${invoice.number} has payments recognised in the books. Remove them before changing amounts, items or the issue date.`);
    }
    await assertBooksOpen(ctx, invoice.societyId, [current.date, invoice.issueDate], "edited");
    await assertPeriodOpen(ctx, { societyId: invoice.societyId, date: current.date, fiscalPeriodId: current.fiscalPeriodId });
    const period = (await assertPeriodOpen(ctx, { societyId: invoice.societyId, date: invoice.issueDate })) as { _id: string; fiscalYear?: string } | null;
    for (const line of stored) await ctx.db.delete(line._id);
    const at = new Date().toISOString();
    await insertLines(ctx, invoice.societyId, current._id, lines, invoice.counterpartyId, at);
    await ctx.db.patch(current._id, { date: invoice.issueDate, memo, ...(period ? { fiscalPeriodId: period._id, fiscalYear: period.fiscalYear } : {}), updatedAtISO: at });
    return { entryId: current._id, changed: true };
  }
  const entryId = await postLedgerEntry(ctx, {
    societyId: invoice.societyId,
    kind: "accrual",
    key: accrualKey(invoice._id, invoice.ledgerRound ?? 1),
    date: invoice.issueDate,
    memo,
    lines,
    counterpartyId: invoice.counterpartyId,
    createdByUserId,
  });
  return { entryId, changed: true };
}

/** Post the mirror of a posted accrual (voiding the invoice), dated `date`. */
export async function reverseAccrual(ctx: PortableMutationCtx, invoice: StoredInvoice, date: string, createdByUserId?: string): Promise<string | undefined> {
  const entry = await postedEntry(ctx, invoice.societyId, invoice.journalEntryId);
  if (!entry || invoice.reversalJournalEntryId) return undefined;
  const lines = await entryLines(ctx, entry._id);
  return postLedgerEntry(ctx, {
    societyId: invoice.societyId,
    kind: "accrualReversal",
    key: accrualReversalKey(invoice._id, invoice.ledgerRound ?? 1),
    date,
    memo: `Reversal: invoice ${invoiceLabel(invoice)} voided`,
    lines: mirrorLines(lines).map((line) => ({
      accountId: line.accountId,
      side: line.side,
      amountCents: line.amountCents,
      description: `Reversal: ${line.description ?? invoice.number}`,
      ...(line.tagIds?.length ? { tagIds: line.tagIds } : {}),
    })),
    counterpartyId: invoice.counterpartyId,
    createdByUserId,
  });
}

export type PaymentPosting = {
  journalEntryId?: string;
  cashBasisEntryId?: string;
  depositAccountId?: string;
  voidedTransactionEntryId?: string;
  skipped?: string;
};

/**
 * Post one payment: Dr the deposit account / Cr receivable, then the
 * cash-basis recognition of the share it pays. Needs the accrual posted
 * (otherwise skipped; "Post existing invoices" posts both later). The
 * deposit account is the linked bank line's (ledger) account, else the one chosen
 * for this payment, else the mapping's, else Undeposited funds.
 */
export async function postPayment(
  ctx: PortableMutationCtx,
  invoice: StoredInvoice,
  payment: StoredInvoicePayment,
  lctx: InvoiceLedgerContext,
  createdByUserId?: string,
): Promise<PaymentPosting> {
  const accrual = await postedEntry(ctx, invoice.societyId, invoice.journalEntryId);
  if (!accrual) return { skipped: "The invoice isn't in the books yet." };
  const start = booksStartLabel(lctx.booksStart);
  if (start && isBeforeBooksStart(payment.date, lctx.booksStart)) return { skipped: `Paid before ${start}.` };
  const accrualLines = await entryLines(ctx, accrual._id);
  const receivableAccountId = accrualLines.find((line) => line.side === "debit")?.accountId;
  if (!receivableAccountId) return { skipped: "The invoice's entry has no receivable line." };
  let depositAccountId: string;
  let voidedTransactionEntryId = payment.voidedTransactionEntryId;
  if (payment.financialTransactionId) {
    const txn = await ctx.db.get(payment.financialTransactionId, "financialTransactions");
    if (!txn || txn.societyId !== invoice.societyId) return { skipped: "The linked deposit is missing." };
    depositAccountId = await cashLedgerAccountId(ctx, invoice.societyId, String(txn.accountId));
    voidedTransactionEntryId = (await claimDeposit(ctx, invoice.societyId, String(txn._id))) ?? voidedTransactionEntryId;
  } else {
    const chosen = [payment.depositAccountId, lctx.mapping.depositAccountId].find((id): id is string => Boolean(id && lctx.accountIds.has(id)));
    depositAccountId = chosen ?? (await ensureLedgerAccount(ctx, invoice.societyId, "undeposited"))._id;
  }
  const label = `Payment: ${invoiceLabel(invoice)}`;
  const journalEntryId = await postLedgerEntry(ctx, {
    societyId: invoice.societyId,
    kind: "payment",
    key: paymentEntryKey(invoice._id, payment.key),
    date: payment.date,
    memo: `Invoice payment: ${invoiceLabel(invoice)}`,
    lines: paymentPostingLines({ amountCents: payment.amountCents, financialTransactionId: payment.financialTransactionId, reference: payment.reference }, { depositAccountId, receivableAccountId }, label),
    counterpartyId: invoice.counterpartyId,
    createdByUserId,
  });
  // Each payment recognises a share of what the invoice's other live cash-basis entries haven't.
  const recognised: LedgerLineRow[] = [];
  for (const other of invoice.payments ?? []) {
    if (other.key === payment.key) continue;
    const entry = await postedEntry(ctx, invoice.societyId, other.cashBasisEntryId);
    if (entry) recognised.push(...(await entryLines(ctx, entry._id)));
  }
  const cashLines = cashBasisPostingLines(accrualLines, { paymentCents: payment.amountCents, receivableAccountId, recognised }, `Revenue received: ${invoiceLabel(invoice)}`);
  const cashBasisEntryId = cashLines.length
    ? await postLedgerEntry(ctx, {
      societyId: invoice.societyId,
      kind: "cashBasis",
      key: cashBasisKey(invoice._id, payment.key),
      date: payment.date,
      memo: `Cash basis: ${invoiceLabel(invoice)} paid`,
      lines: cashLines,
      counterpartyId: invoice.counterpartyId,
      createdByUserId,
    })
    : undefined;
  return { journalEntryId, cashBasisEntryId, depositAccountId, voidedTransactionEntryId };
}

/** Void a payment's entries (refused in a closed period or closed books); its bank line is freed. */
export async function unpostPayment(ctx: PortableMutationCtx, societyId: string, payment: StoredInvoicePayment) {
  await voidLedgerEntry(ctx, societyId, payment.cashBasisEntryId);
  await voidLedgerEntry(ctx, societyId, payment.journalEntryId, { freeTransactions: true });
}

/** Stored payment fields after a posting (posting refs replaced, nothing else touched). */
export function withPosting(payment: StoredInvoicePayment, posting: PaymentPosting): StoredInvoicePayment {
  const { journalEntryId: _entry, cashBasisEntryId: _cash, voidedTransactionEntryId: _voided, ...rest } = payment;
  return {
    ...rest,
    ...(posting.journalEntryId ? { journalEntryId: posting.journalEntryId } : {}),
    ...(posting.cashBasisEntryId ? { cashBasisEntryId: posting.cashBasisEntryId } : {}),
    ...(posting.voidedTransactionEntryId ? { voidedTransactionEntryId: posting.voidedTransactionEntryId } : {}),
    ...(posting.depositAccountId && !payment.financialTransactionId ? { depositAccountId: posting.depositAccountId } : {}),
  };
}
