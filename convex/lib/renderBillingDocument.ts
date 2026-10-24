"use node";
/** Node action renderer: shares the native documents and all decoration with browser downloads. */
import { createElement } from "react";
import { renderDocument, renderDocumentWithLayout } from "@formepdf/core";
import { cleanInvoiceTemplate } from "../../shared/invoiceCommerce";
import { billingDocumentFonts } from "./billingDocumentFonts";
import { InvoicePdfDocument, documentPaymentStubHeight } from "../../src/features/invoicing/InvoicePdfDocument";
import { BrandedReportPdfDocument } from "../../src/features/financials/reports/BrandedReportPdfDocument";
import { decorateDocumentPdf } from "../../src/features/invoicing/documentPdfDecoration";
import { appendDocumentAttachments } from "../../src/features/invoicing/documentPdfAttachments";
import { documentPresentation } from "../../src/features/invoicing/documentPresentation";
import { resolveDocumentOrganizationLogo } from "../../src/features/invoicing/documentOrganizationLogo";
import { commerceReportDocument } from "../../shared/commerceReportDocument";
export async function renderBillingDocument(snapshot: any): Promise<Uint8Array> {
  const engine = { renderDocument, renderDocumentWithLayout };
  const config = cleanInvoiceTemplate(snapshot.kind === "report" ? snapshot.config : snapshot.invoice.documentTemplate), fonts = billingDocumentFonts(config);
  const organization = config.showLogo && !config.brand ? await resolveDocumentOrganizationLogo(snapshot.organization) : snapshot.organization;
  if (snapshot.kind === "report") {
    const report = commerceReportDocument(snapshot.result), date = snapshot.generatedAtISO?.slice(0, 10) ?? snapshot.result.generatedAtISO?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const raw = await renderDocumentWithLayout(createElement(BrandedReportPdfDocument, { report, organization, template: config, fonts, includeGraphs: true }));
    return decorateDocumentPdf(raw.pdf, { config, fonts, engine, layout: raw.layout, organizationName: organization.name, number: report.title, content: { invoice: { number: report.title, documentKind: "statement", documentTemplate: config, issueDate: date, dueDate: date, terms: "due_on_receipt", currency: report.currency, billToName: "", lines: [] }, organization, suppressCustomerBlocks: true } });
  }
  const raw = await renderDocumentWithLayout(createElement(InvoicePdfDocument, { invoice: snapshot.invoice, organization, paymentInstructions: snapshot.paymentInstructions, fonts }));
  const bytes = await appendDocumentAttachments(raw.pdf, snapshot.invoice), data = documentPresentation(snapshot.invoice);
  return decorateDocumentPdf(bytes, { config, fonts, engine, layout: raw.layout, organizationName: organization.name, number: snapshot.invoice.number, content: { invoice: snapshot.invoice, organization }, paymentStub: data.paymentStubDetails ? { ...data.paymentStubDetails, height: documentPaymentStubHeight(data) } : undefined });
}
