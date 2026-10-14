import type { XlsxSheet, XlsxWorkbook } from "@/lib/xlsx";
import { reportTableSheet } from "@/lib/xlsx/reportSheet";
import type { ReportRow } from "@/components/ReportTable";
import { budgetVariance } from "@/lib/money";
import type { buildAccountingStatements, buildProgramSummary } from "../../../../shared/accountingStatements";
import { statementTables, type StatementPeriods } from "../components/FinancialStatementsReport";

type Built = ReturnType<typeof buildAccountingStatements>;
type ProgramRow = ReturnType<typeof buildProgramSummary>[number];

/**
 * The financial statements card as one workbook: each currency's balance
 * sheet and income statement laid out as on screen (bold sections and totals,
 * accounting format, comparatives), then program budget vs actual and any
 * warnings.
 */
export function statementsWorkbook({
  report,
  priorReport,
  periods,
  programs,
  budgetYear,
  fundNote,
}: {
  report: Built;
  priorReport: Built | null;
  periods: StatementPeriods;
  programs: ProgramRow[];
  budgetYear: string;
  /** "Fund filter: …" when the statements are limited to one fund. */
  fundNote?: string;
}): XlsxWorkbook {
  const { from, to } = periods;
  const notes = fundNote ? [fundNote] : [];
  const comparison = priorReport ? { current: "current", prior: "prior" } : null;
  const sheets: XlsxSheet[] = [];
  for (const statement of report.statements) {
    const tables = statementTables(statement, priorReport, periods);
    sheets.push(
      reportTableSheet({
        name: `Balance sheet ${statement.currency}`,
        columns: tables.balanceColumns,
        rows: tables.balanceRows as ReportRow<unknown>[],
        comparison,
        currency: statement.currency,
        title: [`Balance sheet as at ${to}`, statement.currency, ...notes],
      }),
      reportTableSheet({
        name: `Income statement ${statement.currency}`,
        columns: tables.periodColumns,
        rows: tables.incomeRows as ReportRow<unknown>[],
        comparison,
        currency: statement.currency,
        title: [`Income statement ${from} to ${to}`, statement.currency, ...notes],
      }),
    );
  }
  if (programs.length) {
    sheets.push({
      name: "Program budgets",
      title: [`Program / project budget and actual, ${from} to ${to}`, `Budget fiscal year ${budgetYear}`],
      columns: [
        { header: "Program / project" },
        { header: "Account code" },
        { header: "Account" },
        { header: "Type" },
        { header: "Currency" },
        { header: "Actual", type: "currency", cents: true },
        { header: `Budget FY ${budgetYear}`, type: "currency", cents: true },
        { header: "Variance (favourable +)", type: "currency", cents: true },
      ],
      rows: programs.map((row) => {
        const variance = budgetVariance(row.budgetCents, row.actualCents, row.accountType === "Income" ? "revenue" : "expense");
        return [
          row.programCode,
          row.code,
          row.name,
          row.accountType,
          row.currency,
          { value: row.actualCents, currency: row.currency },
          { value: row.budgetCents, currency: row.currency },
          { value: variance.cents, currency: row.currency },
        ];
      }),
    });
  }
  if (report.warnings.length) {
    sheets.push({ name: "Warnings", columns: [{ header: "Warning" }], rows: report.warnings.map((warning) => [warning]), autoFilter: false });
  }
  return { title: `Financial statements ${from} to ${to}`, sheets };
}
