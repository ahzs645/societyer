// Web-only vector conversion; native Electron PDF printing does not load this renderer.
import {
  PDFDocument,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { normalizeLegacyFontGlyphs } from "./documentGlyphText";
import fontkit from "@pdf-lib/fontkit";
import regularFontUrl from "../assets/pdf-fonts/NotoSerif-Regular.ttf?url";
import boldFontUrl from "../assets/pdf-fonts/NotoSerif-Bold.ttf?url";
import italicFontUrl from "../assets/pdf-fonts/NotoSerif-Italic.ttf?url";
import boldItalicFontUrl from "../assets/pdf-fonts/NotoSerif-BoldItalic.ttf?url";
import mathFontUrl from "../assets/pdf-fonts/NotoSansMath-Regular.ttf?url";
import symbolsFontUrl from "../assets/pdf-fonts/NotoSansSymbols2-Regular.ttf?url";
import { PAGE_WIDTH_PX } from "./docxPreview";
import { fetchDocumentDownload } from "./documentDownload";

const PDF_LETTER_WIDTH_PT = 612;
const PDF_LETTER_HEIGHT_PT = 792;

type PdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  symbols: PDFFont;
  math: PDFFont;
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

// Old Word Symbol/Wingdings runs encode visual bullets in private-use slots.
// Keep the real Unicode source letters; map only those legacy font glyphs.
function pdfSafeText(text: string): string {
  return normalizeLegacyFontGlyphs(text)
    .replace(/[\u200b-\u200d\ufeff]/g, "").replace(/[\t\r\n]/g, " ");
}

let fontBytes: Promise<Uint8Array[]> | undefined;
async function embedDocumentFonts(pdf: PDFDocument): Promise<PdfFonts> {
  fontBytes ??= Promise.all([regularFontUrl, boldFontUrl, italicFontUrl, boldItalicFontUrl, symbolsFontUrl, mathFontUrl]
    .map(async url => {
      const response = await fetchDocumentDownload(url);
      if (!response.ok) throw new Error("PDF fonts could not be loaded. Please try again.");
      return new Uint8Array(await response.arrayBuffer());
    })).catch(error => { fontBytes = undefined; throw error; });
  pdf.registerFontkit(fontkit);
  const embedded = await Promise.all((await fontBytes).map(bytes => pdf.embedFont(bytes, { subset: true })));
  return { regular: embedded[0], bold: embedded[1], italic: embedded[2], boldItalic: embedded[3], symbols: embedded[4], math: embedded[5] };
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

  const supported = new Set(font.getCharacterSet());
  const symbols = new Set(fonts.symbols.getCharacterSet());
  const math = new Set(fonts.math.getCharacterSet());
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
    const runs: Array<{ text: string; font: PDFFont }> = [];
    for (const char of safe) {
      const code = char.codePointAt(0)!;
      const selected = supported.has(code) ? font : symbols.has(code) ? fonts.symbols : math.has(code) ? fonts.math : undefined;
      if (!selected) throw new Error(`PDF font does not contain source character U+${code.toString(16).toUpperCase()}. Use Print or download the original source.`);
      const previous = runs[runs.length - 1];
      if (previous?.font === selected) previous.text += char;
      else runs.push({ text: char, font: selected });
    }
    const width = runs.reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, fontSize), 0);
    // Embedded Unicode fonts can have different advances from the browser's
    // preview font. Fit their searchable glyphs to the measured line, keeping
    // right-edge text and adjacent inline runs inside the same layout boxes.
    const horizontalScale = width > 0 ? box.width / width : 1;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(horizontalScale, 0, 0, 1, box.x, 0));
    let cursor = 0;
    for (const run of runs) {
      page.drawText(run.text, { x: cursor, y: box.y + fontSize * 0.18, size: fontSize, font: run.font, color });
      cursor += run.font.widthOfTextAtSize(run.text, fontSize);
    }
    page.pushOperators(popGraphicsState());
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
    return fetchDocumentDownload(src).then((response) => response.arrayBuffer());
  }
  if (/^https?:|^blob:/i.test(src)) {
    return fetchDocumentDownload(src).then((response) => response.arrayBuffer());
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

export async function renderVectorPdfFromDocxHtml(html: string): Promise<Uint8Array> {
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

    const fonts = await embedDocumentFonts(pdf);
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
