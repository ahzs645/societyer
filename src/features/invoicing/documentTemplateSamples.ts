import type { DocumentKind, InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { dueDateForTerms } from "../../../shared/invoicing";
import type { InvoiceDocumentData } from "./InvoiceDocument";
import type { BrandedReportData } from "../financials/reports/brandedReportTypes";

export const TEMPLATE_KIND_LABELS: Record<DocumentKind, string> = { invoice: "Invoice", receipt: "Payment receipt", work_order: "Work order", report: "Financial report", quote: "Quote", statement: "Customer statement" };
export type DocumentTemplateSample = { kind: "report"; report: BrandedReportData } | { kind: Exclude<DocumentKind, "report">; invoice: InvoiceDocumentData };

/** Synthetic examples only: viewing a template never creates a customer, invoice or payment. */
export function documentTemplateSample(config: InvoiceTemplate, kind: DocumentKind, { today, currency }: { today: string; currency: string }): DocumentTemplateSample {
  const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
  if (kind === "report") return { kind, report: {
    title: "Statement of operations", subtitle: "Sample financial report", currency,
    filterSummary: [`Year: ${today.slice(0, 4)}`, `Currency: ${currency}`, "Basis: accrual", "Sample figures for template preview"],
    charts: [{ title: "Revenue and expenses", kind: "bars", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ label: "Revenue", color: config.accentColor, values: [360000, 420000, 510000, 580000] }, { label: "Expenses", color: "#b88655", values: [240000, 285000, 310000, 370000] }] }],
    columns: [{ key: "account", label: "Account", width: 2.5 }, ...["Q1", "Q2", "Q3", "Q4"].map((label) => ({ key: label, label, align: "right" as const }))],
    rows: [
      { key: "revenue", kind: "section", cells: ["Revenue", "", "", "", ""] },
      { key: "services", cells: ["Service income", ...[360000, 420000, 510000, 580000].map(money)] },
      { key: "expenses", kind: "section", cells: ["Expenses", "", "", "", ""] },
      { key: "operations", cells: ["Operating costs", ...[240000, 285000, 310000, 370000].map(money)] },
      { key: "surplus", kind: "total", cells: ["Surplus / (Deficit)", ...[120000, 135000, 200000, 210000].map(money)] },
    ],
  } };

  const common: InvoiceDocumentData = {
    documentTemplate: config, documentKind: kind,
    number: kind === "receipt" ? "RCPT-SAMPLE-001" : kind === "work_order" ? "WO-SAMPLE-001" : kind === "quote" ? "QT-SAMPLE-001" : kind === "statement" ? "STMT-SAMPLE-001" : "INV-SAMPLE-001",
    currency, issueDate: today, dueDate: dueDateForTerms(today, "net_30"), terms: "net_30", reference: "PO-SAMPLE-1042",
    billToName: "Sample customer", billToEmail: "customer@example.test", billToAddress: "100 Example Street\nVancouver, BC",
    shipToName: "Sample delivery contact", shipToAddress: "200 Example Avenue\nVancouver, BC",
    status: kind === "invoice" ? "draft" : kind === "receipt" ? "received" : "in_progress",
    lines: [
      { key: "labour", sku: "SVC-001", item: "Professional service", description: "Inspection, consultation and service", quantity: 2, unit: "hour", unitPriceCents: 8500, taxRatePercent: 5, taxLabel: "GST" },
      { key: "parts", sku: "PART-012", item: "Replacement component", description: "Supplied and fitted", quantity: 1, unit: "each", unitPriceCents: 12500, taxRatePercent: 5, taxLabel: "GST" },
    ],
    memo: "Sample document. Contact us with any questions about these services.",
  };
  if (kind === "receipt") {
    common.lines = [{ key: "sample-payment", item: "Payment for INV-SAMPLE-001", quantity: 1, unit: "payment", unitPriceCents: 15000 }];
    common.reference = "INV-SAMPLE-001";
    common.documentDetails = [
      { label: "Payment date", value: today }, { label: "Amount received", value: money(15000) },
      { label: "Payment method", value: "E-transfer" }, { label: "Payment reference", value: "PAY-SAMPLE-1042" },
      { label: "Destination", value: "Example operating account" }, { label: "Invoice balance at export", value: money(15975) },
    ];
    common.memo = "Sample payment receipt. Thank you for your payment.";
  } else if (kind === "work_order") {
    common.documentDetails = [
      { label: "Equipment / item", value: "Sample equipment" }, { label: "Serial number", value: "SAMPLE-0042" },
      { label: "Reported problem", value: "Inspect intermittent power and replace worn component." },
      { label: "Repair status", value: "In progress" }, { label: "Target date", value: dueDateForTerms(today, "net_7") },
    ];
    common.memo = "Sample work notes: inspect the connections, replace the component and complete a safety test.";
  } else if (kind === "quote") {
    common.documentDetails = [{ label: "Revision", value: "1" }, { label: "Valid until", value: common.dueDate }, { label: "Status", value: "Draft" }];
    common.status = "draft";
  } else if (kind === "statement") {
    common.documentFinancials = { totalCents: 25975, balanceCents: 25975 };
    common.documentTable = { columns: [{ label: "Date", width: 1 }, { label: "Movement", width: 2 }, { label: "Charges", align: "right" }, { label: "Payments", align: "right" }, { label: "Balance", align: "right" }], rows: [[today, "Opening balance", "", "", money(10000)], [today, "INV-SAMPLE-001", money(30975), "", money(40975)], [today, "PAY-SAMPLE-1042", "", money(15000), money(25975)]] };
    common.documentSummary = [{ label: "Opening balance", value: money(10000) }, { label: "Charges", value: money(30975) }, { label: "Payments", value: money(15000) }, { label: "Closing balance", value: money(25975), strong: true }];
    common.documentDetails = [{ label: "Period", value: `${today.slice(0, 7)}-01 – ${today}` }, { label: "Currency", value: currency }];
    common.status = undefined;
  }
  return { kind, invoice: common };
}
