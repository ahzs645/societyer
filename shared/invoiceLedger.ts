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
import { allocateProportionally, computeInvoiceTotals, type InvoiceDiscount, type InvoiceLine } from "./invoicing";

/* ---------------------------------------------------------------- sources */

export const INVOICE_POSTINGS = {
  accrual: { source: "invoice", basis: "accrual-only" },
  accrualReversal: { source: "invoice_accrual", basis: "accrual-only" },
  payment: { source: "invoice_payment", basis: "both" },
  cashBasis: { source: "invoice_cash_basis", basis: "cash-only" },
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
};

export type InvoiceForPosting = {
  number: string;
  billToName: string;
  lines: InvoiceLine[];
  discount?: InvoiceDiscount | null;
};

export function invoiceLabel(invoice: Pick<InvoiceForPosting, "number" | "billToName">): string {
  return `${invoice.number} · ${invoice.billToName}`;
}

/**
 * The accrual: Dr receivable for the total; Cr each line's revenue account
 * for its amount less its share of the discount (zero lines left out), with
 * the line's tags; Cr tax payable once per tax. `revenueFor` returns the
 * account for each line (by index), or null when it has none, which throws.
 */
export function accrualPostingLines(
  invoice: InvoiceForPosting,
  revenueFor: (line: InvoiceLine, index: number) => string | null,
  accounts: { receivableAccountId: string; taxPayableAccountId?: string | null },
): InvoiceLedgerLine[] {
  const totals = computeInvoiceTotals(invoice.lines, invoice.discount);
  if (!(totals.totalCents > 0)) throw new Error("Only invoices with a total above zero go into the books.");
  const shares = allocateProportionally(totals.discountCents, totals.lineAmounts);
  const credits: InvoiceLedgerLine[] = [];
  invoice.lines.forEach((line, index) => {
    const amountCents = totals.lineAmounts[index] - shares[index];
    if (amountCents === 0) return;
    const accountId = revenueFor(line, index);
    if (!accountId) throw new Error(`Line ${index + 1} (${line.item}) has no revenue account. Map it under Edit GL account mapping.`);
    credits.push({
      accountId,
      side: amountCents > 0 ? "credit" : "debit",
      amountCents: Math.abs(amountCents),
      description: line.item,
      ...(line.tagIds?.length ? { tagIds: [...line.tagIds] } : {}),
    });
  });
  for (const tax of totals.taxes) {
    if (!tax.cents) continue;
    if (!accounts.taxPayableAccountId) throw new Error("Choose the account sales tax is collected to under Edit GL account mapping.");
    credits.push({ accountId: accounts.taxPayableAccountId, side: "credit", amountCents: tax.cents, description: `${tax.label} ${tax.ratePercent}% collected` });
  }
  return [{ accountId: accounts.receivableAccountId, side: "debit", amountCents: totals.totalCents, description: `Accounts receivable: ${invoiceLabel(invoice)}` }, ...credits];
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

/**
 * The cash-basis recognition of one payment: the accrual's credit lines
 * (revenue and tax), each taken pro rata to the payment, credited again,
 * and the receivable debited for their sum. Shares are cumulative over the
 * invoice (`paidBeforeCents` is what earlier payments covered), so once the
 * invoice is paid the recognitions add up to the accrual exactly. Anything
 * paid beyond the total is not revenue and is left out. Empty when nothing
 * is left to recognise.
 */
export function cashBasisPostingLines(
  accrualCredits: ReadonlyArray<{ accountId: string; side: string; amountCents: number; description?: string; tagIds?: string[] }>,
  input: { totalCents: number; paidBeforeCents: number; paymentCents: number; receivableAccountId: string },
  label = "Revenue received",
): InvoiceLedgerLine[] {
  const credits = accrualCredits.filter((line) => line.side === "credit");
  const weights = credits.map((line) => line.amountCents);
  const cumulative = (paid: number) => allocateProportionally(Math.max(0, Math.min(input.totalCents, paid)), weights);
  const before = cumulative(input.paidBeforeCents);
  const after = cumulative(input.paidBeforeCents + input.paymentCents);
  const lines: InvoiceLedgerLine[] = [];
  credits.forEach((line, index) => {
    const share = after[index] - before[index];
    if (share <= 0) return;
    lines.push({ accountId: line.accountId, side: "credit", amountCents: share, description: line.description, ...(line.tagIds?.length ? { tagIds: [...line.tagIds] } : {}) });
  });
  const recognised = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (!recognised) return [];
  return [{ accountId: input.receivableAccountId, side: "debit", amountCents: recognised, description: label }, ...lines];
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
  if (currency !== context.workspaceCurrency.toUpperCase()) {
    flags.push({
      code: "foreign_currency",
      title: `Invoiced in ${currency}`,
      detail: `The books are kept in ${context.workspaceCurrency}, so this invoice isn't posted automatically. Record it with a manual journal entry at the exchange rate you received.`,
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
  if (invoice.unmappedItems.length) {
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

/** Codes that keep an invoice (not just one payment) out of the books. */
export const ACCRUAL_BLOCKING_CODES: ReadonlySet<NeedsActionCode> = new Set(["foreign_currency", "unmapped_revenue"]);

/** Non-void invoices in a currency other than the books' (the banner). */
export function foreignCurrencySummary(invoices: ReadonlyArray<{ lifecycle: string; currency: string }>, workspaceCurrency: string) {
  const rows = invoices.filter((invoice) => invoice.lifecycle !== "void" && String(invoice.currency || workspaceCurrency).toUpperCase() !== workspaceCurrency.toUpperCase());
  return { count: rows.length, currencies: [...new Set(rows.map((invoice) => String(invoice.currency).toUpperCase()))].sort() };
}
