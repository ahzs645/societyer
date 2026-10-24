import React from "react";
import { renderDocument, renderDocumentWithLayout } from "@formepdf/core";
import type { FontRegistration } from "@formepdf/react";
import type { InvoiceTemplate } from "../../shared/invoiceCommerce";
import type { DocumentTemplateSample } from "../../src/features/invoicing/documentTemplateSamples";
import type { InvoiceOrganization } from "../../src/features/invoicing/types";
import { InvoicePdfDocument, documentPaymentStubHeight } from "../../src/features/invoicing/InvoicePdfDocument";
import { BrandedReportPdfDocument } from "../../src/features/financials/reports/BrandedReportPdfDocument";
import { appendDocumentAttachments } from "../../src/features/invoicing/documentPdfAttachments";
import { documentPresentation } from "../../src/features/invoicing/documentPresentation";
import { decorateDocumentPdf } from "../../src/features/invoicing/documentPdfDecoration";

/** Node gallery checks use the same layout → attachment → decoration stages as real downloads. */
export async function renderSampleDocumentPdf(sample: DocumentTemplateSample, config: InvoiceTemplate, organization: InvoiceOrganization, fonts: FontRegistration[], paymentInstructions = "Sample payment instructions") {
  const engine = { renderDocument, renderDocumentWithLayout };
  if (sample.kind === "report") {
    const raw = await renderDocumentWithLayout(<BrandedReportPdfDocument report={sample.report} template={config} organization={organization} fonts={fonts} />);
    return decorateDocumentPdf(raw.pdf, { config, fonts, engine, layout: raw.layout, content: { organization, suppressCustomerBlocks: true, invoice: { documentKind: "statement", documentTemplate: config, number: sample.report.title, currency: sample.report.currency, issueDate: "2026-10-22", dueDate: "2026-10-22", terms: "due_on_receipt", billToName: "", lines: [] } } });
  }
  const raw = await renderDocumentWithLayout(<InvoicePdfDocument invoice={sample.invoice} organization={organization} fonts={fonts} paymentInstructions={paymentInstructions} />), data = documentPresentation(sample.invoice);
  const bytes = await appendDocumentAttachments(raw.pdf, sample.invoice);
  return decorateDocumentPdf(bytes, { config, fonts, engine, layout: raw.layout, content: { invoice: sample.invoice, organization }, paymentStub: data.paymentStubDetails ? { ...data.paymentStubDetails, height: documentPaymentStubHeight(data) } : undefined });
}
