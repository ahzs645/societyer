// HTML → PDF. The PDF is produced from the *same* docx-preview rendering shown
// in the on-screen preview and downloaded as Word — not a separate re-styling
// of the source HTML — so all three outputs match.
//
// On desktop, an Electron offscreen window converts the HTML straight to a
// PDF file with Chromium's printToPDF. On web, ordinary page JavaScript cannot
// retrieve the browser print engine's PDF bytes, so direct PDF download uses a
// constrained vector renderer for docx-preview's paginated DOM. A separate
// print action still opens the browser print dialog.

import { escapeHtml } from "./html";
import { buildWordDocxBlob } from "./docx";
import { PAGE_WIDTH_PX, renderDocxToPaginatedHtml, PRINT_PAGE_CSS } from "./docxPreview";
import { getDesktopBridge } from "./desktopBridge";
import { ensureExtension, triggerBlobDownload } from "./zip";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

// Fallback styling, used only when the docx-preview render fails. Mirrors the
// docx export's look closely enough that a failed render still yields a usable
// PDF rather than nothing.
export const DOCUMENT_CSS = `
  body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #1a1a1a; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #999; padding-bottom: 2pt; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 6pt; line-height: 1.35; }
  ul, ol { margin: 0 0 8pt 24pt; padding: 0; }
  li { margin: 0 0 2pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; }
  th, td { border: 1px solid #bbb; padding: 4pt 6pt; font-size: 10.5pt; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; }
  .motion { border-left: 3pt solid #3b5bdb; padding: 4pt 8pt; background: #f6f8ff; margin: 0 0 8pt; }
  .motion .outcome-carried,
  .outcome-carried { color: #0a8f4e; font-weight: 600; }
  .motion .outcome-defeated,
  .outcome-defeated { color: #c9264a; font-weight: 600; }
  .motion .outcome-tabled,
  .outcome-tabled { color: #a86400; font-weight: 600; }
  .meta { color: #666; font-size: 10pt; }
  .muted { color: #888; }
  @page { size: letter; margin: 0.65in; }
`;

// Layered on top of DOCUMENT_CSS only in the fallback print pipeline. Headings
// stay with the content that follows; motion blocks, table rows, and list items
// don't split across pages; long tables keep flowing but repeat their header.
export const PRINT_CSS = `
  @media print {
    body { margin: 0; }
    h1, h2, h3, h4 { page-break-after: avoid; break-after: avoid; }
    h1, h2, h3, h4, .motion, tr, li { page-break-inside: avoid; break-inside: avoid; }
    table { page-break-inside: auto; }
    thead { display: table-header-group; }
    a { color: inherit; text-decoration: underline; }
  }
`;

// Build the print document from the docx-preview rendering: docx-preview's own
// styles + the paginated `.docx-wrapper`, then our print overrides (after the
// content so they win the cascade). This is the same layout as the preview.
async function buildDocxPrintHtml({ title, bodyHtml }: { title: string; bodyHtml: string }): Promise<string> {
  const blob = await buildWordDocxBlob({ bodyHtml });
  const rendered = await renderDocxToPaginatedHtml(blob);
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head><body>${rendered}<style>${PRINT_PAGE_CSS}</style></body></html>`;
}

function buildHtmlFallbackDocument({ title, bodyHtml }: { title: string; bodyHtml: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>${DOCUMENT_CSS}${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

const PDF_LETTER_WIDTH_PT = 612;
const PDF_LETTER_HEIGHT_PT = 792;

type PdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
};

type PdfColor = ReturnType<typeof rgb>;

type PageGeometry = {
  rect: DOMRect;
  widthPt: number;
  heightPt: number;
  scaleX: number;
  scaleY: number;
};

function cssNumber(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function cssLengthToPt(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const amount = Number.parseFloat(trimmed);
  if (!Number.isFinite(amount)) return null;
  if (trimmed.endsWith("pt")) return amount;
  if (trimmed.endsWith("in")) return amount * 72;
  if (trimmed.endsWith("cm")) return amount * 28.3464567;
  if (trimmed.endsWith("mm")) return amount * 2.83464567;
  // CSS px are 96dpi; PDF points are 72dpi.
  return amount * 0.75;
}

function pdfColorFromCss(value: string): PdfColor | null {
  const color = value.trim().toLowerCase();
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return null;
  const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((part) => part.trim());
    const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
    if (alpha === 0) return null;
    const [red, green, blue] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
    if ([red, green, blue].every(Number.isFinite)) {
      return rgb(red / 255, green / 255, blue / 255);
    }
  }
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split("").map((part) => part + part).join("")
      : hex[1];
    return rgb(
      Number.parseInt(raw.slice(0, 2), 16) / 255,
      Number.parseInt(raw.slice(2, 4), 16) / 255,
      Number.parseInt(raw.slice(4, 6), 16) / 255,
    );
  }
  if (color === "black") return rgb(0, 0, 0);
  if (color === "white") return rgb(1, 1, 1);
  if (color === "gray" || color === "grey") return rgb(0.5, 0.5, 0.5);
  return null;
}

function rectToPdf(rect: DOMRect, geometry: PageGeometry) {
  const x = (rect.left - geometry.rect.left) * geometry.scaleX;
  const top = (rect.top - geometry.rect.top) * geometry.scaleY;
  const width = rect.width * geometry.scaleX;
  const height = rect.height * geometry.scaleY;
  return {
    x,
    y: geometry.heightPt - top - height,
    width,
    height,
  };
}

function chooseFont(style: CSSStyleDeclaration, fonts: PdfFonts): PDFFont {
  const weight = style.fontWeight === "bold" ? 700 : Number.parseInt(style.fontWeight, 10);
  const bold = Number.isFinite(weight) && weight >= 600;
  const italic = style.fontStyle === "italic" || style.fontStyle === "oblique";
  if (bold && italic) return fonts.boldItalic;
  if (bold) return fonts.bold;
  if (italic) return fonts.italic;
  return fonts.regular;
}

function pdfSafeText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\u2011/g, "-")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(
      /[^\t\n\r -~\u00a1-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/g,
      "?",
    );
}

function lineWidthPt(value: string, scale: number): number {
  const px = cssNumber(value);
  if (px <= 0) return 0;
  return Math.max(0.25, px * scale);
}

function drawElementBackgroundAndBorder(
  page: PDFPage,
  element: Element,
  geometry: PageGeometry,
) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const box = rectToPdf(rect, geometry);
  if (
    box.x > geometry.widthPt ||
    box.y > geometry.heightPt ||
    box.x + box.width < 0 ||
    box.y + box.height < 0
  ) {
    return;
  }

  const style = getComputedStyle(element);
  const background = pdfColorFromCss(style.backgroundColor);
  const isPage = element.matches("section.docx");
  if (background && (isPage || style.backgroundColor !== "rgba(0, 0, 0, 0)")) {
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      color: background,
    });
  }

  const sides = [
    {
      width: lineWidthPt(style.borderTopWidth, geometry.scaleY),
      color: pdfColorFromCss(style.borderTopColor),
      from: { x: box.x, y: box.y + box.height },
      to: { x: box.x + box.width, y: box.y + box.height },
    },
    {
      width: lineWidthPt(style.borderRightWidth, geometry.scaleX),
      color: pdfColorFromCss(style.borderRightColor),
      from: { x: box.x + box.width, y: box.y },
      to: { x: box.x + box.width, y: box.y + box.height },
    },
    {
      width: lineWidthPt(style.borderBottomWidth, geometry.scaleY),
      color: pdfColorFromCss(style.borderBottomColor),
      from: { x: box.x, y: box.y },
      to: { x: box.x + box.width, y: box.y },
    },
    {
      width: lineWidthPt(style.borderLeftWidth, geometry.scaleX),
      color: pdfColorFromCss(style.borderLeftColor),
      from: { x: box.x, y: box.y },
      to: { x: box.x, y: box.y + box.height },
    },
  ];

  for (const side of sides) {
    if (!side.color || side.width <= 0) continue;
    page.drawLine({
      start: side.from,
      end: side.to,
      thickness: side.width,
      color: side.color,
    });
  }
}

function drawTextNode(
  page: PDFPage,
  textNode: Text,
  geometry: PageGeometry,
  fonts: PdfFonts,
) {
  const rawText = textNode.nodeValue ?? "";
  if (!rawText.trim()) return;
  const parent = textNode.parentElement;
  if (!parent) return;

  const style = getComputedStyle(parent);
  const color = pdfColorFromCss(style.color) ?? rgb(0, 0, 0);
  const font = chooseFont(style, fonts);
  const fontSize = Math.max(1, cssNumber(style.fontSize) * geometry.scaleY);

  const underline = style.textDecorationLine.includes("underline");
  for (const { text, rect } of renderedTextLines(textNode)) {
    if (!text.trim()) continue;
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom < geometry.rect.top ||
      rect.top > geometry.rect.bottom
    ) {
      continue;
    }
    const box = rectToPdf(rect, geometry);
    const safe = pdfSafeText(text);
    try {
      page.drawText(safe, { x: box.x, y: box.y + fontSize * 0.18, size: fontSize, font, color });
    } catch {
      page.drawText(safe.replace(/[^\x20-\x7e]/g, "?"), { x: box.x, y: box.y + fontSize * 0.18, size: fontSize, font, color });
    }
    if (underline) {
      page.drawLine({
        start: { x: box.x, y: box.y + fontSize * 0.08 },
        end: { x: box.x + box.width, y: box.y + fontSize * 0.08 },
        thickness: Math.max(0.35, fontSize * 0.045),
        color,
      });
    }
  }
}

/**
 * Return the text laid out on each visual line of a text node, using the
 * browser's actual line breaking. A single-line node takes the fast path; a
 * wrapped node groups characters by their vertical position so each emitted line
 * is exactly what the browser rendered — no re-flow guessing (which mis-placed
 * words past the margin and dropped the space at wrap points).
 */
function renderedTextLines(textNode: Text): Array<{ text: string; rect: DOMRect }> {
  const value = textNode.nodeValue ?? "";
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const lineRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (lineRects.length <= 1) {
    range.detach();
    const rect = lineRects[0];
    // Collapse runs of whitespace but DON'T trim: a leading/trailing space is
    // significant when this node sits inline next to another (e.g. the space in
    // "<strong>Date:</strong> Thursday").
    return rect ? [{ text: value.replace(/\s+/g, " "), rect }] : [];
  }

  const TOL = 2;
  type Acc = { chars: string[]; top: number; bottom: number; left: number; right: number };
  const lines: Acc[] = [];
  let current: Acc | null = null;
  for (let i = 0; i < value.length; i += 1) {
    range.setStart(textNode, i);
    range.setEnd(textNode, i + 1);
    const r = range.getBoundingClientRect();
    const ch = value[i];
    if (r.width === 0 && r.height === 0) {
      if (current) current.chars.push(ch);
      continue;
    }
    if (!current || Math.abs(r.top - current.top) > TOL) {
      if (current) lines.push(current);
      current = { chars: [ch], top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    } else {
      current.chars.push(ch);
      current.left = Math.min(current.left, r.left);
      current.right = Math.max(current.right, r.right);
      current.bottom = Math.max(current.bottom, r.bottom);
    }
  }
  if (current) lines.push(current);
  range.detach();
  // Collapse whitespace per line but keep significant leading/trailing spaces;
  // the browser already consumed the space at each wrap point into the line it
  // ended, so wrapped continuation lines don't start with a stray space.
  return lines.map((l) => ({
    text: l.chars.join("").replace(/\s+/g, " "),
    rect: new DOMRect(l.left, l.top, l.right - l.left, l.bottom - l.top),
  }));
}

async function svgDataUrlToPngBytes(src: string): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const width = Math.max(1, image.naturalWidth || image.width || 600);
        const height = Math.max(1, image.naturalHeight || image.height || 180);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob(async (blob) => {
          resolve(blob ? await blob.arrayBuffer() : null);
        }, "image/png");
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function imageBytesFromSrc(src: string): Promise<ArrayBuffer | null> {
  if (/^data:image\/svg\+xml/i.test(src)) return svgDataUrlToPngBytes(src);
  if (src.startsWith("data:")) {
    return fetch(src).then((response) => response.arrayBuffer());
  }
  if (/^https?:|^blob:/i.test(src)) {
    return fetch(src).then((response) => response.arrayBuffer());
  }
  return null;
}

async function embedImage(
  pdf: PDFDocument,
  src: string,
  cache: Map<string, Promise<PDFImage | null>>,
): Promise<PDFImage | null> {
  let cached = cache.get(src);
  if (!cached) {
    cached = (async () => {
      try {
        const bytes = await imageBytesFromSrc(src);
        if (!bytes) return null;
        if (/^data:image\/jpe?g/i.test(src) || /\.jpe?g($|\?)/i.test(src)) {
          return await pdf.embedJpg(bytes);
        }
        return await pdf.embedPng(bytes);
      } catch {
        return null;
      }
    })();
    cache.set(src, cached);
  }
  return cached;
}

async function waitForImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    if (image.complete) return;
    if (typeof image.decode === "function") {
      await image.decode().catch(() => {});
      return;
    }
    await new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }));
}

async function renderVectorPdfFromDocxHtml(html: string): Promise<Uint8Array> {
  const container = document.createElement("div");
  container.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${PAGE_WIDTH_PX}px;visibility:hidden;pointer-events:none;`;
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    await waitForImages(container);
    await document.fonts?.ready.catch(() => undefined);

    const sections = Array.from(container.querySelectorAll<HTMLElement>(".docx-wrapper > section.docx"));
    if (sections.length === 0) throw new Error("No rendered docx pages found.");

    const pdf = await PDFDocument.create();
    pdf.setProducer("Societyer");
    pdf.setCreator("Societyer");

    const fonts: PdfFonts = {
      regular: await pdf.embedFont(StandardFonts.TimesRoman),
      bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
      italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
      boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    };
    const imageCache = new Map<string, Promise<PDFImage | null>>();

    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      const widthPt =
        cssLengthToPt(section.style.width) ??
        cssLengthToPt(getComputedStyle(section).width) ??
        PDF_LETTER_WIDTH_PT;
      const heightPt =
        cssLengthToPt(section.style.minHeight) ??
        cssLengthToPt(getComputedStyle(section).minHeight) ??
        PDF_LETTER_HEIGHT_PT;
      const page = pdf.addPage([widthPt, heightPt]);
      const geometry: PageGeometry = {
        rect,
        widthPt,
        heightPt,
        scaleX: widthPt / rect.width,
        scaleY: heightPt / rect.height,
      };

      page.drawRectangle({
        x: 0,
        y: 0,
        width: widthPt,
        height: heightPt,
        color: rgb(1, 1, 1),
      });

      const elements = [section, ...Array.from(section.querySelectorAll("*"))];
      for (const element of elements) {
        drawElementBackgroundAndBorder(page, element, geometry);
      }

      for (const image of Array.from(section.querySelectorAll("img"))) {
        const src = image.currentSrc || image.src;
        if (!src) continue;
        const embedded = await embedImage(pdf, src, imageCache);
        if (!embedded) continue;
        const box = rectToPdf(image.getBoundingClientRect(), geometry);
        page.drawImage(embedded, {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
      }

      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        drawTextNode(page, node as Text, geometry, fonts);
        node = walker.nextNode();
      }
    }

    return await pdf.save();
  } finally {
    container.remove();
  }
}

async function downloadWebVectorPdf({
  filename,
  title,
  bodyHtml,
}: {
  filename: string;
  title: string;
  bodyHtml: string;
}): Promise<void> {
  const blob = await buildWordDocxBlob({ bodyHtml });
  const rendered = await renderDocxToPaginatedHtml(blob);
  const bytes = await renderVectorPdfFromDocxHtml(rendered);
  const pdfBlob = new Blob([bytes], { type: "application/pdf" });
  triggerBlobDownload(pdfBlob, ensureExtension(filename || title || "document", "pdf"));
}

/**
 * Render an HTML document in a hidden iframe and trigger the browser's print
 * engine. The user picks "Save as PDF" from the print dialog and gets a vector,
 * text-searchable PDF.
 *
 * Resolves when the print dialog closes (or after a 60-second fallback, in case
 * `afterprint` never fires).
 */
function printHtmlDocument(html: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        iframe.contentWindow?.removeEventListener("afterprint", cleanup);
      } catch {
        // contentWindow can be detached at cleanup; ignore.
      }
      iframe.remove();
      resolve();
    };
    iframe.onload = () => {
      const cw = iframe.contentWindow;
      if (!cw) {
        cleanup();
        return;
      }
      cw.addEventListener("afterprint", cleanup);
      // Safari prints the parent window if the iframe isn't focused first.
      cw.focus();
      cw.print();
      // Fallback in case afterprint never fires (older browsers, dialog
      // dismissed instantly). 60s is well past any realistic Save-as-PDF flow.
      setTimeout(cleanup, 60_000);
    };
    iframe.srcdoc = html;
  });
}

/**
 * Export the minutes body as a PDF that matches the on-screen preview and the
 * Word download. Renders the actual .docx through docx-preview, then:
 *  - on desktop, hands the HTML to Electron to write a PDF file silently;
 *  - on the web, converts the rendered docx-preview page DOM into a vector PDF
 *    with selectable text and downloads it directly;
 *  - if either conversion path fails, falls back to the browser print dialog.
 *
 * `filename` is the suggested name. Desktop uses it for the file written to
 * Downloads; web uses it on the generated download link.
 */
export async function exportPdfDownload({
  filename,
  title,
  bodyHtml,
}: {
  filename: string;
  title: string;
  bodyHtml: string;
}): Promise<void> {
  let html: string;
  try {
    html = await buildDocxPrintHtml({ title, bodyHtml });
  } catch (error) {
    console.error("docx-based PDF render failed; falling back to HTML print", error);
    html = buildHtmlFallbackDocument({ title, bodyHtml });
  }

  const bridge = getDesktopBridge();
  if (bridge?.printToPdf) {
    try {
      await bridge.printToPdf({ html, fileName: filename });
      return;
    } catch (error) {
      // Desktop conversion failed (e.g. write error) — fall through to the
      // browser print dialog so the user still gets their PDF.
      console.error("Desktop printToPdf failed; falling back to browser print", error);
    }
  }

  try {
    await downloadWebVectorPdf({ filename, title, bodyHtml });
    return;
  } catch (error) {
    console.error("Web vector PDF export failed; falling back to browser print", error);
    return printHtmlDocument(html);
  }
}

/**
 * Open the browser print flow for the same paginated minutes document used by
 * the Word/PDF exports. This is intentionally separate from direct PDF
 * download so web users can choose between saving a PDF file and printing.
 */
export async function printPdfDocument({
  title,
  bodyHtml,
}: {
  title: string;
  bodyHtml: string;
}): Promise<void> {
  let html: string;
  try {
    html = await buildDocxPrintHtml({ title, bodyHtml });
  } catch (error) {
    console.error("docx-based print render failed; falling back to HTML print", error);
    html = buildHtmlFallbackDocument({ title, bodyHtml });
  }
  return printHtmlDocument(html);
}
