/**
 * General ledger as a spreadsheet: exactly the columns on screen, with the
 * opening and closing balance rows when the ledger is filtered to one account.
 * Text cells are never written as formulas (src/lib/xlsx) and CSV neutralises
 * formula-looking values (src/lib/tableExport).
 */
import type { XlsxColumn, XlsxRowInput, XlsxSheet } from "../../../lib/xlsx/types";
import type { GeneralLedgerReport, GeneralLedgerRow } from "../../../../shared/booksReports";

export function accountLabel(account: { code?: string | null; name: string }) {
  return account.code ? `${account.code} · ${account.name}` : account.name;
}

export function contraLabel(row: GeneralLedgerRow) {
  return row.contraAccounts.map(accountLabel).join(", ");
}

/** The memo, plus the line's own description when it says something else. */
export function lineDescription(row: GeneralLedgerRow) {
  return row.description && row.description !== row.memo ? row.description : null;
}

export function generalLedgerSheet(report: GeneralLedgerReport, title: string[]): XlsxSheet {
  const withBalance = Boolean(report.account);
  const money = (header: string): XlsxColumn => ({ header, type: "accounting", cents: true, currency: report.currency });
  const columns: XlsxColumn[] = [
    { header: "Date", type: "date" },
    { header: "Ledger account" },
    { header: "Contra account(s)" },
    { header: "Memo / description" },
    { header: "Vendor / customer" },
    money("Debit"),
    money("Credit"),
    ...(withBalance ? [money("Balance")] : []),
  ];
  const rows: XlsxRowInput[] = [];
  if (report.account) {
    rows.push({ cells: [report.from, "Opening balance", "", "", "", null, null, report.account.openingBalanceCents], style: "subtotal" });
  }
  for (const row of report.rows) {
    const description = lineDescription(row);
    rows.push([
      row.date,
      accountLabel(row.account),
      contraLabel(row),
      description ? `${row.memo} — ${description}` : row.memo || description || "",
      row.counterparty ?? "",
      row.debitCents || null,
      row.creditCents || null,
      ...(withBalance ? [row.balanceCents ?? null] : []),
    ]);
  }
  rows.push({ cells: ["", "Totals", "", "", "", report.totals.debitCents, report.totals.creditCents, ...(withBalance ? [null] : [])], style: "total" });
  if (report.account) {
    rows.push({ cells: [report.to, "Closing balance", "", "", "", null, null, report.account.closingBalanceCents], style: "subtotal" });
  }
  return { name: "General ledger", columns, rows, title };
}
