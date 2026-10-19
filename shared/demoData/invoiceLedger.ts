/**
 * The invoicing demo in the books: the GL account mapping and the entries the
 * seeded invoices would have posted, generated with the same posting helpers
 * the handlers use (shared/invoiceLedger.ts), so "Post existing invoices" on
 * the demo finds nothing left to post.
 *
 * Each sent invoice in Canadian dollars, issued after the books start, posts
 * its accrual (source "invoice", accrual-only); each payment after the books
 * start posts Dr the deposit / Cr Accounts receivable (source
 * "invoice_payment", both) and its cash-basis recognition (source
 * "invoice_cash_basis", cash-only). Payments linked to a bank deposit
 * deposit into that bank account, and the deposit is marked matched to the
 * invoice and categorised to Accounts receivable; the others sit in
 * Undeposited funds, which the Invoices page flags.
 *
 * Shared by the in-browser demo (src/lib/staticInvoiceFixtures.ts) and the
 * server seed (shared/functions/seed.ts). Callers pass the stored rows (with
 * their real ids) and get back the journal rows plus updated copies of the
 * invoices and deposits. Pure TypeScript.
 */
import { computeInvoiceTotals, type InvoiceDiscount, type InvoiceLine } from "../invoicing";
import {
  INVOICE_POSTINGS,
  accrualKey,
  accrualPostingLines,
  cashBasisKey,
  cashBasisPostingLines,
  invoiceLabel,
  isBeforeBooksStart,
  paymentEntryKey,
  paymentPostingLines,
  resolveLineRevenue,
  type BooksStart,
  type CatalogMappingRef,
  type InvoiceGlMapping,
  type InvoiceLedgerLine,
  type InvoicePostingKind,
} from "../invoiceLedger";
import { demoFiscalYearLabel } from "./journals";

export type DemoInvoiceLedgerAccounts = {
  receivable: string;
  taxPayable: string;
  undeposited: string;
  dues: string;
  programFees: string;
  otherIncome: string;
  donations: string;
};

/** The demo's mapping: catalog categories to the revenue accounts the bank feed uses (shared/demoData/journals.ts). */
export function demoInvoiceGlMapping(accounts: DemoInvoiceLedgerAccounts) {
  return {
    receivableAccountId: accounts.receivable,
    taxPayableAccountId: accounts.taxPayable,
    defaultRevenueAccountId: accounts.programFees,
    depositAccountId: accounts.undeposited,
    categoryAccounts: [
      { category: "Membership fees", accountId: accounts.dues },
      { category: "Registration fees", accountId: accounts.programFees },
      { category: "Rental income", accountId: accounts.otherIncome },
      { category: "Sponsorship", accountId: accounts.donations },
    ],
  };
}

type Row = Record<string, unknown> & { _id: string };

type DemoPayment = {
  key: string;
  date: string;
  amountCents: number;
  reference?: string;
  financialTransactionId?: string;
  [field: string]: unknown;
};

type DemoInvoice = Row & {
  number: string;
  status: string;
  billToName: string;
  counterpartyId?: string;
  issueDate: string;
  currency: string;
  lines: InvoiceLine[];
  discount?: InvoiceDiscount;
  source?: string;
  payments: DemoPayment[];
};

export type DemoInvoiceLedgerInput = {
  societyId: string;
  accounts: DemoInvoiceLedgerAccounts;
  invoices: ReadonlyArray<Row>;
  catalog: ReadonlyArray<Row>;
  /** The invoice demo's bank deposits. */
  transactions: ReadonlyArray<Row>;
  booksStart: BooksStart;
  treasurer: { id: string; name: string };
  idFor: (kind: "journalEntry" | "journalLine", key: string) => string;
  fiscalPeriodIdFor?: (fiscalYear: string) => string | undefined;
};

const SNAPSHOT_FIELDS = ["category", "accountingAccountId", "categorizedBy", "ruleId", "reconciledAtISO", "reconciledByName", "matchedKind", "matchedId", "reconciliationNote"] as const;

export function invoiceLedgerDemoRows(input: DemoInvoiceLedgerInput) {
  const mapping: InvoiceGlMapping = demoInvoiceGlMapping(input.accounts);
  const accountIds = new Set(Object.values(input.accounts));
  const catalogById = new Map(input.catalog.map((item) => [item._id, item as CatalogMappingRef]));
  const txnById = new Map(input.transactions.map((txn) => [txn._id, txn]));
  const at = (date: string) => `${date}T18:30:00.000Z`;
  const journalEntries: Row[] = [];
  const journalLines: Row[] = [];
  const transactions = new Map<string, Row>();

  const post = (kind: InvoicePostingKind, key: string, sourceExternalId: string, date: string, memo: string, lines: InvoiceLedgerLine[], counterpartyId?: string) => {
    const id = input.idFor("journalEntry", key);
    const fiscalYear = demoFiscalYearLabel(date);
    const fiscalPeriodId = input.fiscalPeriodIdFor?.(fiscalYear);
    journalEntries.push({
      _id: id,
      societyId: input.societyId,
      ...(fiscalPeriodId ? { fiscalPeriodId } : {}),
      date,
      memo,
      source: INVOICE_POSTINGS[kind].source,
      sourceExternalId,
      basis: INVOICE_POSTINGS[kind].basis,
      status: "posted",
      fiscalYear,
      createdByUserId: input.treasurer.id,
      postedAtISO: at(date),
      createdAtISO: at(date),
      updatedAtISO: at(date),
    });
    lines.forEach((line, index) => {
      journalLines.push({
        _id: input.idFor("journalLine", `${key}_${index + 1}`),
        societyId: input.societyId,
        journalEntryId: id,
        accountId: line.accountId,
        lineOrder: index,
        amountCents: line.amountCents,
        side: line.side,
        ...(line.description ? { description: line.description } : {}),
        ...(line.tagIds?.length ? { tagIds: line.tagIds } : {}),
        ...(line.financialTransactionId ? { financialTransactionId: line.financialTransactionId } : {}),
        ...(counterpartyId ? { counterpartyId } : {}),
        createdAtISO: at(date),
        updatedAtISO: at(date),
      });
    });
    return id;
  };

  const invoices = input.invoices.map((raw) => {
    const invoice = raw as DemoInvoice;
    const totals = computeInvoiceTotals(invoice.lines, invoice.discount);
    if (invoice.status !== "sent" || totals.totalCents <= 0 || invoice.currency !== "CAD" || isBeforeBooksStart(invoice.issueDate, input.booksStart)) return raw;
    const revenueFor = (line: InvoiceLine) => resolveLineRevenue(line, { mapping, catalogById, invoiceSource: invoice.source, accountIds })?.accountId ?? null;
    if (invoice.lines.some((line, index) => totals.lineAmounts[index] !== 0 && !revenueFor(line))) return raw;
    const key = `invoice_${invoice.number.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    const accrual = accrualPostingLines(invoice, revenueFor, { receivableAccountId: input.accounts.receivable, taxPayableAccountId: input.accounts.taxPayable });
    const label = invoiceLabel(invoice);
    const journalEntryId = post("accrual", key, accrualKey(invoice._id), invoice.issueDate, `Invoice ${label}`, accrual, invoice.counterpartyId);
    const recognised: typeof accrual = [];
    const payments = invoice.payments.map((payment) => {
      if (isBeforeBooksStart(payment.date, input.booksStart)) return payment;
      const txn = payment.financialTransactionId ? txnById.get(payment.financialTransactionId) : undefined;
      const depositAccountId = txn ? String(txn.accountId) : input.accounts.undeposited;
      const paymentKey = `${key}_${payment.key}`;
      const paymentEntryId = post(
        "payment",
        paymentKey,
        paymentEntryKey(invoice._id, payment.key),
        payment.date,
        `Invoice payment: ${label}`,
        paymentPostingLines({ amountCents: payment.amountCents, financialTransactionId: txn?._id, reference: payment.reference }, { depositAccountId, receivableAccountId: input.accounts.receivable }, `Payment: ${label}`),
        invoice.counterpartyId,
      );
      const cashLines = cashBasisPostingLines(accrual, { paymentCents: payment.amountCents, receivableAccountId: input.accounts.receivable, recognised }, `Revenue received: ${label}`);
      recognised.push(...cashLines);
      const cashBasisEntryId = cashLines.length
        ? post("cashBasis", `${paymentKey}_cash`, cashBasisKey(invoice._id, payment.key), payment.date, `Cash basis: ${label} paid`, cashLines, invoice.counterpartyId)
        : undefined;
      let transactionBefore: Record<string, string> | undefined;
      if (txn) {
        transactionBefore = {};
        for (const field of SNAPSHOT_FIELDS) if (typeof txn[field] === "string" && txn[field]) transactionBefore[field] = String(txn[field]);
        transactions.set(txn._id, {
          ...txn,
          category: "Accounts receivable",
          accountingAccountId: input.accounts.receivable,
          categorizedBy: "manual",
          reconciledAtISO: at(String(txn.date)),
          reconciledByName: input.treasurer.name,
          matchedKind: "invoice",
          matchedId: invoice._id,
          reconciliationNote: `Payment for invoice ${invoice.number}`,
        });
      }
      return {
        ...payment,
        ...(txn ? { transactionBefore } : { depositAccountId }),
        journalEntryId: paymentEntryId,
        ...(cashBasisEntryId ? { cashBasisEntryId } : {}),
      };
    });
    return { ...raw, journalEntryId, payments };
  });

  return {
    mapping,
    journalEntries,
    journalLines,
    invoices,
    transactions: input.transactions.map((txn) => transactions.get(txn._id) ?? txn),
  };
}
