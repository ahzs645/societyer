import { createElement } from "react";
import { renderDocumentWithLayout } from "@formepdf/core/worker";
import { cleanInvoiceTemplate } from "../../../../shared/invoiceCommerce";
import { decorateDocumentPdf } from "../../invoicing/documentPdfDecoration";
import { triggerBlobDownload } from "../../../lib/zip";
import { ensureDocumentPdfEngine, loadDocumentFonts } from "../../invoicing/invoicePdf";
import { BrandedReportPdfDocument, type BrandedReportPdfProps } from "./BrandedReportPdfDocument";
import { resolveDocumentOrganizationLogo } from "../../invoicing/documentOrganizationLogo";

export async function buildBrandedReportPdf(props: BrandedReportPdfProps): Promise<Uint8Array> {
  const config = cleanInvoiceTemplate(props.template);
  await ensureDocumentPdfEngine();
  const [fonts, organization] = await Promise.all([
    props.fonts ?? loadDocumentFonts(config),
    config.showLogo && !config.brand ? resolveDocumentOrganizationLogo(props.organization) : props.organization,
  ]);
  const raw = await renderDocumentWithLayout(createElement(BrandedReportPdfDocument, { ...props, organization, fonts }));
  const date = new Date().toISOString().slice(0, 10);
  return decorateDocumentPdf(raw.pdf, { config, fonts, layout: raw.layout, organizationName: organization.name, number: props.report.title, content: { invoice: { number: props.report.title, documentKind: "statement", documentTemplate: config, issueDate: date, dueDate: date, terms: "due_on_receipt", currency: props.report.currency, billToName: "", lines: [] }, organization, suppressCustomerBlocks: true } });
}
export async function downloadBrandedReportPdf(props: BrandedReportPdfProps, filename?: string) {
  const bytes = await buildBrandedReportPdf(props);
  const name = (filename ?? props.report.title).replace(/[^a-z0-9 _-]/gi, "_").slice(0, 160) || "Report";
  triggerBlobDownload(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }), `${name}.pdf`);
}
