import { cleanCsvCell, parseCsv } from "../csv";
import type { XlsxCellInput, XlsxCellType, XlsxColumn, XlsxSheet } from "./types";

export type CsvColumnSpec = {
  /** Header shown in the sheet (defaults to the CSV header, humanised). */
  header?: string;
  type?: XlsxCellType;
  /** The CSV holds integer cents. */
  cents?: boolean;
  currency?: string;
};

/** "account_code" → "Account code". */
export function humaniseHeader(header: string): string {
  const words = header.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : header;
}

/**
 * Turn a server-generated CSV (header row first) into a typed sheet. Columns
 * named in `specs` get their type (cents → currency, dates → real dates);
 * everything else stays text. The CSV's formula guard (a leading zero-width
 * non-joiner) is removed because sheet cells are typed text, never formulas.
 * With `currencyColumn`, each row's amounts use the currency in that column.
 */
export function sheetFromCsv(
  name: string,
  csv: string,
  specs: Record<string, CsvColumnSpec>,
  options: { title?: string[]; currencyColumn?: string } = {},
): XlsxSheet {
  const [header = [], ...body] = parseCsv(csv);
  const currencyIndex = options.currencyColumn ? header.indexOf(options.currencyColumn) : -1;
  const columns: XlsxColumn[] = header.map((key) => {
    const spec = specs[key] ?? {};
    return {
      header: spec.header ?? humaniseHeader(key),
      type: spec.type ?? (spec.cents ? "currency" : "text"),
      cents: spec.cents,
      currency: spec.currency,
    };
  });
  const rows = body.map((row) =>
    header.map((_, index): XlsxCellInput => {
      const raw = cleanCsvCell(row[index] ?? "");
      const column = columns[index];
      if (currencyIndex >= 0 && (column.type === "currency" || column.type === "accounting")) {
        const currency = cleanCsvCell(row[currencyIndex] ?? "").trim();
        if (currency) return { value: raw, currency };
      }
      return raw;
    }),
  );
  return { name, columns, rows, title: options.title };
}
