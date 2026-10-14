import { sheetFromCsv, type CsvColumnSpec } from "@/lib/xlsx/csvSheet";
import type { XlsxSheet, XlsxWorkbook } from "@/lib/xlsx";

export type AccountingExportKind = "chart_of_accounts" | "trial_balance" | "journal_entries" | "general_ledger";

/**
 * How each accounting CSV (accounting:exportCsv) maps onto a typed sheet:
 * `*_cents` columns become currency amounts, entry dates real dates. Account
 * codes and entry numbers stay text so leading zeros survive.
 */
const LEDGER_SPECS: Record<string, CsvColumnSpec> = {
  entry_date: { header: "Date", type: "date" },
  entry_number: { header: "Entry no." },
  amount_cents: { header: "Amount", cents: true },
  line_description: { header: "Line description" },
};

export const ACCOUNTING_SHEETS: Record<AccountingExportKind, { sheet: string; specs: Record<string, CsvColumnSpec>; currencyColumn?: string }> = {
  chart_of_accounts: {
    sheet: "Chart of accounts",
    specs: { normal_balance: { header: "Normal balance" }, external_id: { header: "External ID" } },
  },
  trial_balance: {
    sheet: "Trial balance",
    specs: {
      debit_cents: { header: "Debit", cents: true },
      credit_cents: { header: "Credit", cents: true },
      balance_cents: { header: "Balance", cents: true },
    },
  },
  journal_entries: { sheet: "Journal entries", specs: LEDGER_SPECS },
  general_ledger: { sheet: "General ledger", specs: LEDGER_SPECS },
};

export function accountingExportSheet(kind: AccountingExportKind, csv: string): XlsxSheet {
  const config = ACCOUNTING_SHEETS[kind];
  return sheetFromCsv(config.sheet, csv, config.specs, { currencyColumn: config.currencyColumn });
}

/** One workbook, a sheet per report, in the order given. */
export function accountingWorkbook(title: string, reports: Array<{ kind: AccountingExportKind; csv: string }>): XlsxWorkbook {
  return { title, sheets: reports.map((report) => accountingExportSheet(report.kind, report.csv)) };
}

/** "trial-balance.csv" → "trial-balance". */
export function baseFileName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "");
}
