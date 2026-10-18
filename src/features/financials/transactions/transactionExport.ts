import type { XlsxSheet } from "../../../lib/xlsx";
import { splitLabel, transactionLines, type TransactionLine } from "../../../../shared/transactionLines";
import { CATEGORIZED_BY_LABELS, categorizedByValue } from "../../../../shared/transactionAttention";

/**
 * The transactions export: one row per transaction, or one row per line item
 * (a split transaction gives one row for each of its lines). Text rows go
 * through `toDelimitedText` (src/lib/tableExport.ts), which neutralises
 * anything a spreadsheet would run as a formula; the typed sheet writes text
 * cells only, never formulas.
 */

export type ExportLayout = "transactions" | "lines";

export type ExportTransaction = {
  date: string;
  description: string;
  payeeName?: string;
  counterparty?: string;
  amountCents: number;
  account?: string;
  category?: string;
  categorizedBy?: string;
  accountingAccountId?: string;
  fundRestrictionId?: string;
  memo?: string;
  receiptStatus?: string;
  status?: string;
  reviewedAtISO?: string;
  tagIds?: string[];
  lines?: TransactionLine[];
};

export type ExportLookups = {
  tagName: (tagId: string) => string | undefined;
  fundName: (fundId: string) => string | undefined;
  accountName: (accountId: string) => string | undefined;
};

const names = (ids: readonly string[] | undefined, lookup: (id: string) => string | undefined) =>
  (ids ?? []).map((id) => lookup(id)).filter(Boolean).join(", ");

const decimal = (cents: number) => (cents / 100).toFixed(2);

const methodLabel = (row: ExportTransaction) => {
  const method = categorizedByValue(row);
  return method ? CATEGORIZED_BY_LABELS[method] : "";
};

const TRANSACTION_COLUMNS = ["Date", "Description", "To / from", "Amount", "Account", "Category", "Tags", "Fund", "Notes", "Receipt", "Status", "Categorised by", "Reviewed"];
const LINE_COLUMNS = ["Date", "Description", "To / from", "Transaction amount", "Line", "Line amount", "Category", "Ledger account", "Fund", "Tags", "Line memo", "Account"];

function transactionCells(row: ExportTransaction, lookups: ExportLookups) {
  const lines = transactionLines(row);
  const tagIds = [...new Set(lines.flatMap((line) => line.tagIds ?? []))];
  const funds = [...new Set(lines.map((line) => line.fundRestrictionId).filter((id): id is string => Boolean(id)))];
  return {
    payee: row.payeeName || row.counterparty || "",
    category: splitLabel(row) ? `${splitLabel(row)}: ${lines.map((line) => line.category || "Uncategorised").join(", ")}` : row.category ?? "",
    tags: names(tagIds, lookups.tagName),
    fund: names(funds, lookups.fundName),
  };
}

/** CSV / TSV rows: decimal amounts, ISO dates, names rather than ids. */
export function transactionExportTextRows(rows: readonly ExportTransaction[], layout: ExportLayout, lookups: ExportLookups): string[][] {
  if (layout === "lines") {
    return [
      LINE_COLUMNS,
      ...rows.flatMap((row) => {
        const payee = row.payeeName || row.counterparty || "";
        const lines = transactionLines(row);
        return lines.map((line, index) => [
          row.date,
          row.description,
          payee,
          decimal(row.amountCents),
          `${index + 1} of ${lines.length}`,
          decimal(line.amountCents),
          line.category ?? "",
          line.accountingAccountId ? lookups.accountName(line.accountingAccountId) ?? "" : "",
          line.fundRestrictionId ? lookups.fundName(line.fundRestrictionId) ?? "" : "",
          names(line.tagIds, lookups.tagName),
          line.memo ?? "",
          row.account ?? "",
        ]);
      }),
    ];
  }
  return [
    TRANSACTION_COLUMNS,
    ...rows.map((row) => {
      const cells = transactionCells(row, lookups);
      return [
        row.date,
        row.description,
        cells.payee,
        decimal(row.amountCents),
        row.account ?? "",
        cells.category,
        cells.tags,
        cells.fund,
        row.memo ?? "",
        row.receiptStatus ?? "",
        row.status === "pending" ? "Pending" : "Posted",
        methodLabel(row),
        row.reviewedAtISO ? row.reviewedAtISO.slice(0, 10) : "",
      ];
    }),
  ];
}

/** The same export as a typed sheet: real dates and CAD amounts. */
export function transactionExportSheet(rows: readonly ExportTransaction[], layout: ExportLayout, lookups: ExportLookups): XlsxSheet {
  if (layout === "lines") {
    return {
      name: "Transaction lines",
      columns: [
        { header: "Date", type: "date" },
        { header: "Description" },
        { header: "To / from" },
        { header: "Transaction amount", type: "currency", cents: true },
        { header: "Line" },
        { header: "Line amount", type: "currency", cents: true },
        { header: "Category" },
        { header: "Ledger account" },
        { header: "Fund" },
        { header: "Tags" },
        { header: "Line memo" },
        { header: "Account" },
      ],
      rows: rows.flatMap((row) => {
        const lines = transactionLines(row);
        return lines.map((line, index) => [
          row.date,
          row.description,
          row.payeeName || row.counterparty || "",
          row.amountCents,
          `${index + 1} of ${lines.length}`,
          line.amountCents,
          line.category ?? "",
          line.accountingAccountId ? lookups.accountName(line.accountingAccountId) ?? "" : "",
          line.fundRestrictionId ? lookups.fundName(line.fundRestrictionId) ?? "" : "",
          names(line.tagIds, lookups.tagName),
          line.memo ?? "",
          row.account ?? "",
        ]);
      }),
    };
  }
  return {
    name: "Transactions",
    columns: [
      { header: "Date", type: "date" },
      { header: "Description" },
      { header: "To / from" },
      { header: "Amount", type: "currency", cents: true },
      { header: "Account" },
      { header: "Category" },
      { header: "Tags" },
      { header: "Fund" },
      { header: "Notes" },
      { header: "Receipt" },
      { header: "Status" },
      { header: "Categorised by" },
      { header: "Reviewed", type: "date" },
    ],
    rows: rows.map((row) => {
      const cells = transactionCells(row, lookups);
      return [
        row.date,
        row.description,
        cells.payee,
        row.amountCents,
        row.account ?? "",
        cells.category,
        cells.tags,
        cells.fund,
        row.memo ?? "",
        row.receiptStatus ?? "",
        row.status === "pending" ? "Pending" : "Posted",
        methodLabel(row),
        row.reviewedAtISO ? row.reviewedAtISO.slice(0, 10) : null,
      ];
    }),
  };
}
