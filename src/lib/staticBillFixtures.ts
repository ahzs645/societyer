/**
 * The in-browser demo's bills: four vendors, eight bills (one in each
 * status), the journal entries their approvals and payments posted, and the
 * money-out bank lines (two linked to payments, one waiting to be matched).
 *
 * The data itself comes from shared/demoData/bills.ts, which the server seed
 * (shared/functions/seed.ts) also uses; this module only fixes the static
 * demo's ids, accounts and people.
 */
import { billDemoRows, type DemoBillIdKind, type DemoBillPerson } from "../../shared/demoData/bills";
import { staticFinanceTagId } from "./staticFinanceWorkflowFixtures";

type Ids = {
  societyId: string;
  connectionId: string;
  cashAccountId: string;
  accounts: { payable: string; facilities: string; venue: string; utilities: string; program: string };
  fundRestrictionId: string;
  owner: DemoBillPerson;
  treasurer: DemoBillPerson;
  secretary: DemoBillPerson;
};

const STATIC_ID: Record<DemoBillIdKind, (key: string) => string> = {
  vendor: (key) => `static_vendor_${key}`,
  bill: (key) => `static_bill_${key}`,
  transaction: (key) => `static_tx_bill_${key}`,
  journalEntry: (key) => `static_journal_${key}`,
  journalLine: (key) => `static_jline_${key}`,
};

export function billDemoData(ids: Ids, nowMs = Date.now()) {
  return billDemoRows({ ...ids, idFor: (kind, key) => STATIC_ID[kind](key), tagId: staticFinanceTagId }, nowMs);
}

type Tables = Record<string, Array<Record<string, unknown>>>;

/** Add the bills demo to the static fixture tables (appends to shared tables, never replaces them). */
export function mergeBillDemo(tables: Tables, ids: Ids) {
  const data = billDemoData(ids);
  for (const key of ["bills", "accountingCounterparties", "financialTransactions", "journalEntries", "journalLines"] as const) {
    const rows = data[key];
    if (Array.isArray(tables[key])) tables[key].push(...rows);
    else tables[key] = [...rows];
  }
  // The bill payments are real bank lines, so operating chequing's balance
  // includes them (balance = opening + sum of transactions, like the feed).
  const cash = (tables.financialAccounts ?? []).find((account) => account._id === ids.cashAccountId);
  if (cash) {
    const outflow = data.financialTransactions.reduce((sum, row) => sum + Number(row.amountCents), 0);
    cash.balanceCents = Number(cash.balanceCents ?? 0) + outflow;
  }
}
