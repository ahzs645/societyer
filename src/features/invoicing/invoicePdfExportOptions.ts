import { cleanInvoiceTemplate, resolveDocumentDesign } from "../../../shared/invoiceCommerce";
import { lineTaxes } from "../../../shared/invoiceMoney";
import { taxAssessmentPrintSummary } from "../../../shared/tax";
import type { InvoiceDocumentData } from "./InvoiceDocument";

export type PdfColumnChoice = "template" | "auto" | "show" | "hide";
export type InvoicePdfExportOptions = {
  quantity: PdfColumnChoice;
  rate: PdfColumnChoice;
  tax: PdfColumnChoice;
  taxTreatmentNotes: boolean;
  eftCurrency: boolean;
  pageNumbers: "template" | "multiple_pages" | "always" | "off";
  pstRegistrationPending?: boolean;
};

export const PST_REGISTRATION_PENDING_NOTICE = "BC PST registration number: pending.";

export const TEMPLATE_PDF_EXPORT: InvoicePdfExportOptions = {
  quantity: "template", rate: "template", tax: "template", taxTreatmentNotes: true, eftCurrency: true, pageNumbers: "template",
};
export const SIMPLIFIED_PDF_EXPORT: InvoicePdfExportOptions = {
  quantity: "auto", rate: "auto", tax: "auto", taxTreatmentNotes: false, eftCurrency: false, pageNumbers: "multiple_pages",
};

/** A presentation copy only: saved invoice, tax decisions and journal amounts stay intact. */
export function invoicePdfExportView(invoice: InvoiceDocumentData, options?: InvoicePdfExportOptions): InvoiceDocumentData {
  if (!options) return invoice;
  const config = cleanInvoiceTemplate(invoice.documentTemplate), design = resolveDocumentDesign(config);
  const amountVisible = design.table.columns.some(column => column.key === "amount" && column.visible);
  const fixedAmounts = invoice.lines.length > 0 && invoice.lines.every(line => line.quantity === 1 && !line.unit?.trim());
  const taxProfiles = new Set(invoice.lines.map(line => line.taxAssessment
    ? taxAssessmentPrintSummary(line.taxAssessment)
    : JSON.stringify(lineTaxes(line))));
  const mixedTaxModes = new Set(invoice.lines.map(line => line.taxMode || invoice.money?.taxMode || "exclusive")).size > 1;
  const taxNeedsReview = invoice.lines.some(line => line.taxAssessment && (!line.taxAssessment.confirmed || line.taxAssessment.status !== "ready"));
  const taxesInTotals = design.totals.showTax || invoice.lines.some(line => line.taxAssessment?.components.some(component => component.collection === "collect"));
  const hasTaxes = invoice.lines.some(line => lineTaxes(line).length > 0);
  design.table.columns = design.table.columns.map(column => {
    if (column.key !== "quantity" && column.key !== "rate" && column.key !== "tax") return column;
    const choice = options[column.key];
    if (choice === "template") return column;
    const visible = choice === "show" || choice === "auto" && (column.key === "tax"
      ? taxNeedsReview || mixedTaxModes || taxProfiles.size > 1 || hasTaxes && !taxesInTotals
      : !amountVisible || !fixedAmounts);
    return { ...column, visible };
  });
  // Even an unusual template that only contains one detail column remains exportable.
  if (!design.table.columns.some(column => column.visible)) design.table.columns.find(column => column.key === "item")!.visible = true;
  if (options.pageNumbers !== "template") design.footer.pageNumbers = options.pageNumbers !== "off";
  const paymentMethods = options.eftCurrency ? invoice.paymentMethods : invoice.paymentMethods?.map(method => ({
    ...method,
    details: method.type !== "eft" ? method.details : method.details.split(/\r?\n/).filter(line => {
      const match = line.match(/^\s*Currency\s*:\s*([A-Z]{3})\s*$/i);
      return !match || match[1].toUpperCase() !== invoice.currency.toUpperCase();
    }).join("\n"),
  }));
  return { ...invoice, paymentMethods, documentTemplate: { ...config, design } };
}
