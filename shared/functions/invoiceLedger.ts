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
import { assertPeriodOpen, postedJournalForTransaction, TRANSACTION_BACKFILL_SOURCE, BILL_BANK_RESTORATION_SOURCE, INVOICE_BANK_RESTORATION_SOURCE } from "./accounting";
import { journalBasisOf, type JournalBasis } from "../booksReports";
import { assertBooksOpen, booksSettingsRow } from "./booksLock";
import { cashLedgerAccountId } from "./bankAccounts";
import { validateBalancedJournalLines } from "../accountingCore";
import { openingBalanceDate } from "../accountingBackfill";
import { explicitFxQuote, convertInvoiceCents, allocateMoney, paidCents, type InvoiceMoneyOptions, computeInvoiceTotals, type InvoiceDiscount, type InvoiceLine, type InvoicePayment } from "../invoicing";
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
  fxSettlementPostingLines,
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
  money?: InvoiceMoneyOptions;
  fxRevaluations?: Array<{ key: string; date: string; rateMicros: number; invoiceBalanceCents: number; baseBalanceCents: number; adjustmentCents: number; journalEntryId?: string; reversedDate?: string; reversalJournalEntryId?: string }>;
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

export type LedgerAccountKind = "receivable" | "taxPayable" | "undeposited" | "withholding" | "shippingRevenue" | "badDebt" | "fxGain" | "fxLoss" | "fxUnrealizedGain" | "fxUnrealizedLoss";

const TEMPLATES: Record<LedgerAccountKind, { codes: string[]; name: string; accountType: string; subtype: string; normalBalance: string }> = {
  withholding: { codes: ["1180", "1181"], name: "Withholding tax receivable", accountType: "Asset", subtype: "withholding_tax_receivable", normalBalance: "debit" },
  shippingRevenue: { codes: ["4900", "4901"], name: "Shipping revenue", accountType: "Income", subtype: "shipping_revenue", normalBalance: "credit" },
  badDebt: { codes: ["6900", "6901"], name: "Bad debt expense", accountType: "Expense", subtype: "bad_debt", normalBalance: "debit" },
  fxGain: { codes: ["4950", "4951"], name: "Realized foreign exchange gains", accountType: "Income", subtype: "fx_realized_gain", normalBalance: "credit" },
  fxLoss: { codes: ["6950", "6951"], name: "Realized foreign exchange losses", accountType: "Expense", subtype: "fx_realized_loss", normalBalance: "debit" },
  fxUnrealizedGain: { codes: ["4960", "4961"], name: "Unrealized foreign exchange gains", accountType: "Income", subtype: "fx_unrealized_gain", normalBalance: "credit" },
  fxUnrealizedLoss: { codes: ["6960", "6961"], name: "Unrealized foreign exchange losses", accountType: "Expense", subtype: "fx_unrealized_loss", normalBalance: "debit" },
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
  if (kind !== "undeposited") return ofType.find((account) => account.subtype === template.subtype);
  return ofType.find((account) => account.subtype === "undeposited_funds") ?? ofType.find((account) => /undeposited/i.test(account.name));
}

export async function loadLedgerAccounts(ctx: PortableQueryCtx, societyId: string): Promise<LedgerAccount[]> {
  return ctx.db.query<LedgerAccount>("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

/** The account of this kind, created on first use when the chart has none. */
export async function ensureLedgerAccount(ctx: PortableMutationCtx, societyId: string, kind: LedgerAccountKind, currency?: string): Promise<LedgerAccount> {
  const accounts = await loadLedgerAccounts(ctx, societyId);
  const existing = findLedgerAccount(kind, currency ? accounts.filter((account) => (account.currency ?? "CAD") === currency) : accounts);
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
    currency: currency ?? accounts.find((account) => account.currency)?.currency ?? "CAD",
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
export function unmappedItems(invoice: Pick<StoredInvoice, "lines" | "discount" | "source" | "money">, lctx: InvoiceLedgerContext): string[] {
  const totals = computeInvoiceTotals(invoice.lines ?? [], invoice.discount, invoice.money);
  return (invoice.lines ?? [])
    .filter((line, index) => totals.lineAmounts[index] !== 0 && !resolveLineRevenue(line, { mapping: lctx.mapping, catalogById: lctx.catalogById, invoiceSource: invoice.source, accountIds: lctx.accountIds }))
    .map((line) => line.item);
}

/** Why the invoice itself can't go into the books (beyond the posting date), empty when it can. */
export function accrualBlockers(invoice: StoredInvoice, lctx: InvoiceLedgerContext): string[] {
  const reasons: string[] = [];
  if (String(invoice.currency || lctx.workspaceCurrency).toUpperCase() !== lctx.workspaceCurrency) {
    try { if (!explicitFxQuote(invoice.money?.fx, invoice.currency, lctx.workspaceCurrency)) reasons.push(`Invoiced in ${invoice.currency}; record an explicit FX quote to ${lctx.workspaceCurrency}.`); }
    catch (error) { reasons.push(error instanceof Error ? error.message : "Invalid FX quote."); }
  }
  const unmapped = unmappedItems(invoice, lctx);
  for (const line of invoice.lines) {
    const mapped = resolveLineRevenue(line, { mapping: lctx.mapping, catalogById: lctx.catalogById, invoiceSource: invoice.source, accountIds: lctx.accountIds });
    const account = mapped && lctx.accountsById.get(mapped.accountId);
    if (account?.currency && account.currency !== lctx.workspaceCurrency) reasons.push(`Revenue account ${account.name} must use books currency ${lctx.workspaceCurrency}.`);
  }
  const taxAccount = lctx.mapping.taxPayableAccountId && lctx.accountsById.get(lctx.mapping.taxPayableAccountId);
  if (taxAccount && taxAccount.currency && taxAccount.currency !== lctx.workspaceCurrency && computeInvoiceTotals(invoice.lines, invoice.discount, invoice.money).taxes.some(tax => tax.cents !== 0)) reasons.push(`Tax account ${taxAccount.name} must use books currency ${lctx.workspaceCurrency}.`);
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
  basis?: JournalBasis;
};

/**
 * Post one balanced entry, once: a posted entry with the same source and key
 * is returned instead of posting twice. Refused inside a closed fiscal period
 * or on or before the books close date.
 */
export async function postLedgerEntry(ctx: PortableMutationCtx, args: PostArgs): Promise<string> {
  const { source, basis: defaultBasis } = INVOICE_POSTINGS[args.kind];
  const basis = args.basis ?? defaultBasis;
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
      ...(line.counterpartyId || counterpartyId ? { counterpartyId: line.counterpartyId ?? counterpartyId } : {}),
      ...(line.programCode ? { programCode: line.programCode } : {}),
      ...(line.grantId ? { grantId: line.grantId } : {}),
      ...(line.fundRestrictionId ? { fundRestrictionId: line.fundRestrictionId } : {}),
      ...(line.documentIds?.length ? { documentIds: line.documentIds } : {}),
      ...(line.sourceExternalId ? { sourceExternalId: line.sourceExternalId } : {}),
      ...(line.rawJson ? { rawJson: line.rawJson } : {}),
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

/** Reclassify an earlier bank posting on the receipt date without removing earlier cash history. */
async function claimPaymentDeposit(ctx: PortableMutationCtx, invoice: StoredInvoice, payment: StoredInvoicePayment, createdByUserId?: string) {
  const entries = await claimableDepositEntries(ctx, payment.financialTransactionId!);
  if (entries.length > 1) throw new Error("This bank transaction has multiple current journal entries. Review them before linking a receipt.");
  const entry = entries[0];
  if (!entry) return {};
  if (entry.date > payment.date) throw new Error("The receipt date must be on or after the bank transaction's current posting date.");
  if (entry.date === payment.date) return { voidedTransactionEntryId: await claimDeposit(ctx, invoice.societyId, payment.financialTransactionId!) };
  const lines = mirrorLines(await entryLines(ctx, entry._id)).map(line => ({ ...line, financialTransactionId: undefined }));
  validateBalancedJournalLines(lines);
  const bankTransferJournalEntryId = await postLedgerEntry(ctx, { societyId: invoice.societyId, kind: "bankTransfer", key: `${paymentEntryKey(invoice._id, payment.key)}:bank-transfer`, date: payment.date, memo: `Reclassify earlier bank transaction to invoice receipt: ${invoice.number}`, basis: journalBasisOf(entry), lines, createdByUserId });
  const txn = await ctx.db.get(payment.financialTransactionId!, "financialTransactions");
  if (!txn || txn.societyId !== invoice.societyId) throw new Error("The linked bank transaction is missing.");
  const previous = txn.invoicePaymentRelease;
  await ctx.db.patch(txn._id, { invoicePaymentRelease: { date: previous && previous.date > payment.date ? previous.date : payment.date, journalEntryIds: [...new Set([...(previous?.journalEntryIds ?? []), entry._id])] } });
  return { replacedTransactionEntryId: entry._id, bankTransferJournalEntryId };
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
    if ([TRANSACTION_BACKFILL_SOURCE, BILL_BANK_RESTORATION_SOURCE, INVOICE_BANK_RESTORATION_SOURCE].includes(String(entry.source)) && entry.status === "posted") {
      claimable.push(entry);
      continue;
    }
    if (INVOICE_POSTING_SOURCES.includes(String(entry.source))) continue;
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
  const receivableAccountId = mapped(lctx.mapping.receivableAccountId) ?? (await ensureLedgerAccount(ctx, invoice.societyId, "receivable", lctx.workspaceCurrency))._id;
  const taxed = computeInvoiceTotals(invoice.lines ?? [], invoice.discount, invoice.money).taxes.some((tax) => tax.cents !== 0);
  const taxPayableAccountId = taxed ? mapped(lctx.mapping.taxPayableAccountId) ?? (await ensureLedgerAccount(ctx, invoice.societyId, "taxPayable", lctx.workspaceCurrency))._id : undefined;
  const totals = computeInvoiceTotals(invoice.lines, invoice.discount, invoice.money);
  const withholdingAccountId = totals.withholdingCents ? (await ensureLedgerAccount(ctx, invoice.societyId, "withholding", lctx.workspaceCurrency))._id : undefined;
  const shippingRevenueAccountId = totals.shippingCents ? (await ensureLedgerAccount(ctx, invoice.societyId, "shippingRevenue", lctx.workspaceCurrency))._id : undefined;
  return { receivableAccountId, taxPayableAccountId, withholdingAccountId, shippingRevenueAccountId };
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
  const totals = computeInvoiceTotals(invoice.lines ?? [], invoice.discount, invoice.money);
  if (!(totals.grossTotalCents > 0)) return { skipped: "Nothing to post: the gross total is zero.", changed: false };
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
    if ((invoice.payments ?? []).some((payment) => !payment.reversedDate && payment.cashBasisEntryId)) {
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
  replacedTransactionEntryId?: string;
  bankTransferJournalEntryId?: string;
  skipped?: string;
  baseAmountCents?: number; bookValueCents?: number; fxGainLossCents?: number;
};

/**
 * Post one payment: Dr the deposit account / Cr receivable, then the
 * cash-basis recognition of the share it pays. Needs the accrual posted
 * (otherwise skipped; "Post existing invoices" posts both later). The
 * deposit account is the linked bank line's (ledger) account, else the one chosen
 * for this payment, else the mapping's, else Undeposited funds.
 */
export async function postPayment(
  ctx: PortableMutationCtx, invoice: StoredInvoice, payment: StoredInvoicePayment,
  lctx: InvoiceLedgerContext, createdByUserId?: string,
): Promise<PaymentPosting> {
  if (payment.reversedDate) return { skipped: "This settlement was reversed." };
  const accrual = await postedEntry(ctx, invoice.societyId, invoice.journalEntryId);
  if (!accrual) return { skipped: "The invoice isn't in the books yet." };
  const block = paymentBlock(payment, lctx);
  if (block) throw new Error(block);
  const accrualLines = await entryLines(ctx, accrual._id);
  const receivableAccountId = accrualLines[0]?.accountId;
  if (!receivableAccountId) throw new Error("The invoice has no receivable line.");
  const kind = payment.kind ?? "payment", adjustment = kind === "credit" || kind === "write_off";
  const foreign = invoice.currency !== lctx.workspaceCurrency;
  if (foreign && !adjustment && (!payment.fxRateMicros || !payment.fxSource?.trim())) throw new Error("Record the actual payment FX rate and source.");
  const previous = (invoice.payments ?? []).filter((row) => row.key !== payment.key && !row.reversedDate);
  const total = computeInvoiceTotals(invoice.lines, invoice.discount, invoice.money).totalCents;
  const remaining = total - paidCents(previous);
  const originalBase = accrualLines[0].amountCents;
  const remainingBase = originalBase - previous.reduce((sum, row) => sum + (row.bookValueCents ?? row.amountCents), 0);
  let book = payment.bookValueCents;
  if (book === undefined) {
    if (payment.amountCents < 0) {
      const original = previous.find((row) => row.key === payment.sourcePaymentKey && (row.kind ?? "payment") === "payment");
      if (!original) throw new Error("Select the original payment to refund.");
      const refunds = previous.filter((row) => row.kind === "refund" && row.sourcePaymentKey === original.key);
      const refundableCents = original.amountCents + refunds.reduce((sum, row) => sum + row.amountCents, 0);
      const refundableBook = (original.bookValueCents ?? original.amountCents) + refunds.reduce((sum, row) => sum + (row.bookValueCents ?? row.amountCents), 0);
      const returnedCents = Math.abs(payment.amountCents);
      // Each partial refund allocates from the remaining carrying value. The last
      // refund consumes its exact remainder, including prior rounding pennies.
      book = -(returnedCents === refundableCents ? refundableBook : Math.round(returnedCents * refundableBook / refundableCents));
    } else book = remaining > 0 ? (payment.amountCents === remaining ? remainingBase : Math.round(remainingBase * payment.amountCents / remaining)) : convertInvoiceCents(payment.amountCents, invoice.money?.fx?.rateMicros ?? 1_000_000);
  }
  const base = adjustment ? book : convertInvoiceCents(payment.amountCents, foreign ? payment.fxRateMicros! : 1_000_000);
  let depositAccountId: string | undefined;
  let bankClaim = { voidedTransactionEntryId: payment.voidedTransactionEntryId, replacedTransactionEntryId: payment.replacedTransactionEntryId, bankTransferJournalEntryId: payment.bankTransferJournalEntryId };
  let posting: InvoiceLedgerLine[], postingKind: InvoicePostingKind = kind === "refund" ? "refund" : "payment";
  if (kind === "credit") {
    const credited: LedgerLineRow[] = [];
    for (const other of previous.filter((row) => row.kind === "credit")) { const entry = await postedEntry(ctx, invoice.societyId, other.journalEntryId); if (entry) credited.push(...mirrorLines(await entryLines(ctx, entry._id)) as LedgerLineRow[]); }
    posting = mirrorLines(cashBasisPostingLines(accrualLines, { paymentCents: Math.abs(book), receivableAccountId, recognised: credited }, `Credit: ${invoice.number}`));
    postingKind = "credit";
  } else if (kind === "write_off") {
    const expense = await ensureLedgerAccount(ctx, invoice.societyId, "badDebt", lctx.workspaceCurrency);
    posting = [{ accountId: expense._id, side: "debit", amountCents: book, description: payment.note || "Invoice written off" }, { accountId: receivableAccountId, side: "credit", amountCents: book }];
    postingKind = "writeOff";
  } else {
    if (payment.financialTransactionId) {
      const txn = await ctx.db.get(payment.financialTransactionId, "financialTransactions");
      if (!txn || txn.societyId !== invoice.societyId) throw new Error("The linked bank transaction is missing.");
      depositAccountId = await cashLedgerAccountId(ctx, invoice.societyId, String(txn.accountId));
    } else depositAccountId = [payment.depositAccountId, lctx.mapping.depositAccountId].find((id): id is string => Boolean(id && lctx.accountIds.has(id))) ?? (await ensureLedgerAccount(ctx, invoice.societyId, "undeposited", lctx.workspaceCurrency))._id;
    const deposit = await ctx.db.get(depositAccountId, "financialAccounts");
    if (!deposit || deposit.societyId !== invoice.societyId || (deposit.currency ?? "CAD") !== lctx.workspaceCurrency) throw new Error(`The settlement deposit account must use books currency ${lctx.workspaceCurrency}.`);
    if (payment.financialTransactionId) bankClaim = { ...bankClaim, ...await claimPaymentDeposit(ctx, invoice, payment, createdByUserId) };
    const gain = await ensureLedgerAccount(ctx, invoice.societyId, "fxGain", lctx.workspaceCurrency), loss = await ensureLedgerAccount(ctx, invoice.societyId, "fxLoss", lctx.workspaceCurrency);
    posting = fxSettlementPostingLines({ ...payment, baseAmountCents: base, bookValueCents: book }, { receivableAccountId, depositAccountId, gainAccountId: gain._id, lossAccountId: loss._id }, `${kind === "refund" ? "Refund" : "Payment"}: ${invoiceLabel(invoice)}`);
  }
  if (!posting.length) throw new Error("This settlement has no remaining amount to post.");
  const journalEntryId = await postLedgerEntry(ctx, { societyId: invoice.societyId, kind: postingKind, key: paymentEntryKey(invoice._id, payment.key), date: payment.date, memo: `${kind}: ${invoiceLabel(invoice)}`, lines: posting, counterpartyId: invoice.counterpartyId, createdByUserId });
  let cashBasisEntryId: string | undefined;
  if (!adjustment) {
    const recognised: LedgerLineRow[] = [];
    for (const other of previous) { const entry = await postedEntry(ctx, invoice.societyId, other.cashBasisEntryId); if (entry) recognised.push(...await entryLines(ctx, entry._id)); }
    let cashLines: InvoiceLedgerLine[];
    if (kind === "refund") {
      const source = previous.find((row) => row.key === payment.sourcePaymentKey)!;
      const sourceEntry = await postedEntry(ctx, invoice.societyId, source.cashBasisEntryId);
      const sourceLines = sourceEntry ? await entryLines(ctx, sourceEntry._id) : [];
      const alreadyRefunded: LedgerLineRow[] = [];
      for (const other of previous.filter((row) => row.kind === "refund" && row.sourcePaymentKey === payment.sourcePaymentKey)) { const entry = await postedEntry(ctx, invoice.societyId, other.cashBasisEntryId); if (entry) alreadyRefunded.push(...mirrorLines(await entryLines(ctx, entry._id)) as LedgerLineRow[]); }
      cashLines = mirrorLines(cashBasisPostingLines(sourceLines, { paymentCents: Math.abs(book), receivableAccountId, recognised: alreadyRefunded }, "Refunded revenue"));
    } else cashLines = cashBasisPostingLines(accrualLines, { paymentCents: Math.abs(book), receivableAccountId, recognised }, `Revenue received: ${invoiceLabel(invoice)}`);
    if (cashLines.length) cashBasisEntryId = await postLedgerEntry(ctx, { societyId: invoice.societyId, kind: kind === "refund" ? "refundCash" : "cashBasis", key: cashBasisKey(invoice._id, payment.key), date: payment.date, memo: `Cash basis ${kind}: ${invoiceLabel(invoice)}`, lines: cashLines, counterpartyId: invoice.counterpartyId, createdByUserId });
  }
  return { journalEntryId, cashBasisEntryId, depositAccountId, ...bankClaim, baseAmountCents: base, bookValueCents: book, fxGainLossCents: adjustment ? 0 : (base - book) };
}

/** Void a payment's entries (refused in a closed period or closed books); its bank line is freed. */
export async function unpostPayment(ctx: PortableMutationCtx, societyId: string, payment: StoredInvoicePayment) {
  await voidLedgerEntry(ctx, societyId, payment.cashBasisEntryId);
  await voidLedgerEntry(ctx, societyId, payment.journalEntryId, { freeTransactions: true });
  await voidLedgerEntry(ctx, societyId, payment.bankTransferJournalEntryId);
}

/** Stored payment fields after a posting (posting refs replaced, nothing else touched). */
export function withPosting(payment: StoredInvoicePayment, posting: PaymentPosting): StoredInvoicePayment {
  const { journalEntryId: _entry, cashBasisEntryId: _cash, voidedTransactionEntryId: _voided, replacedTransactionEntryId: _replaced, bankTransferJournalEntryId: _transfer, ...rest } = payment;
  return {
    ...rest,
    ...(posting.baseAmountCents !== undefined ? { baseAmountCents: posting.baseAmountCents, bookValueCents: posting.bookValueCents, fxGainLossCents: posting.fxGainLossCents } : {}),
    ...(posting.journalEntryId ? { journalEntryId: posting.journalEntryId } : {}),
    ...(posting.cashBasisEntryId ? { cashBasisEntryId: posting.cashBasisEntryId } : {}),
    ...(posting.voidedTransactionEntryId ? { voidedTransactionEntryId: posting.voidedTransactionEntryId } : {}),
    ...(posting.replacedTransactionEntryId ? { replacedTransactionEntryId: posting.replacedTransactionEntryId } : {}),
    ...(posting.bankTransferJournalEntryId ? { bankTransferJournalEntryId: posting.bankTransferJournalEntryId } : {}),
    ...(posting.depositAccountId && !payment.financialTransactionId ? { depositAccountId: posting.depositAccountId } : {}),
  };
}

/** Validate every original before a dated correction writes any mirrors. */
export async function prepareSettlementReversal(ctx: PortableQueryCtx, invoice: StoredInvoice, payment: StoredInvoicePayment, date: string) {
  await assertBooksOpen(ctx, invoice.societyId, [date], "reversed");
  await assertPeriodOpen(ctx, { societyId: invoice.societyId, date });
  const prepared: Array<{ field: "journalEntryId" | "cashBasisEntryId"; output: "reversalJournalEntryId" | "reversalCashBasisEntryId"; lines: InvoiceLedgerLine[] }> = [];
  for (const [field, output] of [["journalEntryId", "reversalJournalEntryId"], ["cashBasisEntryId", "reversalCashBasisEntryId"]] as const) {
    if (!payment[field]) continue;
    const entry = await postedEntry(ctx, invoice.societyId, payment[field]);
    const postingKind = payment.kind === "refund" ? (field === "cashBasisEntryId" ? "refundCash" : "refund") : field === "cashBasisEntryId" ? "cashBasis" : payment.kind === "credit" ? "credit" : payment.kind === "write_off" ? "writeOff" : "payment";
    if (!entry || entry.source !== INVOICE_POSTINGS[postingKind].source || entry.sourceExternalId !== (field === "cashBasisEntryId" ? cashBasisKey(invoice._id, payment.key) : paymentEntryKey(invoice._id, payment.key))) throw new Error("The original settlement journal does not match this posted invoice settlement.");
    const lines = mirrorLines(await entryLines(ctx, entry._id)).map((line) => ({ ...line, financialTransactionId: undefined }));
    validateBalancedJournalLines(lines);
    prepared.push({ field, output, lines });
  }
  return prepared;
}

/** Reverse, rather than erase, a settlement so historical statements remain reproducible. */
export async function reverseSettlementPosting(ctx: PortableMutationCtx, invoice: StoredInvoice, payment: StoredInvoicePayment, date: string, createdByUserId?: string, prepared = undefined as Awaited<ReturnType<typeof prepareSettlementReversal>> | undefined) {
  const result: { reversalJournalEntryId?: string; reversalCashBasisEntryId?: string } = {};
  prepared ??= await prepareSettlementReversal(ctx, invoice, payment, date);
  for (const { field, output, lines } of prepared) {
    result[output] = await postLedgerEntry(ctx, { societyId: invoice.societyId, kind: field === "cashBasisEntryId" ? "cashReversal" : payment.kind === "credit" || payment.kind === "write_off" ? "adjustmentReversal" : "settlementReversal", key: `${paymentEntryKey(invoice._id, payment.key)}:reversal:${field}`, date, memo: `Reversal: ${payment.kind ?? "payment"} ${invoice.number}`, lines, counterpartyId: invoice.counterpartyId, createdByUserId });
  }
  return result;
}

/** Realize subsequent settlements at historical cost; the prior unrealized mark is reversed explicitly. */
export async function reverseOpenInvoiceRevaluations(ctx: PortableMutationCtx, invoice: StoredInvoice, date: string, createdByUserId?: string) {
  const values = [...(invoice.fxRevaluations ?? [])];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value.reversedDate) continue;
    if (value.date > date) throw new Error("The settlement date is before the latest FX revaluation. Reverse or correct that revaluation first.");
    const entry = await postedEntry(ctx, invoice.societyId, value.journalEntryId);
    const reversalJournalEntryId = entry ? await postLedgerEntry(ctx, { societyId: invoice.societyId, kind: "revaluationReversal", key: `invoice:${invoice._id}:fx:${value.key}:reversal`, date, memo: `Reverse unrealized FX: ${invoice.number}`, lines: mirrorLines(await entryLines(ctx, entry._id)), counterpartyId: invoice.counterpartyId, createdByUserId }) : undefined;
    values[index] = { ...value, reversedDate: date, ...(reversalJournalEntryId ? { reversalJournalEntryId } : {}) };
  }
  return values;
}
