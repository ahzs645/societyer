import { INVOICE_STATUS_LABEL } from "../../../shared/invoicing";
import type { XlsxSheet } from "../../lib/xlsx";
import type { InvoiceRow } from "./types";

const HEADER = ["Number", "Customer", "Email", "Issue date", "Due date", "Status", "Total", "Paid", "Balance due", "Currency", "Reference"];

/** A void invoice owes nothing, whatever its stored balance. */
function balanceDue(row: InvoiceRow) {
  return row.status === "void" ? 0 : row.balanceCents;
}

/** CSV / TSV rows: decimal amounts, ISO dates, status labels. */
export function invoiceExportTextRows(list: InvoiceRow[]): string[][] {
  return [
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
}

/** The same invoices as a typed sheet: real dates and amounts in each invoice's currency. */
export function invoiceExportSheet(list: InvoiceRow[]): XlsxSheet {
  return {
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
}
