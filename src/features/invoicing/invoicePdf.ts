import openSansUrl from "../../assets/invoice-branding/OpenSans-Regular.ttf?url";
import openSansBoldUrl from "../../assets/invoice-branding/OpenSans-Bold.ttf?url";
import liberationSerifUrl from "../../assets/invoice-branding/LiberationSerif-Regular.ttf?url";
import liberationSerifBoldUrl from "../../assets/invoice-branding/LiberationSerif-Bold.ttf?url";
import interRegularUrl from "../../assets/invoice-branding/Inter-Regular.ttf?url";
import interBoldUrl from "../../assets/invoice-branding/Inter-SemiBold.ttf?url";
import interDisplayUrl from "../../assets/invoice-branding/InterDisplay-Medium.ttf?url";
import spaceMonoUrl from "../../assets/invoice-branding/SpaceMono-Regular.ttf?url";
import regularUrl from "../../assets/pdf-fonts/NotoSerif-Regular.ttf?url";
import boldUrl from "../../assets/pdf-fonts/NotoSerif-Bold.ttf?url";
import { createElement } from "react";
import { init, renderDocumentWithLayout } from "@formepdf/core/worker";
import type { FontRegistration } from "@formepdf/react";
import wasmUrl from "@formepdf/core/pkg-web/forme_bg.wasm?url";
import type { InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { InvoicePdfDocument, documentPaymentStubHeight, type InvoicePdfProps } from "./InvoicePdfDocument";
import { appendDocumentAttachments } from "./documentPdfAttachments";
import { resolveDocumentOrganizationLogo } from "./documentOrganizationLogo";
import { documentPresentation } from "./documentPresentation";
import { decorateDocumentPdf } from "./documentPdfDecoration";
import { triggerBlobDownload } from "../../lib/zip";

let engineReady: Promise<void> | undefined;
export async function ensureDocumentPdfEngine(): Promise<void> {
  if (!engineReady) engineReady = init(wasmUrl).catch((error) => { engineReady = undefined; throw error; });
  await engineReady;
}
/** All selectable families are local assets, including when the document mixes section fonts. */
export async function loadDocumentFonts(config?: Partial<InvoiceTemplate>): Promise<FontRegistration[]> {
  const brandSerif = !config?.brand || config.brand.font === "serif";
  return [
    { family: "Invoice", src: brandSerif ? regularUrl : interRegularUrl }, { family: "Invoice", src: brandSerif ? boldUrl : interBoldUrl, fontWeight: "bold" },
    { family: "InvoiceSans", src: interRegularUrl }, { family: "InvoiceSans", src: interBoldUrl, fontWeight: "bold" },
    { family: "InvoiceSerif", src: regularUrl }, { family: "InvoiceSerif", src: boldUrl, fontWeight: "bold" },
    { family: "InvoiceMono", src: spaceMonoUrl }, { family: "InvoiceMono", src: spaceMonoUrl, fontWeight: "bold" },
    { family: "InvoiceOpenSans", src: openSansUrl }, { family: "InvoiceOpenSans", src: openSansBoldUrl, fontWeight: "bold" },
    { family: "InvoiceLiberationSerif", src: liberationSerifUrl }, { family: "InvoiceLiberationSerif", src: liberationSerifBoldUrl, fontWeight: "bold" },
    { family: "InvoiceDisplay", src: interDisplayUrl }, { family: "InvoiceLabel", src: spaceMonoUrl },
  ];
}
/** No upload or server required: pdfcn → Forme pagination → vector PDF and real page numbers. */
export async function buildInvoicePdf(props: InvoicePdfProps): Promise<Uint8Array> {
  await ensureDocumentPdfEngine();
  const fonts = props.fonts ?? await loadDocumentFonts(props.invoice.documentTemplate);
  const organization = await resolveDocumentOrganizationLogo(props.organization);
  const rendered = await renderDocumentWithLayout(createElement(InvoicePdfDocument, { ...props, organization, fonts }));
  const bytes = await appendDocumentAttachments(rendered.pdf, props.invoice);
  const data = documentPresentation(props.invoice);
  const { cleanInvoiceTemplate } = await import("../../../shared/invoiceCommerce");
  return decorateDocumentPdf(bytes, { config: cleanInvoiceTemplate(props.invoice.documentTemplate), organizationName: props.organization.name, number: props.invoice.number, fonts, layout: rendered.layout, content: { invoice: props.invoice, organization }, paymentStub: data.paymentStubDetails ? { ...data.paymentStubDetails, height: documentPaymentStubHeight(data) } : undefined });
}
export async function downloadInvoicePdf(invoice: InvoicePdfProps["invoice"], organization: InvoicePdfProps["organization"], paymentInstructions?: string) {
  const bytes = await buildInvoicePdf({ invoice, organization, paymentInstructions });
  const filename = `${invoice.number.replace(/[^a-z0-9_-]/gi, "_") || "Document"}.pdf`;
  triggerBlobDownload(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }), filename);
}
