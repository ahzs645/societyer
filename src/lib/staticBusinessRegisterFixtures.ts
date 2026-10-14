/**
 * The in-browser demo's business registers: pay runs and CRA remittances for
 * the society's staff, last year's T4 slips, the organization Visa with its
 * statements, and two GICs held as reserves.
 *
 * The data comes from shared/demoData/businessRegisters.ts, which the server
 * seed (shared/functions/seed.ts) also uses; this module only fixes the static
 * demo's ids and reads the employees and bank feed already in the fixtures.
 */
import { businessRegisterDemoRows, type DemoBusinessRegisterIdKind } from "../../shared/demoData/businessRegisters";

type Ids = {
  societyId: string;
  cardAccountId: string;
  restrictedFundId?: string;
  treasurerName: string;
  asOf: string;
};

const STATIC_ID: Record<DemoBusinessRegisterIdKind, (key: string) => string> = {
  settings: (key) => `static_payroll_settings_${key}`,
  payRun: (key) => `static_pay_run_${key.replace(/-/g, "_")}`,
  remittance: (key) => `static_payroll_remittance_${key.replace(/-/g, "_")}`,
  slip: (key) => `static_payroll_slip_${key.replace(/-/g, "_")}`,
  card: (key) => `static_corporate_card_${key.replace(/-/g, "_")}`,
  statement: (key) => `static_card_statement_${key.replace(/-/g, "_")}`,
  holding: (key) => `static_investment_${key.replace(/-/g, "_")}`,
  document: (key) => `static_document_${key.replace(/-/g, "_")}`,
  deadline: (key) => `static_deadline_${key.replace(/[^a-zA-Z0-9]+/g, "_")}`,
};

/** Add the business-register demo to the static fixture tables (appends to shared tables, never replaces them). */
export function mergeBusinessRegisterDemo(tables: Record<string, any[]>, ids: Ids) {
  const employees = (tables.employees ?? [])
    .filter((row: any) => row.societyId === ids.societyId && !row.endDate)
    .map((row: any) => ({ id: String(row._id), name: `${row.firstName} ${row.lastName}`.trim(), annualSalaryCents: row.annualSalaryCents }));
  const data = businessRegisterDemoRows({
    societyId: ids.societyId,
    cardAccountId: ids.cardAccountId,
    restrictedFundId: ids.restrictedFundId,
    employees,
    treasurerName: ids.treasurerName,
    feedTransactions: (tables.financialTransactions ?? []).filter((row: any) => row.societyId === ids.societyId && String(row.externalId ?? "").startsWith("feed-")),
    idFor: (kind, key) => STATIC_ID[kind](key),
    asOf: ids.asOf,
  });
  for (const key of ["payrollSettings", "payRuns", "payrollRemittances", "payrollSlips", "documents", "corporateCards", "cardStatements", "investmentHoldings", "deadlines"] as const) {
    const rows = data[key] as any[];
    if (Array.isArray(tables[key])) tables[key].push(...rows);
    else tables[key] = rows;
  }
}
