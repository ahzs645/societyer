import { PDFDocument, rgb } from "pdf-lib";
import { cleanDocumentAttachment } from "../../../shared/documentExtras";
import { documentPresentation } from "./documentPresentation";
import type { InvoiceDocumentData } from "./InvoiceDocument";
/** Embed attachment page artwork into the document's printable area, without actions/annotations. */
export async function appendDocumentAttachments(bytes: Uint8Array, invoice: InvoiceDocumentData): Promise<Uint8Array> {
  const data = documentPresentation(invoice), { advanced, design, extras, page: size } = data;
  if (!advanced.annexures.enabled || !advanced.annexures.showAttachments) return bytes;
  const attachments = (extras.attachments ?? []).filter((attachment) => attachment.mimeType === "application/pdf").map(cleanDocumentAttachment);
  if (!attachments.length) return bytes;
  const output = await PDFDocument.load(bytes), margin = design.page.margins;
  const width = size.width - margin.left - margin.right, fontSize = advanced.typography.payment.fontSize;
  const stub = data.paymentStubDetails && !advanced.paymentStub.firstPageOnly ? 24 + (3 + Math.max(1, Math.ceil(advanced.paymentStub.instructions.length / Math.max(20, width / (fontSize * 0.55))))) * fontSize * 1.3 : 0;
  const height = size.height - margin.top - margin.bottom - stub;
  let pages = 0;
  for (const attachment of attachments) {
    const source = await PDFDocument.load(Uint8Array.from(atob(attachment.dataUrl.split(",")[1]), (character) => character.charCodeAt(0)), { updateMetadata: false });
    if (source.getPageCount() > 25 || (pages += source.getPageCount()) > 50) throw new Error("Use PDF attachments with at most 25 pages each and 50 pages in total.");
    const embedded = await output.embedPdf(source, source.getPageIndices());
    for (const content of embedded) {
      const page = output.addPage([size.width, size.height]), scale = Math.min(width / content.width, height / content.height), drawnWidth = content.width * scale, drawnHeight = content.height * scale;
      const x = margin.left + (width - drawnWidth) / 2, y = margin.bottom + stub + (height - drawnHeight) / 2;
      page.drawRectangle({ x, y, width: drawnWidth, height: drawnHeight, color: rgb(1, 1, 1) });
      page.drawPage(content, { x, y, width: drawnWidth, height: drawnHeight });
    }
  }
  return output.save();
}
