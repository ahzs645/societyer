import { useEffect, useMemo, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { ReceiptText } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTableBulkBar, RecordTablePhoneCard, staticRecordTable, type BulkAction } from "@/platform/record-engine";
import { Money } from "../../components/Money";
import { formatDate } from "../../lib/format";
import { InvoiceStatusPill, NeedsActionPill } from "./InvoiceStatusPill";
import type { InvoiceRow } from "./types";
import { tablePerCurrency } from "./currencyTables";
import { api } from "@/lib/convexApi";
import { useSociety } from "@/hooks/useSociety";
import { usePermissions } from "@/hooks/usePermissions";
import { INVOICE_LIST_TABLE_ID } from "../../../shared/invoiceListViewMigration";
import { INVOICE_CLIENT_RESPONSE_LABEL as CLIENT_RESPONSE_LABEL, INVOICE_STATUSES, INVOICE_STATUS_LABEL, type InvoiceStatus } from "../../../shared/invoicing";

const STATUS_COLOR: Record<InvoiceStatus, "gray" | "blue" | "amber" | "green" | "red"> = {
  draft: "gray", issued: "blue", sent: "blue", partially_paid: "amber", paid: "green", overdue: "red", void: "gray",
};

/** The invoice list's columns. Amount columns name the list's currency, so there is one definition per currency. */
const invoiceTable = tablePerCurrency((currency) => {
  const money = { isCents: true, currencyCode: currency };
  return staticRecordTable({
    // shared/invoiceListViewMigration.ts names these columns by this id and their field names.
    id: INVOICE_LIST_TABLE_ID,
    nameSingular: "invoice",
    namePlural: "invoices",
    labelSingular: "Invoice",
    labelPlural: "Invoices",
    labelIdentifierFieldName: "number",
    density: "comfortable",
    fields: [
      { name: "number", label: "Number", fieldType: FIELD_TYPES.TEXT, size: 150, config: { groupable: false } },
      { name: "customer", label: "Customer", fieldType: FIELD_TYPES.TEXT, size: 240 },
      { name: "issueDate", label: "Issued", fieldType: FIELD_TYPES.DATE, size: 120 },
      { name: "dueDate", label: "Due", fieldType: FIELD_TYPES.DATE, size: 120 },
      { name: "totalCents", label: "Amount", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: money },
      { name: "balanceCents", label: "Balance due", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: money },
      {
        name: "status",
        label: "Status",
        fieldType: FIELD_TYPES.SELECT,
        size: 200,
        config: { options: INVOICE_STATUSES.map((status) => ({ value: status, label: INVOICE_STATUS_LABEL[status], color: STATUS_COLOR[status] })) },
      },
      { name: "paidCents", label: "Paid", fieldType: FIELD_TYPES.CURRENCY, size: 130, isVisible: false, config: money },
      { name: "currency", label: "Currency", fieldType: FIELD_TYPES.TEXT, size: 100, isVisible: false },
      { name: "email", label: "Email", fieldType: FIELD_TYPES.EMAIL, size: 200, isVisible: false },
      { name: "reference", label: "Reference", fieldType: FIELD_TYPES.TEXT, size: 140, isVisible: false },
      { name: "items", label: "Items", fieldType: FIELD_TYPES.TEXT, size: 220, isVisible: false, config: { groupable: false } },
      { name: "seriesName", label: "Recurring series", fieldType: FIELD_TYPES.TEXT, size: 180, isVisible: false },
    ],
  });
});

type InvoiceRecord = {
  _id: string;
  number: string;
  customer: string;
  issueDate: string;
  dueDate: string;
  totalCents: number;
  /** What is still owed: nothing on a void invoice, whatever its stored balance. */
  balanceCents: number;
  status: InvoiceStatus;
  paidCents: number;
  currency: string;
  email: string;
  reference: string;
  /** The line items, so search finds an invoice by what it bills for. */
  items: string;
  seriesName: string;
  invoice: InvoiceRow;
};

function invoiceRecord(row: InvoiceRow): InvoiceRecord {
  return {
    _id: row._id,
    number: row.number,
    customer: row.billToName,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    totalCents: row.totalCents,
    balanceCents: row.status === "void" ? 0 : row.balanceCents,
    status: row.status,
    paidCents: row.paidCents,
    currency: row.currency,
    email: row.billToEmail ?? "",
    reference: row.reference ?? "",
    items: row.lines.map((line) => line.item).join(", "),
    seriesName: row.seriesId ? row.seriesName ?? "Recurring series" : "",
    invoice: row,
  };
}

const importedWorkspaces = new Set<string>();

/**
 * The invoice list's old saved views (each person's own, from the former
 * "Filters and columns" drawer) become views of this list the first time
 * someone who may save views opens it (listViews:importInvoiceViews, which
 * converts each old view once; see shared/invoiceListViewMigration.ts).
 */
function useImportLegacyInvoiceViews() {
  const society = useSociety() as { _id?: string } | null | undefined;
  const societyId = society?._id ? String(society._id) : null;
  const { can, loaded } = usePermissions();
  const mayImport = loaded && can("settings:write");
  const importViews = useMutation(api.listViews.importInvoiceViews);
  useEffect(() => {
    if (!societyId || !mayImport || importedWorkspaces.has(societyId)) return;
    importedWorkspaces.add(societyId);
    void Promise.resolve(importViews({ societyId })).catch(() => {
      // Tried again on the next visit.
      importedWorkspaces.delete(societyId);
    });
  }, [societyId, mayImport, importViews]);
}

function itemsSummary(row: InvoiceRow) {
  return `${row.lines[0]?.item ?? ""}${row.lines.length > 1 ? ` +${row.lines.length - 1}` : ""}`;
}

/**
 * The invoice list on the shared record table: search, column filters, sort,
 * column choices, selection and the bulk bar come from the engine. Rows arrive
 * newest first; the customer opens that customer's invoices and a recurring
 * invoice's series opens the series.
 */
export function InvoiceListTable({
  rows,
  currency,
  label,
  loading = false,
  openId,
  selectable,
  bulkActions,
  emptyState,
  onOpen,
  onOpenCustomer,
  onOpenSeries,
}: {
  rows: InvoiceRow[];
  /** The list's currency: every row is in it, and totals are shown in it. */
  currency: string;
  label: string;
  loading?: boolean;
  openId: string | null;
  selectable: boolean;
  bulkActions: BulkAction[];
  emptyState: ReactNode;
  onOpen: (id: string) => void;
  onOpenCustomer: (row: InvoiceRow) => void;
  onOpenSeries: (seriesId: string) => void;
}) {
  const records = useMemo(() => rows.map(invoiceRecord), [rows]);
  useImportLegacyInvoiceViews();
  return (
    <RecordListTable<InvoiceRecord>
      table={invoiceTable(currency)}
      tableId={INVOICE_LIST_TABLE_ID}
      savedViews
      label={label}
      icon={<ReceiptText size={14} />}
      records={records}
      loading={loading}
      selectable={selectable}
      highlightedRecordId={openId}
      onOpen={(record) => onOpen(record._id)}
      emptyState={emptyState}
      renderCell={({ record, field }) => {
        const row = record.invoice;
        switch (field.name) {
          case "number":
            return <span>{row.number}{row.seriesId && <span className="invoice-table__tag" title={row.seriesName}>Recurring</span>}</span>;
          case "customer":
            return (
              <span>
                <button type="button" className="invoice-table__link" title={`Show invoices for ${row.billToName}`} onClick={(event) => { event.stopPropagation(); onOpenCustomer(row); }}>{row.billToName}</button>
                <span className="muted invoice-table__sub">{itemsSummary(row)}</span>
              </span>
            );
          case "dueDate":
            return row.status === "overdue" ? <span className="invoice-table__due--overdue">{formatDate(row.dueDate)}</span> : undefined;
          case "totalCents":
            return <Money cents={row.totalCents} currency={row.currency} struck={row.status === "void"} />;
          case "balanceCents":
            return record.balanceCents === 0 ? <span className="muted">—</span> : <Money cents={row.balanceCents} currency={row.currency} />;
          case "paidCents":
            return <Money cents={row.paidCents} currency={row.currency} />;
          case "status":
            return (
              <span className="invoice-status-cell">
                <InvoiceStatusPill status={row.status} daysOverdue={row.daysOverdue} partial={row.paidCents > 0} />
                <NeedsActionPill flags={row.needsAction} />
                {row.lifecycle === "issued" && <span className="invoice-workflow__delivery muted">Sending not recorded</span>}
                {row.clientResponse && <span className="invoice-workflow__delivery" title={row.clientResponse.note}>{CLIENT_RESPONSE_LABEL[row.clientResponse.response]}</span>}
              </span>
            );
          case "seriesName":
            return row.seriesId ? (
              <button type="button" className="invoice-table__link" onClick={(event) => { event.stopPropagation(); onOpenSeries(row.seriesId!); }}>{record.seriesName}</button>
            ) : undefined;
          default:
            return undefined;
        }
      }}
      renderPhoneCard={(record, { open, selecting }) => {
        const row = record.invoice;
        // One amount when the balance is the whole total or nothing is owed; both once part is paid.
        const split = record.balanceCents !== 0 && record.balanceCents !== row.totalCents;
        return (
          <RecordTablePhoneCard
            title={<>{row.number}{row.seriesId && <span className="invoice-table__tag">Recurring</span>}</>}
            recordName={row.number}
            badge={<InvoiceStatusPill status={row.status} daysOverdue={row.daysOverdue} partial={row.paidCents > 0} />}
            meta={[
              row.billToName,
              split
                ? <span key="amounts">Balance <Money cents={row.balanceCents} currency={row.currency} /> of <Money cents={row.totalCents} currency={row.currency} /></span>
                : <Money key="amount" cents={row.totalCents} currency={row.currency} struck={row.status === "void"} />,
            ]}
            detail={[`Due ${formatDate(row.dueDate)}`, itemsSummary(row)]}
            onOpen={open}
            selecting={selecting}
          />
        );
      }}
      bulkActions={selectable ? bulkActions : undefined}
      bulkSummary={(selected) => <><Money currency={currency} cents={selected.reduce((sum, record) => sum + (typeof record.balanceCents === "number" ? record.balanceCents : 0), 0)} /> due</>}
    />
  );
}
