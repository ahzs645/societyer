/**
 * Invoices in the books: pure helpers shared by the portable handlers
 * (shared/functions/invoices.ts, shared/functions/invoiceLedger.ts), the
 * demo generator, the Invoices page and the gate.
 *
 * Ledger shape (see docs/accounting-shape.md, "Accounting basis"):
 *  - Sending an invoice posts the accrual, source "invoice", basis
 *    "accrual-only": Dr Accounts receivable for the total / Cr each line's
 *    revenue account (its amount after the discount share, with the line's
 *    tags) / Cr the tax payable account for each tax.
 *  - Voiding a posted invoice posts the mirror of the accrual, source
 *    "invoice_accrual", basis "accrual-only".
 *  - Each payment posts Dr the deposit account (the linked bank line's
 *    account, a chosen account, or Undeposited funds) / Cr Accounts
 *    receivable, source "invoice_payment", basis "both", and the cash-basis
 *    recognition of the paid share, source "invoice_cash_basis", basis
 *    "cash-only": Dr Accounts receivable / Cr the accrual's revenue and tax
 *    lines pro rata, so cash reports see revenue on the payment date and
 *    receivables net to zero.
 *
 * Every posting's `sourceExternalId` starts with `invoice:<invoiceId>`:
 * the accrual is `invoice:<id>` (`invoice:<id>:r<n>` after a void and
 * restore), its reversal adds `:reversal`, a payment is
 * `invoice:<id>:payment:<paymentKey>` and its cash-basis recognition adds
 * `:cash`.
 *
 * "Needs action" flags are derived on read, never stored.
 *
 * Money is integer cents. Dates are `YYYY-MM-DD`. Pure TypeScript.
 */
import { convertInvoiceCents, allocateMoney, type InvoiceMoneyOptions, type InvoicePayment, allocateProportionally, computeInvoiceTotals, type InvoiceDiscount, type InvoiceLine } from "./invoicing";

/* ---------------------------------------------------------------- sources */

export const INVOICE_POSTINGS = {
  accrual: { source: "invoice", basis: "accrual-only" },
  accrualReversal: { source: "invoice_accrual", basis: "accrual-only" },
  payment: { source: "invoice_payment", basis: "both" },
  cashBasis: { source: "invoice_cash_basis", basis: "cash-only" },
  credit: { source: "invoice_credit", basis: "accrual-only" },
  writeOff: { source: "invoice_write_off", basis: "accrual-only" },
  refund: { source: "invoice_refund", basis: "both" },
  refundCash: { source: "invoice_refund_cash", basis: "cash-only" },
  revaluation: { source: "invoice_fx_revaluation", basis: "accrual-only" },
  revaluationReversal: { source: "invoice_fx_revaluation_reversal", basis: "accrual-only" },
  settlementReversal: { source: "invoice_settlement_reversal", basis: "both" },
  adjustmentReversal: { source: "invoice_adjustment_reversal", basis: "accrual-only" },
  cashReversal: { source: "invoice_cash_reversal", basis: "cash-only" },
  bankRestoration: { source: "invoice_bank_restoration", basis: "both" },
  bankTransfer: { source: "invoice_bank_transfer", basis: "both" },
} as const;

export type InvoicePostingKind = keyof typeof INVOICE_POSTINGS;

/** Every source an invoice posting can carry (for lookups and gates). */
export const INVOICE_POSTING_SOURCES: readonly string[] = Object.values(INVOICE_POSTINGS).map((posting) => posting.source);

export function accrualKey(invoiceId: string, round = 1): string {
  return round > 1 ? `invoice:${invoiceId}:r${round}` : `invoice:${invoiceId}`;
}

export function accrualReversalKey(invoiceId: string, round = 1): string {
  return `${accrualKey(invoiceId, round)}:reversal`;
}

export function paymentEntryKey(invoiceId: string, paymentKey: string): string {
  return `invoice:${invoiceId}:payment:${paymentKey}`;
}

export function cashBasisKey(invoiceId: string, paymentKey: string): string {
  return `${paymentEntryKey(invoiceId, paymentKey)}:cash`;
}

/* ---------------------------------------------------------------- mapping */

export type CategoryAccount = { category: string; accountId: string };

/** Invoice settings that say where invoices land in the books. */
export type InvoiceGlMapping = {
  receivableAccountId?: string | null;
  taxPayableAccountId?: string | null;
  defaultRevenueAccountId?: string | null;
  /** Where payments that aren't linked to a bank line are deposited (Undeposited funds when unset). */
  depositAccountId?: string | null;
  categoryAccounts?: ReadonlyArray<CategoryAccount> | null;
};

export type CatalogMappingRef = { _id: string; accountingAccountId?: string | null; category?: string | null };

/** Dues invoices drafted from fee tiers carry no catalog item; they map through this category. */
export const DUES_REVENUE_CATEGORY = "Membership fees";

export function normalizeRevenueCategory(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/** The revenue category of a line: its catalog item's category, or membership fees for a dues invoice. */
export function lineRevenueCategory(line: Pick<InvoiceLine, "catalogItemId">, catalogById: ReadonlyMap<string, CatalogMappingRef>, invoiceSource?: string | null): string | undefined {
  const item = line.catalogItemId ? catalogById.get(line.catalogItemId) : undefined;
  if (item?.category) return item.category;
  if (!item && invoiceSource === "dues") return DUES_REVENUE_CATEGORY;
  return undefined;
}

export type RevenueResolution = { accountId: string; via: "item" | "category" | "default" };

/**
 * Where one line's revenue goes: the catalog item's account, else its
 * category's account, else the default revenue account. Accounts that no
 * longer exist (`accountIds`) are skipped. Null when nothing applies.
 */
export function resolveLineRevenue(
  line: Pick<InvoiceLine, "catalogItemId">,
  context: { mapping: InvoiceGlMapping; catalogById: ReadonlyMap<string, CatalogMappingRef>; invoiceSource?: string | null; accountIds: ReadonlySet<string> },
): RevenueResolution | null {
  const usable = (id: string | null | undefined): id is string => Boolean(id && context.accountIds.has(id));
  const item = line.catalogItemId ? context.catalogById.get(line.catalogItemId) : undefined;
  if (usable(item?.accountingAccountId)) return { accountId: item!.accountingAccountId!, via: "item" };
  const category = normalizeRevenueCategory(lineRevenueCategory(line, context.catalogById, context.invoiceSource));
  if (category) {
    const match = (context.mapping.categoryAccounts ?? []).find((row) => normalizeRevenueCategory(row.category) === category && usable(row.accountId));
    if (match) return { accountId: match.accountId, via: "category" };
  }
  if (usable(context.mapping.defaultRevenueAccountId)) return { accountId: context.mapping.defaultRevenueAccountId!, via: "default" };
  return null;
}

/* ---------------------------------------------------------------- posting */

export type InvoiceLedgerLine = {
  accountId: string;
  side: "debit" | "credit";
  amountCents: number;
  description?: string;
  tagIds?: string[];
  financialTransactionId?: string;
  programCode?: string;
  counterpartyId?: string;
  grantId?: string;
  fundRestrictionId?: string;
  documentIds?: string[];
  sourceExternalId?: string;
  rawJson?: string;
};

export type InvoiceForPosting = {
  number: string;
  billToName: string;
  lines: InvoiceLine[];
  discount?: InvoiceDiscount | null;
  money?: InvoiceMoneyOptions;
};

export function invoiceLabel(invoice: Pick<InvoiceForPosting, "number" | "billToName">): string {
  return `${invoice.number} · ${invoice.billToName}`;
}

/** Lines on one account with the same tags post as one line; this is their key. */
function ledgerLineKey(line: { accountId: string; tagIds?: readonly string[] }): string {
  return `${line.accountId}|${JSON.stringify([...(line.tagIds ?? [])].map(String).sort())}`;
}

/**
 * The accrual: Dr receivable for the total; then the revenue and tax, netted
 * per account (and tags) so a negative line (a credit or refund) offsets the
 * revenue it reverses and a negative line's tax offsets the tax collected.
 * Each line's amount is less its share of the discount; zero lines are left
 * out. A net credit posts as a credit, a net debit (more given back than
 * charged on that account) as a debit. `revenueFor` returns the account for
 * each line (by index), or null when it has none, which throws.
 */
export function accrualPostingLines(
  invoice: InvoiceForPosting,
  revenueFor: (line: InvoiceLine, index: number) => string | null,
  accounts: { receivableAccountId: string; taxPayableAccountId?: string | null; withholdingAccountId?: string; shippingRevenueAccountId?: string },
): InvoiceLedgerLine[] {
  const totals = computeInvoiceTotals(invoice.lines, invoice.discount, invoice.money);
  if (!(totals.grossTotalCents > 0)) throw new Error("Only invoices with a gross total above zero go into the books.");
  const shares = allocateProportionally(totals.discountCents, totals.lineAmounts);
  const nets = new Map<string, { accountId: string; tagIds?: string[]; descriptions: string[]; signedCents: number }>();
  const add = (accountId: string, signedCents: number, description: string, tagIds?: readonly string[]) => {
    const key = ledgerLineKey({ accountId, tagIds });
    const row = nets.get(key) ?? { accountId, ...(tagIds?.length ? { tagIds: [...tagIds] } : {}), descriptions: [], signedCents: 0 };
    row.signedCents += signedCents;
    if (description && !row.descriptions.includes(description)) row.descriptions.push(description);
    nets.set(key, row);
  };
  invoice.lines.forEach((line, index) => {
    const amountCents = totals.lineNetCents[index];
    if (amountCents === 0) return;
    const accountId = revenueFor(line, index);
    if (!accountId) throw new Error(`Line ${index + 1} (${line.item}) has no revenue account. Map it under Edit GL account mapping.`);
    add(accountId, amountCents, line.item, line.tagIds);
  });
  if (totals.shippingCents) {
    const accountId = accounts.shippingRevenueAccountId ?? revenueFor(invoice.lines[0], 0);
    if (!accountId) throw new Error("Choose a shipping revenue account.");
    add(accountId, totals.shippingCents, "Shipping charges");
  }
  for (const tax of totals.taxes) {
    if (!tax.cents) continue;
    if (!accounts.taxPayableAccountId) throw new Error("Choose the account sales tax is collected to under Edit GL account mapping.");
    add(accounts.taxPayableAccountId, tax.cents, `${tax.label} ${tax.ratePercent}% collected`);
  }
  const credits: InvoiceLedgerLine[] = [];
  for (const row of nets.values()) {
    if (row.signedCents === 0) continue;
    credits.push({
      accountId: row.accountId,
      side: row.signedCents > 0 ? "credit" : "debit",
      amountCents: Math.abs(row.signedCents),
      description: row.descriptions.join(", "),
      ...(row.tagIds?.length ? { tagIds: row.tagIds } : {}),
    });
  }
  const debit: InvoiceLedgerLine[] = [{ accountId: accounts.receivableAccountId, side: "debit", amountCents: totals.totalCents, description: `Accounts receivable: ${invoiceLabel(invoice)}` }];
  if (totals.withholdingCents) {
    if (!accounts.withholdingAccountId) throw new Error("Choose a withholding tax receivable account.");
    debit.push({ accountId: accounts.withholdingAccountId, side: "debit", amountCents: totals.withholdingCents, description: "Tax withheld by customer" });
  }
  return convertPostingLines([...debit, ...credits], invoice.money?.fx?.rateMicros ?? 1_000_000);
}

/** The payment: Dr the deposit account / Cr receivable, both lines carrying a linked bank line. */
export function paymentPostingLines(
  payment: { amountCents: number; financialTransactionId?: string | null; reference?: string | null },
  accounts: { depositAccountId: string; receivableAccountId: string },
  label = "Invoice payment",
): InvoiceLedgerLine[] {
  if (!(payment.amountCents > 0)) throw new Error("A payment must be above zero.");
  const link = payment.financialTransactionId ? { financialTransactionId: payment.financialTransactionId } : {};
  const description = payment.reference ? `${label} (${payment.reference})` : label;
  return [
    { accountId: accounts.depositAccountId, side: "debit", amountCents: payment.amountCents, description, ...link },
    { accountId: accounts.receivableAccountId, side: "credit", amountCents: payment.amountCents, description, ...link },
  ];
}

type CashBasisSourceLine = { accountId: string; side: string; amountCents: number; description?: string; tagIds?: readonly string[] };

/**
 * What is still unrecognised on each of the accrual's revenue and tax lines
 * (by account and tags, credit positive): the accrual less every earlier
 * cash-basis recognition (`recognised`, the lines of the invoice's other
 * live cash-basis entries). Receivable lines are left out.
 */
export function unrecognisedInvoiceRevenue(
  accrualLines: ReadonlyArray<CashBasisSourceLine>,
  recognised: ReadonlyArray<CashBasisSourceLine>,
  receivableAccountId: string,
) {
  const buckets = new Map<string, { accountId: string; description?: string; tagIds?: string[]; remainingCents: number }>();
  const signed = (line: CashBasisSourceLine) => (line.side === "credit" ? line.amountCents : -line.amountCents);
  for (const line of accrualLines) {
    if (String(line.accountId) === String(receivableAccountId)) continue;
    const key = ledgerLineKey(line);
    const bucket = buckets.get(key) ?? { accountId: String(line.accountId), description: line.description, ...(line.tagIds?.length ? { tagIds: [...line.tagIds].map(String) } : {}), remainingCents: 0 };
    bucket.remainingCents += signed(line);
    buckets.set(key, bucket);
  }
  for (const line of recognised) {
    if (String(line.accountId) === String(receivableAccountId)) continue;
    const bucket = buckets.get(ledgerLineKey(line));
    if (bucket) bucket.remainingCents -= signed(line);
  }
  return [...buckets.values()];
}

/**
 * The cash-basis recognition of one payment: Dr Accounts receivable for the
 * payment, and the accrual's revenue and tax recognised in proportion to
 * what is still unrecognised on each (credits for revenue and tax, debits
 * for a line that nets to a debit). Each share is capped at its line's
 * remainder, so recognition never runs past the accrual, and a payment that
 * clears the balance takes every remainder exactly. Earlier recognitions
 * come from the invoice's other live cash-basis entries (`recognised`), so
 * removing a payment (voiding its entry) puts its share back. Anything paid
 * beyond the total is not revenue and is left out. Empty when nothing is
 * left to recognise.
 */
export function cashBasisPostingLines(
  accrualLines: ReadonlyArray<CashBasisSourceLine>,
  input: { paymentCents: number; receivableAccountId: string; recognised?: ReadonlyArray<CashBasisSourceLine> },
  label = "Revenue received",
): InvoiceLedgerLine[] {
  const buckets = unrecognisedInvoiceRevenue(accrualLines, input.recognised ?? [], input.receivableAccountId);
  const positives = buckets.filter((bucket) => bucket.remainingCents > 0);
  const negatives = buckets.filter((bucket) => bucket.remainingCents < 0);
  const positiveCents = positives.reduce((sum, bucket) => sum + bucket.remainingCents, 0);
  const negativeCents = negatives.reduce((sum, bucket) => sum - bucket.remainingCents, 0);
  const remainingCents = positiveCents - negativeCents;
  const paymentCents = Math.min(Math.round(input.paymentCents), remainingCents);
  if (!(paymentCents > 0)) return [];
  // Recognise the same fraction of the debit lines; the credits cover the payment plus that.
  const debitShareCents = paymentCents === remainingCents ? negativeCents : Math.min(negativeCents, Math.round((paymentCents * negativeCents) / remainingCents));
  const creditShareCents = paymentCents + debitShareCents;
  const creditShares = allocateProportionally(creditShareCents, positives.map((bucket) => bucket.remainingCents));
  const debitShares = allocateProportionally(debitShareCents, negatives.map((bucket) => -bucket.remainingCents));
  const lines: InvoiceLedgerLine[] = [];
  const push = (bucket: (typeof buckets)[number], side: "debit" | "credit", amountCents: number) => {
    if (amountCents <= 0) return;
    lines.push({ accountId: bucket.accountId, side, amountCents, description: bucket.description, ...(bucket.tagIds?.length ? { tagIds: [...bucket.tagIds] } : {}) });
  };
  for (const bucket of buckets) {
    const positive = positives.indexOf(bucket);
    if (positive >= 0) push(bucket, "credit", creditShares[positive]);
    const negative = negatives.indexOf(bucket);
    if (negative >= 0) push(bucket, "debit", debitShares[negative]);
  }
  return [{ accountId: input.receivableAccountId, side: "debit", amountCents: paymentCents, description: label }, ...lines];
}

/** The net of each account and tag set (debits positive): two line sets that post the same. */
export function sameLedgerNet(a: ReadonlyArray<ComparableLine>, b: ReadonlyArray<ComparableLine>): boolean {
  const net = (lines: ReadonlyArray<ComparableLine>) => {
    const byKey = new Map<string, number>();
    for (const line of lines) {
      const key = ledgerLineKey({ accountId: String(line.accountId), tagIds: line.tagIds });
      byKey.set(key, (byKey.get(key) ?? 0) + (line.side === "debit" ? line.amountCents : -line.amountCents));
    }
    return byKey;
  };
  const left = net(a);
  const right = net(b);
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys].every((key) => (left.get(key) ?? 0) === (right.get(key) ?? 0));
}

/** The mirror of an entry's lines (debits become credits), for a reversal. */
export function mirrorLines<T extends { side: string }>(lines: ReadonlyArray<T>): Array<T & { side: "debit" | "credit" }> {
  return lines.map((line) => ({ ...line, side: line.side === "debit" ? "credit" : "debit" }));
}

/** Debits, credits and whether they balance. */
export function ledgerBalance(lines: ReadonlyArray<{ side: string; amountCents: number }>) {
  let debitCents = 0;
  let creditCents = 0;
  for (const line of lines) {
    if (line.side === "debit") debitCents += line.amountCents;
    else creditCents += line.amountCents;
  }
  return { debitCents, creditCents, balanced: debitCents === creditCents && debitCents > 0 };
}

/** Same accounts, sides, amounts and tags in the same order. */
type ComparableLine = { accountId: string; side: string; amountCents: number; tagIds?: readonly string[] };

export function sameLedgerLines(a: ReadonlyArray<ComparableLine>, b: ReadonlyArray<ComparableLine>): boolean {
  const tags = (ids: readonly string[] | undefined) => JSON.stringify([...(ids ?? [])].map(String).sort());
  return a.length === b.length && a.every((line, index) =>
    String(line.accountId) === String(b[index].accountId) && line.side === b[index].side && line.amountCents === b[index].amountCents && tags(line.tagIds) === tags(b[index].tagIds));
}

/* ------------------------------------------------------------ books start */

/**
 * When the books start: the opening-balance entry's date (activity on or
 * before it is in the opening balances, the backfill's cutoff), else the
 * Books settings start date (activity before it).
 */
export type BooksStart = { openingBalanceDate: string | null; booksStartDate: string | null };

export function isBeforeBooksStart(date: string, start: BooksStart): boolean {
  if (start.openingBalanceDate) return date <= start.openingBalanceDate;
  if (start.booksStartDate) return date < start.booksStartDate;
  return false;
}

export function booksStartLabel(start: BooksStart): string | null {
  if (start.openingBalanceDate) return `the opening balances on ${start.openingBalanceDate}`;
  if (start.booksStartDate) return `the books start date, ${start.booksStartDate}`;
  return null;
}

/* ----------------------------------------------------------- needs action */

export const NEEDS_ACTION_CODES = ["overpaid", "deposit_unlinked", "deposit_mismatch", "unmapped_revenue", "before_books_start", "foreign_currency"] as const;
export type NeedsActionCode = (typeof NEEDS_ACTION_CODES)[number];

/** What the fix button does on the Invoices page. */
export type NeedsActionFix = "edit_mapping" | "link_deposit" | "review_payments" | "record_manually";

export type NeedsActionFlag = {
  code: NeedsActionCode;
  title: string;
  detail: string;
  fix: NeedsActionFix;
  fixLabel: string;
  paymentKey?: string;
};

export type NeedsActionPayment = {
  key: string;
  date: string;
  amountCents: number;
  financialTransactionId?: string | null;
  /** The linked bank line's amount; null when the link points at a line that no longer exists. */
  transactionAmountCents?: number | null;
};

export type NeedsActionInput = {
  lifecycle: string;
  totalCents: number;
  paidCents: number;
  currency: string;
  issueDate: string;
  payments: ReadonlyArray<NeedsActionPayment>;
  /** Item names of lines with no revenue account. */
  unmappedItems: ReadonlyArray<string>;
  /** The accrual is posted: what keeps an invoice out of the books no longer applies. */
  accrualPosted?: boolean;
  fxQuoteAvailable?: boolean;
};

function centsText(cents: number) {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Why a sent invoice doesn't reconcile cleanly with the books, each with a
 * plain explanation and the fix. Drafts and void invoices have none.
 */
export function invoiceNeedsAction(invoice: NeedsActionInput, context: { workspaceCurrency: string; booksStart: BooksStart }): NeedsActionFlag[] {
  if (invoice.lifecycle !== "sent") return [];
  const flags: NeedsActionFlag[] = [];
  const currency = String(invoice.currency || context.workspaceCurrency).toUpperCase();
  if (currency !== context.workspaceCurrency.toUpperCase() && !invoice.accrualPosted && !invoice.fxQuoteAvailable) {
    flags.push({
      code: "foreign_currency",
      title: `Invoiced in ${currency}`,
      detail: `The books are kept in ${context.workspaceCurrency}, so this invoice needs an explicit, dated FX quote before it can post automatically.`,
      fix: "record_manually",
      fixLabel: "Open journal entries",
    });
  }
  if (invoice.paidCents > invoice.totalCents) {
    flags.push({
      code: "overpaid",
      title: "Overpaid",
      detail: `Payments of ${centsText(invoice.paidCents)} are ${centsText(invoice.paidCents - invoice.totalCents)} more than the ${centsText(invoice.totalCents)} total. Remove the extra payment, or refund or credit the customer.`,
      fix: "review_payments",
      fixLabel: "Review payments",
    });
  }
  if (invoice.unmappedItems.length && invoice.accrualPosted) {
    // Posted while mapped; the mapping has since gone. A hint, not a blocker.
    const items = [...new Set(invoice.unmappedItems)];
    flags.push({
      code: "unmapped_revenue",
      title: "Revenue account unmapped",
      detail: `The invoice is in the books, but ${items.slice(0, 3).join(", ")}${items.length > 3 ? ` and ${items.length - 3} more` : ""} no longer ${items.length === 1 ? "has" : "have"} a revenue account. Map it before editing the invoice's lines, or the edit will be refused.`,
      fix: "edit_mapping",
      fixLabel: "Edit GL account mapping",
    });
  } else if (invoice.unmappedItems.length) {
    const items = [...new Set(invoice.unmappedItems)];
    flags.push({
      code: "unmapped_revenue",
      title: "No revenue account",
      detail: `${items.slice(0, 3).join(", ")}${items.length > 3 ? ` and ${items.length - 3} more` : ""} ${items.length === 1 ? "has" : "have"} no revenue account, so the invoice isn't in the books. Map the item or its category, or set a default revenue account.`,
      fix: "edit_mapping",
      fixLabel: "Edit GL account mapping",
    });
  }
  const startLabel = booksStartLabel(context.booksStart);
  if (startLabel && isBeforeBooksStart(invoice.issueDate, context.booksStart)) {
    flags.push({
      code: "before_books_start",
      title: "Issued before the books start",
      detail: `It was issued before ${startLabel}, so it isn't posted. If it was still owed then, its balance belongs in the opening receivables; record anything else with a journal entry.`,
      fix: "record_manually",
      fixLabel: "Open journal entries",
    });
  } else if (startLabel) {
    const early = invoice.payments.filter((payment) => isBeforeBooksStart(payment.date, context.booksStart));
    if (early.length) {
      flags.push({
        code: "before_books_start",
        title: "Payment before the books start",
        detail: `${early.length === 1 ? `The ${centsText(early[0].amountCents)} payment on ${early[0].date} is` : `${early.length} payments are`} dated before ${startLabel}, so ${early.length === 1 ? "it isn't" : "they aren't"} posted and the receivable stays open in the books. Check the payment date, or record it against the opening balances.`,
        fix: "review_payments",
        fixLabel: "Review payments",
        paymentKey: early[0].key,
      });
    }
  }
  const paid = invoice.totalCents > 0 && invoice.paidCents >= invoice.totalCents;
  for (const payment of invoice.payments) {
    if (payment.financialTransactionId) {
      if (payment.transactionAmountCents == null) {
        flags.push({ code: "deposit_mismatch", title: "Deposit missing", detail: `The bank deposit linked to the ${centsText(payment.amountCents)} payment on ${payment.date} is no longer in the bank feed. Link the deposit again.`, fix: "link_deposit", fixLabel: "Link deposit", paymentKey: payment.key });
      } else if (payment.transactionAmountCents !== payment.amountCents) {
        flags.push({ code: "deposit_mismatch", title: "Deposit doesn't match", detail: `The ${centsText(payment.amountCents)} payment on ${payment.date} is linked to a ${centsText(payment.transactionAmountCents)} deposit. Split the payment to match, or link the right deposit.`, fix: "link_deposit", fixLabel: "Link deposit", paymentKey: payment.key });
      }
    }
  }
  if (paid) {
    const unlinked = invoice.payments.filter((payment) => !payment.financialTransactionId);
    if (unlinked.length) {
      flags.push({
        code: "deposit_unlinked",
        title: "Deposit not linked",
        detail: `${unlinked.length === 1 ? `The ${centsText(unlinked[0].amountCents)} payment on ${unlinked[0].date} isn't` : `${unlinked.length} payments aren't`} linked to a bank deposit, so the money sits in Undeposited funds (or the account you chose) and the bank line could be counted again. Link the deposit from the bank feed.`,
        fix: "link_deposit",
        fixLabel: "Link deposit",
        paymentKey: unlinked[0].key,
      });
    }
  }
  return flags;
}

/** Codes that keep an invoice (not just one payment) out of the books (never raised once its accrual is posted). */
export const ACCRUAL_BLOCKING_CODES: ReadonlySet<NeedsActionCode> = new Set(["foreign_currency", "unmapped_revenue"]);

/** Non-void invoices in a currency other than the books' (the banner). */
export function foreignCurrencySummary(invoices: ReadonlyArray<{ lifecycle: string; currency: string }>, workspaceCurrency: string) {
  const rows = invoices.filter((invoice) => invoice.lifecycle !== "void" && String(invoice.currency || workspaceCurrency).toUpperCase() !== workspaceCurrency.toUpperCase());
  return { count: rows.length, currencies: [...new Set(rows.map((invoice) => String(invoice.currency).toUpperCase()))].sort() };
}


/** Translate both balanced sides using the same rounded base total. */
export function convertPostingLines(lines: InvoiceLedgerLine[], rateMicros: number): InvoiceLedgerLine[] {
  if (rateMicros === 1_000_000) return lines.filter((line) => line.amountCents > 0);
  const debits = lines.filter((line) => line.side === "debit"), credits = lines.filter((line) => line.side === "credit");
  const total = debits.reduce((sum, line) => sum + line.amountCents, 0);
  if (total !== credits.reduce((sum, line) => sum + line.amountCents, 0)) throw new Error("The source posting is not balanced.");
  const baseTotal = convertInvoiceCents(total, rateMicros);
  const amounts = new Map<InvoiceLedgerLine, number>();
  for (const side of [debits, credits]) {
    if(side===debits&&side.length>1){const first=convertInvoiceCents(side[0].amountCents,rateMicros);amounts.set(side[0],first);allocateMoney(baseTotal-first,side.slice(1).map(line=>line.amountCents)).forEach((amount,index)=>amounts.set(side[index+1],amount));}
    else allocateMoney(baseTotal, side.map((line) => line.amountCents)).forEach((amount, index) => amounts.set(side[index], amount));
  }
  return lines.map((line) => ({ ...line, amountCents: amounts.get(line)! })).filter((line) => line.amountCents > 0);
}
export function fxSettlementPostingLines(input: { amountCents: number; baseAmountCents: number; bookValueCents: number; financialTransactionId?: string; kind?: InvoicePayment["kind"] }, accounts: { receivableAccountId: string; depositAccountId: string; gainAccountId: string; lossAccountId: string }, description: string): InvoiceLedgerLine[] {
  const refund = input.amountCents < 0;
  const cash = Math.abs(input.baseAmountCents), book = Math.abs(input.bookValueCents);
  const link = input.financialTransactionId ? { financialTransactionId: input.financialTransactionId } : {};
  const lines: InvoiceLedgerLine[] = [
    { accountId: accounts.depositAccountId, side: refund ? "credit" : "debit", amountCents: cash, description, ...link },
    { accountId: accounts.receivableAccountId, side: refund ? "debit" : "credit", amountCents: book, description, ...link },
  ];
  const gain = (cash - book) * (refund ? -1 : 1);
  if (gain) lines.push({ accountId: gain > 0 ? accounts.gainAccountId : accounts.lossAccountId, side: gain > 0 ? "credit" : "debit", amountCents: Math.abs(gain), description: "Realized foreign exchange difference" });
  return lines.filter((line) => line.amountCents > 0);
}
