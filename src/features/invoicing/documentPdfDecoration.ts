import { pushGraphicsState, popGraphicsState, rectangle, clip, endPath, concatTransformationMatrix, PDFDocument, PDFArray, PDFDict, PDFString, PDFHexString, PDFName, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage, type PDFEmbeddedPage, type PDFNumber } from "pdf-lib";
import type { FontRegistration } from "@formepdf/react";
import { createElement } from "react";
import { Document, Page } from "@formepdf/react";
import { resolveDocumentAdvanced, resolveDocumentDesign, type InvoiceTemplate, type DocumentBackground } from "../../../shared/invoiceCommerce";
import type { LayoutInfo, ElementInfo } from "@formepdf/core";
import type { InvoiceDocumentData } from "./InvoiceDocument";
import type { InvoiceOrganization } from "./types";
import { documentAddressLines } from "./documentPresentation";
import { documentPdfFontFamily } from "./documentPresentation";
import { cleanDocumentLink } from "../../../shared/documentRichContent";
import { DocumentRichPdf } from "./DocumentRichContent";
export type DocumentPdfEngine = Pick<typeof import("@formepdf/core"), "renderDocument" | "renderDocumentWithLayout">;
export type DocumentPdfDecoration = { config: InvoiceTemplate; organizationName?: string; number?: string; fonts?: FontRegistration[]; engine?: DocumentPdfEngine; layout?: LayoutInfo; content?: { invoice: InvoiceDocumentData; organization: InvoiceOrganization & { logoUrl?: string | null }; suppressCustomerBlocks?: boolean }; paymentStub?: { number: string; customer: string; total: string; balance: string; height: number; totalLabel?: string; balanceLabel?: string; showBalance?: boolean } };
const color = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const imageBytes = (data: string) => Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (character) => character.charCodeAt(0));
function wrapText(text: string, font: PDFFont, size: number, width: number) {
  return text.split(/\r?\n/).flatMap((paragraph) => {
    const lines: string[] = []; let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (current && font.widthOfTextAtSize(`${current}${word}`, size) > width) { lines.push(current.trimEnd()); current = ""; }
      for (const character of word) { if (current && font.widthOfTextAtSize(current + character, size) > width) { lines.push(current.trimEnd()); current = ""; } current += character; }
      current += " ";
    }
    lines.push(current.trimEnd()); return lines;
  });
}
async function paintBackground(pdf: PDFDocument, page: PDFPage, setting: DocumentBackground, box: { x: number; y: number; width: number; height: number }, images: Map<string, PDFImage>) {
  page.drawRectangle({ ...box, color: color(setting.color) });
  if (!setting.image) return;
  let image = images.get(setting.image);
  if (!image) { image = /^data:image\/png/i.test(setting.image) ? await pdf.embedPng(imageBytes(setting.image)) : await pdf.embedJpg(imageBytes(setting.image)); images.set(setting.image, image); }
  const scale = setting.fit === "cover" ? Math.max(box.width / image.width, box.height / image.height) : Math.min(box.width / image.width, box.height / image.height);
  const width = setting.fit === "stretch" ? box.width : image.width * scale, height = setting.fit === "stretch" ? box.height : image.height * scale;
  const horizontal = setting.position.includes("left") ? 0 : setting.position.includes("right") ? 1 : 0.5;
  const vertical = setting.position.includes("top") ? 1 : setting.position.includes("bottom") ? 0 : 0.5;
  // Crop cover artwork to its assigned band using the PDF graphics-state clipping operators.
  page.pushOperators(pushGraphicsState(), rectangle(box.x, box.y, box.width, box.height), clip(), endPath());
  page.drawImage(image, { x: box.x + (box.width - width) * horizontal, y: box.y + (box.height - height) * vertical, width, height, opacity: setting.opacity });
  page.pushOperators(popGraphicsState());
}
/** Apply passive artwork beneath existing page content before adding searchable margin bands. */
async function underlayBackgrounds(bytes: Uint8Array, config: InvoiceTemplate): Promise<Uint8Array> {
  const design = resolveDocumentDesign(config), advanced = resolveDocumentAdvanced(design), settings = advanced.backgrounds;
  if (!Object.values(settings).some((entry) => entry.image || entry.color.toLowerCase() !== "#ffffff")) return bytes;
  const pdf = await PDFDocument.load(bytes), images = new Map<string, PDFImage>();
  for (const page of pdf.getPages()) {
    page.node.normalize();
    const contents = page.node.Contents() as PDFArray, existing = contents.asArray();
    const { width, height } = page.getSize(), margin = design.page.margins;
    await paintBackground(pdf, page, settings.body, { x: 0, y: 0, width, height }, images);
    await paintBackground(pdf, page, settings.header, { x: 0, y: height - margin.top, width, height: margin.top }, images);
    await paintBackground(pdf, page, settings.footer, { x: 0, y: 0, width, height: margin.bottom }, images);
    const updated = (page.node.Contents() as PDFArray).asArray();
    page.node.set(PDFName.of("Contents"), pdf.context.obj([...updated.slice(existing.length), ...existing]));
  }
  return pdf.save();
}
/** Genuine page counts, rich first/continuation bands, positioned page numbers and payment stubs. */
export async function decorateDocumentPdf(input: Uint8Array, { config, fonts, paymentStub, content, layout, engine: suppliedEngine }: DocumentPdfDecoration): Promise<Uint8Array> {
  const design = resolveDocumentDesign(config), advanced = resolveDocumentAdvanced(design);
  const bytes = await underlayBackgrounds(input, config);
  if (!design.header.text && !design.header.continuationText && !design.footer.text && !design.footer.continuationText && !design.footer.pageNumbers && !Object.values(advanced.rich).some(Boolean) && !advanced.paymentStub.enabled && !content) return bytes;
  const pdf = await PDFDocument.load(bytes), cache = new Map<string, PDFFont>();
  const engineForRich = async (): Promise<DocumentPdfEngine> => {
    if (suppliedEngine) return suppliedEngine;
    if (typeof window === "undefined") {
      // Local Node scripts resolve their installed package. Hosted Node actions inject the
      // statically bundled engine; keeping this import opaque excludes Node WASM from Vite.
      const nodePackage = "@formepdf/core";
      return import(/* @vite-ignore */ nodePackage) as Promise<DocumentPdfEngine>;
    }
    return import("@formepdf/core/worker");
  };
  const getFont = async (family: string) => {
    if (cache.has(family)) return cache.get(family)!;
    const registration = fonts?.find((font) => font.family === family && (!font.fontWeight || font.fontWeight === "normal" || font.fontWeight === 400));
    let embedded: PDFFont;
    if (registration) { const fontkit = await import("@pdf-lib/fontkit"); pdf.registerFontkit(fontkit.default); const source = typeof registration.src === "string" ? new Uint8Array(await (await fetch(registration.src)).arrayBuffer()) : registration.src; embedded = await pdf.embedFont(source, { subset: false }); }
    else embedded = await pdf.embedFont(family === "Times-Roman" ? StandardFonts.TimesRoman : family === "Courier" ? StandardFonts.Courier : StandardFonts.Helvetica);
    cache.set(family, embedded); return embedded;
  };
  const headerType = design.typography.header, footerType = design.typography.footer;
  const headerFont = await getFont(documentPdfFontFamily(headerType.fontFamily, fonts)), footerFont = await getFont(documentPdfFontFamily(footerType.fontFamily, fonts));
  const richCache = new Map<string, { page: PDFEmbeddedPage; links: Array<{ rect: number[]; href: string }> }>();
  const richBand = async (html: string, width: number, height: number, type: typeof headerType) => {
    const key = JSON.stringify([html, width, height, type]); if (richCache.has(key)) return richCache.get(key)!;
    if (height < 8) throw new Error("Increase the page margin to fit rich header or footer content.");
    const engine = await engineForRich();
    const richBytes = await engine.renderDocument(createElement(Document, { fonts }, createElement(Page, { size: { width, height }, margin: 0 }, createElement(DocumentRichPdf, { html, width, style: { ...type, fontFamily: documentPdfFontFamily(type.fontFamily, fonts) } }))));
    const parsed = await PDFDocument.load(richBytes);
    if (parsed.getPageCount() !== 1) throw new Error("Rich header or footer content does not fit. Increase its page margin or shorten the fragment.");
    const links: Array<{ rect: number[]; href: string }> = [];
    for (const reference of parsed.getPage(0).node.Annots()?.asArray() || []) {
      const annotation = parsed.context.lookup(reference, PDFDict), action = annotation.lookupMaybe(PDFName.of("A"), PDFDict), uri = action?.lookupMaybe(PDFName.of("URI"), PDFString, PDFHexString), rectangle = annotation.lookupMaybe(PDFName.of("Rect"), PDFArray);
      if (uri && rectangle?.size() === 4) links.push({ href: cleanDocumentLink(uri.decodeText()), rect: rectangle.asArray().map((value) => (value as PDFNumber).asNumber()) });
    }
    const [embedded] = await pdf.embedPdf(parsed, [0]), result = { page: embedded, links }; richCache.set(key, result); return result;
  };
  const drawRichBand = (page: PDFPage, band: { page: PDFEmbeddedPage; links: Array<{ rect: number[]; href: string }> }, x: number, y: number, width: number, height: number) => {
    page.drawPage(band.page, { x, y, width, height });
    for (const link of band.links) { const reference = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x + link.rect[0], y + link.rect[1], x + link.rect[2], y + link.rect[3]], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(link.href) } })); page.node.addAnnot(reference); }
  };
  const pages = pdf.getPages();
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index], { width, height } = page.getSize(), margin = design.page.margins, contentWidth = width - margin.left - margin.right;
    const header = index === 0 ? design.header.text : design.header.repeat ? design.header.continuationText || design.header.text : "";
    const footer = index === 0 ? design.footer.text : design.footer.repeat ? design.footer.continuationText || design.footer.text : "";
    const headerHtml = index === 0 ? advanced.rich.headerHtml : design.header.repeat ? advanced.rich.continuationHeaderHtml || advanced.rich.headerHtml : "";
    const footerHtml = index === 0 ? advanced.rich.footerHtml : design.footer.repeat ? advanced.rich.continuationFooterHtml || advanced.rich.footerHtml : "";
    const band = (text: string, font: PDFFont, requested: number, availableHeight: number, label: string) => {
      let size = requested, lines = wrapText(text, font, size, contentWidth);
      while (size > 6 && lines.length * size * 1.2 > availableHeight) { size = Math.max(6, size - 0.5); lines = wrapText(text, font, size, contentWidth); }
      if (text && lines.length * size * 1.2 > availableHeight) throw new Error(`${label} text does not fit the page margin. Increase the ${label.toLowerCase()} margin or shorten the text.`);
      return { size, lines, height: text ? lines.length * size * 1.2 : 0 };
    };
    const headerSpace = margin.top - 10, footerSpace = margin.bottom - 10 - (design.footer.pageNumbers ? footerType.fontSize * 1.5 : 0);
    const head = band(header, headerFont, headerType.fontSize, headerHtml ? headerSpace / 2 : headerSpace, "Header");
    const foot = band(footer, footerFont, footerType.fontSize, footerHtml ? footerSpace / 2 : footerSpace, "Footer");
    head.lines.forEach((line, row) => { if (header) page.drawText(line, { x: margin.left, y: height - 5 - head.size - row * head.size * 1.2, size: head.size, font: headerFont, color: color(headerType.color) }); });
    foot.lines.forEach((line, row) => { if (footer) page.drawText(line, { x: margin.left, y: margin.bottom - 5 - foot.size - row * foot.size * 1.2, size: foot.size, font: footerFont, color: color(footerType.color) }); });
    if (headerHtml) { const available = headerSpace - head.height - (header ? 3 : 0), embedded = await richBand(headerHtml, contentWidth, available, headerType); drawRichBand(page, embedded, margin.left, height - 5 - head.height - (header ? 3 : 0) - available, contentWidth, available); }
    if (footerHtml) { const available = footerSpace - foot.height - (footer ? 3 : 0), embedded = await richBand(footerHtml, contentWidth, available, footerType); drawRichBand(page, embedded, margin.left, margin.bottom - 5 - foot.height - (footer ? 3 : 0) - available, contentWidth, available); }
    if (design.footer.pageNumbers) {
      const text = design.footer.pageNumberFormat === "page_of_total" ? `Page ${index + 1} of ${pages.length}` : String(index + 1), size = Math.min(footerType.fontSize, Math.max(6, margin.bottom / 3)), setting = advanced.page.pageNumber;
      const textWidth = footerFont.widthOfTextAtSize(text, size), x = setting.position === "custom" ? setting.x : setting.alignment === "left" ? margin.left : setting.alignment === "center" ? (width - textWidth) / 2 : width - margin.right - textWidth, y = setting.position === "custom" ? setting.y : 5;
      if (x + textWidth > width || y + size > height) throw new Error("The custom page-number position is outside the page.");
      page.drawText(text, { x, y, size, font: footerFont, color: color(footerType.color) });
    }
    if (advanced.paymentStub.enabled && paymentStub && paymentStub.height > 0 && (index === 0 || !advanced.paymentStub.firstPageOnly)) {
      const type = advanced.typography.payment, font = await getFont(documentPdfFontFamily(type.fontFamily, fonts)), size = type.fontSize, top = margin.bottom + paymentStub.height - 8;
      const texts = [advanced.labels.paymentStub, `${paymentStub.number} · ${paymentStub.customer}`, `${paymentStub.totalLabel || design.labels.total}: ${paymentStub.total}${paymentStub.showBalance === false ? "" : ` · ${paymentStub.balanceLabel || (paymentStub.balance.startsWith("-") ? "Credit balance" : design.labels.balance)}: ${paymentStub.balance}`}`, advanced.paymentStub.instructions];
      page.drawLine({ start: { x: margin.left, y: top + 5 }, end: { x: width - margin.right, y: top + 5 }, thickness: 0.5, color: color(advanced.colors.border), dashArray: [3, 3] });
      let offset = 0;
      texts.forEach((value) => wrapText(value, font, size, contentWidth).forEach((line) => { page.drawText(line, { x: margin.left, y: top - size - offset, size, font, color: color(type.color) }); offset += size * 1.3; }));
    }
  }
  if (content && pages.length) {
    const page = pages[0], size = page.getSize(), { invoice, organization } = content;
    const drawLines = async (lines: Array<{ value: string; type: typeof headerType }>, x: number, top: number, width: number) => {
      if (x < 0 || top < 0 || x + width > size.width || top >= size.height) throw new Error("An absolute document block is outside the page. Adjust its X, Y or width.");
      let offset = 0;
      for (const line of lines) {
        const font = await getFont(documentPdfFontFamily(line.type.fontFamily, fonts));
        for (const value of wrapText(line.value, font, line.type.fontSize, width)) { const y = size.height - top - offset - line.type.fontSize; if (y < 0) throw new Error("The positioned document block extends below the page."); page.drawText(value, { x, y, font, size: line.type.fontSize, color: color(line.type.color) }); offset += line.type.fontSize * 1.3; }
      }
    };
    for (const key of ["organization", "billing", "shipping"] as const) {
      const setting = advanced.addresses[key]; if (content.suppressCustomerBlocks && key !== "organization") continue; if (setting.placement !== "absolute" || key === "organization" && !design.fields.organization || key === "shipping" && !design.fields.shipTo) continue;
      const org = key === "organization";
      const source = org ? { name: advanced.visibility.organizationName ? organization.name || "Your organization" : "", address: advanced.visibility.organizationAddress ? organization.address : "", email: advanced.visibility.organizationAddress ? organization.email : "", registrationNumber: advanced.visibility.organizationAddress ? organization.registrationNumber : "", taxNumber: organization.gstNumber } : key === "billing" ? { name: invoice.billToName, address: invoice.billToAddress, email: design.fields.customerEmail ? invoice.billToEmail : "" } : { name: invoice.shipToName, address: invoice.shipToAddress };
      const lines = documentAddressLines(setting, source).split("\n").map((value) => ({ value, type: advanced.typography[value.includes(source.name || "\u0000") ? org ? "organizationName" : "customerName" : org ? "organizationAddress" : "customerAddress"] }));
      if (!org && (key !== "billing" || advanced.visibility.billTo)) lines.unshift({ value: key === "billing" ? design.labels.billTo : design.labels.shipTo, type: advanced.typography.labels });
      await drawLines(lines, setting.x, setting.y, setting.width);
    }
    for (const receiver of [false, true]) {
      const setting = receiver ? advanced.receiverSignature : advanced.signature;
      if (setting.placement !== "absolute" || (receiver ? !advanced.receiverSignature.enabled : !design.signature.enabled)) continue;
      if (setting.x + setting.width > size.width || setting.y + setting.height > size.height) throw new Error("The signature image position is outside the page.");
      if (setting.image) { const image = /^data:image\/png/i.test(setting.image) ? await pdf.embedPng(imageBytes(setting.image)) : await pdf.embedJpg(imageBytes(setting.image)); page.drawImage(image, { x: setting.x, y: size.height - setting.y - setting.height, width: setting.width, height: setting.height }); }
      const top = setting.y + (setting.image ? setting.height : 20), type = advanced.typography.signature;
      page.drawLine({ start: { x: setting.x, y: size.height - top - 4 }, end: { x: setting.x + setting.width, y: size.height - top - 4 }, thickness: 0.5, color: color(advanced.colors.border) });
      await drawLines([{ value: receiver ? advanced.receiverSignature.name : design.signature.name, type }, { value: receiver ? advanced.receiverSignature.label : design.signature.label, type }], setting.x, top + 6, setting.width);
    }
    if (advanced.visibility.statusStamp && (invoice.documentKind || "invoice") === "invoice" && invoice.status) {
      let positions = layout;
      if (!positions) { const engine = await engineForRich(), { InvoicePdfDocument } = await import("./InvoicePdfDocument"); positions = (await engine.renderDocumentWithLayout(createElement(InvoicePdfDocument, { invoice, organization, fonts }))).layout; }
      const find = (nodes: ElementInfo[], parent?: ElementInfo): ElementInfo | undefined => { for (const node of nodes) { if ((node as ElementInfo & { bookmark?: string }).bookmark === "Societyer status stamp") return parent || node; const found = find(node.children || [], node); if (found) return found; } };
      for (const [index, info] of positions.pages.entries()) {
        const anchor = find(info.elements); if (!anchor || !pages[index]) continue;
        const target = pages[index], text = advanced.stamp.text || invoice.status.toUpperCase(), type = design.typography.body, font = await getFont(documentPdfFontFamily(type.fontFamily, fonts));
        const radians = advanced.stamp.rotation * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians), width = Math.max(anchor.width, font.widthOfTextAtSize(text, type.fontSize) + 14), height = Math.max(anchor.height, type.fontSize + 12);
        const extentX = (Math.abs(width * cosine) + Math.abs(height * sine)) / 2, extentY = (Math.abs(width * sine) + Math.abs(height * cosine)) / 2;
        const x = Math.min(target.getWidth() - extentX - 2, Math.max(extentX + 2, anchor.x + width / 2)), y = Math.min(target.getHeight() - extentY - 2, Math.max(extentY + 2, target.getHeight() - anchor.y - height / 2));
        target.pushOperators(pushGraphicsState(), concatTransformationMatrix(cosine, sine, -sine, cosine, x, y));
        target.drawRectangle({ x: -width / 2, y: -height / 2, width, height, borderWidth: 1, borderColor: color(advanced.stamp.color) });
        target.drawText(text, { x: -font.widthOfTextAtSize(text, type.fontSize) / 2, y: -type.fontSize / 3, font, size: type.fontSize, color: color(advanced.stamp.color) });
        target.pushOperators(popGraphicsState());
      }
      pdf.catalog.delete(PDFName.of("Outlines"));
    }
  }
  return pdf.save();
}
