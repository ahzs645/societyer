/**
 * The in-browser demo's invoicing data: catalog, customers, 25 invoices in
 * every state, a recurring series, settings, renewals and the bank lines some
 * payments are linked to.
 *
 * The data itself comes from shared/demoData/invoicing.ts, which the server
 * seed (shared/functions/seed.ts) also uses; this module only fixes the static
 * demo's ids and the members who play each part.
 */
import {
  invoiceDemoAnchor,
  invoiceDemoRows,
  type DemoInvoiceIdKind,
  type DemoInvoiceMember,
  type DemoInvoiceMemberKey,
} from "../../shared/demoData/invoicing";

import { invoiceLedgerDemoRows, type DemoInvoiceLedgerAccounts } from "../../shared/demoData/invoiceLedger";
import type { BooksStart } from "../../shared/invoiceLedger";

export { invoiceDemoAnchor };

type Ids = {
  societyId: string;
  connectionId: string;
  cashAccountId: string;
  ownerName: string;
  treasurerName: string;
};

function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const STATIC_MEMBER_NAMES: Record<DemoInvoiceMemberKey, string> = {
  mina: "Mina Patel",
  jordan: "Jordan Lee",
  priya: "Priya Sharma",
  wei: "Wei Zhang",
  grace: "Grace Okafor",
  hannah: "Hannah Goldberg",
  noor: "Noor Ahmadi",
  liam: "Liam Tremblay",
  devon: "Devon Clarke",
  avery: "Avery Santos",
  sam: "Sam Nguyen",
  fatima: "Fatima Hussain",
};

const STATIC_ID: Record<DemoInvoiceIdKind, (key: string) => string> = {
  catalogItem: (key) => `static_invoice_item_${key}`,
  counterparty: (key) => `static_counterparty_${key}`,
  series: (key) => `static_invoice_series_${key}`,
  invoice: (key) => `static_invoice_${key}`,
  transaction: (key) => `static_tx_invoice_${key}`,
  settings: () => "static_invoice_settings",
  subscription: (key) => `static_member_subscription_renewal_${key}`,
  identifier: (key) => `static_identifier_${key}`,
};

export function invoiceDemoData(ids: Ids, nowMs = Date.now()) {
  const members = Object.fromEntries(
    Object.entries(STATIC_MEMBER_NAMES).map(([key, name]) => [key, { id: `static_member_${key}`, name, email: `${key}@riverside.example` }]),
  ) as Record<DemoInvoiceMemberKey, DemoInvoiceMember>;
  return invoiceDemoRows(
    {
      societyId: ids.societyId,
      connectionId: ids.connectionId,
      cashAccountId: ids.cashAccountId,
      ownerName: ids.ownerName,
      treasurerName: ids.treasurerName,
      members,
      plans: { regular: "static_plan_regular", student: "static_plan_student" },
      idFor: (kind, key) => STATIC_ID[kind](key),
      today: localToday(new Date(nowMs)),
    },
    nowMs,
  );
}

/** Add the invoicing demo to the static fixture tables (appends to shared tables, never replaces them). */
export function mergeInvoiceDemo(tables: Record<string, any[]>, ids: Ids) {
  const data = invoiceDemoData(ids);
  for (const key of ["invoices", "invoiceCatalogItems", "invoiceSeries", "invoiceSettings", "financialTransactions", "accountingCounterparties", "memberSubscriptions", "organizationIdentifiers"] as const) {
    const rows = data[key] as any[];
    if (Array.isArray(tables[key])) tables[key].push(...rows);
    else tables[key] = rows;
  }
  // Invoice payment deposits are real bank lines, so the account balance must
  // include them (balance = opening + sum of transactions, like the feed).
  const cash = (tables.financialAccounts ?? []).find((account: any) => account._id === ids.cashAccountId);
  if (cash) {
    cash.balanceCents = (cash.balanceCents ?? 0) + (data.financialTransactions as any[]).reduce((sum, row) => sum + row.amountCents, 0);
  }
}

type LedgerIds = {
  societyId: string;
  accounts: DemoInvoiceLedgerAccounts;
  booksStart: BooksStart;
  treasurer: { id: string; name: string };
  fiscalPeriodIdFor: (fiscalYear: string) => string | undefined;
};

type Tables = Record<string, Array<Record<string, unknown> & { _id: string }>>;

/**
 * Put the invoicing demo in the books (shared/demoData/invoiceLedger.ts): the
 * GL account mapping on the settings, the entries the sent invoices and their
 * payments posted, and the linked deposits matched to their invoices. Runs
 * after mergeInvoiceDemo, on the rows it added.
 */
export function mergeInvoiceLedgerDemo(tables: Tables, ids: LedgerIds) {
  const deposits = (tables.financialTransactions ?? []).filter((row) => String(row.externalId ?? "").startsWith("csv-invoice-"));
  const data = invoiceLedgerDemoRows({
    societyId: ids.societyId,
    accounts: ids.accounts,
    invoices: tables.invoices ?? [],
    catalog: tables.invoiceCatalogItems ?? [],
    transactions: deposits,
    booksStart: ids.booksStart,
    treasurer: ids.treasurer,
    idFor: (kind, key) => (kind === "journalEntry" ? `static_journal_${key}` : `static_jline_${key}`),
    fiscalPeriodIdFor: ids.fiscalPeriodIdFor,
  });
  // In place: other fixture modules hold these arrays.
  const replace = (key: string, rows: Array<Record<string, unknown> & { _id: string }>) => {
    const byId = new Map(rows.map((row) => [row._id, row]));
    const table = tables[key] ?? (tables[key] = []);
    table.forEach((row, index) => {
      const next = byId.get(row._id);
      if (next) table[index] = next;
    });
  };
  replace("invoices", data.invoices);
  replace("financialTransactions", data.transactions);
  (tables.journalEntries ?? (tables.journalEntries = [])).push(...data.journalEntries);
  (tables.journalLines ?? (tables.journalLines = [])).push(...data.journalLines);
  for (const row of tables.invoiceSettings ?? []) Object.assign(row, data.mapping);
}
