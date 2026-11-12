/**
 * Converts the invoice list's old saved views (`billingInvoiceViews`,
 * `InvoiceListView`) into list view states for the shared invoice table
 * (`src/features/invoicing/InvoiceListTable.tsx`, table id "invoices"), so they
 * show in its views menu.
 *
 * What carries over: column order, visibility and widths; the sort; the
 * search; issue and due date ranges (date "between" filters); the minimum and
 * maximum balance (≥ / ≤ filters on Balance due); and the Drafts, Outstanding,
 * Overdue and Paid tabs (a Status filter).
 *
 * What is dropped, because the table has nothing to hold it: custom column
 * labels (a view has no per-view column names), the "Needs action" tab, the
 * customer and recurring-series narrowing, "cash activity in the last 30
 * days" and the list currency (the page's own controls, not the table's).
 */
import { DEFAULT_INVOICE_LIST_VIEW, type InvoiceListColumn, type InvoiceListView } from "./billingPricing";
import { LIST_VIEW_STATE_VERSION, staticFieldId, type ListViewColumnState, type ListViewFilterState, type ListViewState } from "./listViewState";

/** The invoice list's static table id and RecordListTable `tableId`. */
export const INVOICE_LIST_TABLE_ID = "invoices";

const field = (name: string) => staticFieldId(INVOICE_LIST_TABLE_ID, name);

const COLUMN_FIELD: Record<InvoiceListColumn, string> = {
  number: "number", customer: "customer", issueDate: "issueDate", dueDate: "dueDate", total: "totalCents",
  balance: "balanceCents", status: "status", paid: "paidCents", currency: "currency", email: "email", reference: "reference",
};
/** Invoice table columns the old views never had: they stay hidden, at their default widths. */
const NEWER_COLUMNS: Array<{ name: string; size: number }> = [{ name: "items", size: 220 }, { name: "seriesName", size: 180 }];

const TAB_STATUSES: Partial<Record<InvoiceListView["tab"], string[]>> = {
  drafts: ["draft"],
  outstanding: ["issued", "sent", "partially_paid", "overdue"],
  overdue: ["overdue"],
  paid: ["paid"],
};

export type InvoiceViewConversion = { state: ListViewState; dropped: string[] };

export function invoiceListViewToListViewState(view: InvoiceListView): InvoiceViewConversion {
  const dropped: string[] = [];
  const columns: ListViewColumnState[] = view.columns.map((column, position) => ({
    fieldMetadataId: field(COLUMN_FIELD[column.key]),
    position,
    size: Math.round(column.width),
    isVisible: column.visible,
  }));
  for (const extra of NEWER_COLUMNS) {
    columns.push({ fieldMetadataId: field(extra.name), position: columns.length, size: extra.size, isVisible: false });
  }
  if (view.columns.some((column) => column.label && column.label !== DEFAULT_INVOICE_LIST_VIEW.columns.find((entry) => entry.key === column.key)?.label)) dropped.push("column labels");

  const filters: ListViewFilterState[] = [];
  const statuses = TAB_STATUSES[view.tab];
  if (statuses) filters.push({ id: "legacy-tab", fieldMetadataId: field("status"), operator: "in", value: statuses });
  else if (view.tab === "needs_action") dropped.push("Needs action tab");
  const range = (start: string, end: string) => ({ preset: "custom", ...(start ? { start } : {}), ...(end ? { end } : {}) });
  if (view.fromDate || view.toDate) filters.push({ id: "legacy-issued", fieldMetadataId: field("issueDate"), operator: "between", value: range(view.fromDate, view.toDate) });
  if (view.dueFrom || view.dueTo) filters.push({ id: "legacy-due", fieldMetadataId: field("dueDate"), operator: "between", value: range(view.dueFrom, view.dueTo) });
  if (view.minimumBalanceCents !== null) filters.push({ id: "legacy-balance-min", fieldMetadataId: field("balanceCents"), operator: "gte", value: view.minimumBalanceCents });
  if (view.maximumBalanceCents !== null) filters.push({ id: "legacy-balance-max", fieldMetadataId: field("balanceCents"), operator: "lte", value: view.maximumBalanceCents });
  if (view.customerKey) dropped.push("customer");
  if (view.seriesId) dropped.push("recurring series");
  if (view.recentOnly) dropped.push("recent cash activity");
  if (view.currency) dropped.push("currency");

  const search = view.search.trim().slice(0, 500);
  return {
    state: {
      version: LIST_VIEW_STATE_VERSION,
      columns,
      sorts: [{ id: COLUMN_FIELD[view.sortKey], fieldMetadataId: field(COLUMN_FIELD[view.sortKey]), direction: view.sortDirection }],
      filters,
      filterGroups: [],
      groups: [],
      density: "comfortable",
      ...(search ? { searchTerm: search } : {}),
    },
    dropped,
  };
}

