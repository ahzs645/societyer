import { isValidElement, type ReactNode } from "react";
import type { ReportColumn, ReportComparison, ReportRow } from "../../components/ReportTable";
import type { XlsxCellInput, XlsxColumn, XlsxRowObject, XlsxSheet } from "./types";

/** Plain text of a label: strings and numbers as-is, simple elements by their text children. */
export function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function columnTitle(column: ReportColumn) {
  return column.title ?? (nodeText(column.label) || column.id);
}

function rowTitle(row: ReportRow<unknown>) {
  return nodeText(row.label) || row.title || "";
}

/**
 * A statement (the rows and columns a <ReportTable> renders) as one sheet:
 * the full hierarchy regardless of what is collapsed on screen, labels
 * indented by depth, amounts as signed numbers in the accounting format,
 * sections and subtotals bold, totals bold with a rule above and a double
 * rule below, and the comparison's change / change % when it has one.
 */
export function reportTableSheet({
  name,
  columns,
  rows,
  comparison,
  currency,
  labelHeader = "Account",
  title,
}: {
  name: string;
  columns: ReportColumn[];
  rows: ReportRow<unknown>[];
  comparison?: ReportComparison | null;
  currency?: string;
  labelHeader?: string;
  title?: string[];
}): XlsxSheet {
  const hasCode = (function walk(list: ReportRow<unknown>[]): boolean {
    return list.some((row) => Boolean(row.code) || (row.children ? walk(row.children) : false));
  })(rows);
  const showPercent = Boolean(comparison) && comparison?.percent !== false;

  const sheetColumns: XlsxColumn[] = [
    ...(hasCode ? [{ header: "Code", type: "text" as const }] : []),
    { header: labelHeader, type: "text" },
    ...columns.map((column): XlsxColumn => ({ header: columnTitle(column), type: "accounting", cents: true, currency: column.currency ?? currency })),
    ...(comparison ? [{ header: nodeText(comparison.deltaLabel) || "Change", type: "accounting" as const, cents: true, currency }] : []),
    ...(showPercent ? [{ header: "Change %", type: "percent" as const }] : []),
  ];

  const out: XlsxRowObject[] = [];
  const walk = (list: ReportRow<unknown>[], depth: number) => {
    for (const row of list) {
      const rowCurrency = row.currency ?? currency;
      const label: XlsxCellInput = { value: rowTitle(row), indent: depth };
      if (row.kind === "note") {
        out.push({ cells: [...(hasCode ? [null] : []), label] });
        continue;
      }
      const amounts = columns.map((column): XlsxCellInput => {
        const custom = row.cells?.[column.id];
        if (custom !== undefined) {
          const text = nodeText(custom);
          return text === "—" ? null : { value: text, type: "text" };
        }
        const value = row.values?.[column.id];
        return value == null ? null : { value, currency: row.currency ?? column.currency ?? rowCurrency };
      });
      const extra: XlsxCellInput[] = [];
      if (comparison) {
        const current = row.values?.[comparison.current];
        const prior = row.values?.[comparison.prior];
        const showDelta = row.kind !== "section" && (current != null || prior != null);
        const cents = (current ?? 0) - (prior ?? 0);
        extra.push(showDelta ? { value: cents, currency: rowCurrency } : null);
        if (showPercent) extra.push(showDelta && prior ? cents / Math.abs(prior) : null);
      }
      out.push({
        style: row.kind === "row" ? undefined : row.kind,
        cells: [...(hasCode ? [row.code ?? null] : []), label, ...amounts, ...extra],
      });
      if (row.children?.length) walk(row.children, depth + 1);
    }
  };
  walk(rows, 0);

  return { name, columns: sheetColumns, rows: out, title, autoFilter: false };
}
