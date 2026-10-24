import type { InvoiceListView } from "../../../shared/billingPricing";
import { INVOICE_STATUS_LABEL } from "../../../shared/invoicing";
import type { XlsxSheet } from "../../lib/xlsx";
import type { InvoiceRow } from "./types";

const HEADER = ["Number", "Customer", "Email", "Issue date", "Due date", "Status", "Total", "Paid", "Balance due", "Currency", "Reference"];

/** A void invoice owes nothing, whatever its stored balance. */
function balanceDue(row: InvoiceRow) {
  return row.status === "void" ? 0 : row.balanceCents;
}

/** CSV / TSV rows: decimal amounts, ISO dates, status labels. */
export function invoiceExportTextRows(list: InvoiceRow[], columns?: InvoiceListView["columns"]): string[][] {
  const rows = [
    HEADER,
    ...list.map((row) => [
      row.number,
      row.billToName,
      row.billToEmail ?? "",
      row.issueDate,
      row.dueDate,
      INVOICE_STATUS_LABEL[row.status],
      (row.totalCents / 100).toFixed(2),
      (row.paidCents / 100).toFixed(2),
      (balanceDue(row) / 100).toFixed(2),
      row.currency,
      row.reference ?? "",
    ]),
  ];
  if (!columns) return rows;
  const keys = ["number","customer","email","issueDate","dueDate","status","total","paid","balance","currency","reference"];
  const visible = columns.filter(c => c.visible);
  return [visible.map(c => c.label), ...rows.slice(1).map(row => visible.map(c => row[keys.indexOf(c.key)]))];
}

/** The same invoices as a typed sheet: real dates and amounts in each invoice's currency. */
export function invoiceExportSheet(list: InvoiceRow[], columns?: InvoiceListView["columns"]): XlsxSheet {
  const sheet: XlsxSheet = {
    name: "Invoices",
    columns: [
      { header: "Number" },
      { header: "Customer" },
      { header: "Email" },
      { header: "Issue date", type: "date" },
      { header: "Due date", type: "date" },
      { header: "Status" },
      { header: "Total", type: "currency", cents: true },
      { header: "Paid", type: "currency", cents: true },
      { header: "Balance due", type: "currency", cents: true },
      { header: "Currency" },
      { header: "Reference" },
    ],
    rows: list.map((row) => [
      row.number,
      row.billToName,
      row.billToEmail ?? "",
      row.issueDate,
      row.dueDate,
      INVOICE_STATUS_LABEL[row.status],
      { value: row.totalCents, currency: row.currency },
      { value: row.paidCents, currency: row.currency },
      { value: balanceDue(row), currency: row.currency },
      row.currency,
      row.reference ?? "",
    ]),
  };
  if (!columns) return sheet;
  const keys = ["number","customer","email","issueDate","dueDate","status","total","paid","balance","currency","reference"];
  const visible = columns.filter(c => c.visible);
  return { ...sheet, columns: visible.map(c => ({ ...sheet.columns[keys.indexOf(c.key)], header:c.label })), rows:sheet.rows.map(row => visible.map(c => (Array.isArray(row) ? row : row.cells)[keys.indexOf(c.key)])) };
}
