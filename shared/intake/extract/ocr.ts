/** OCR stage for scanned PDF pages and document images (runtime-neutral).
 *
 * Hosts inject the engine (tesseract.js in the browser worker and the CLI, or the
 * system `tesseract` binary) and the rasterizer (OffscreenCanvas in the worker,
 * @napi-rs/canvas in Node). Everything runs locally: no page leaves the device.
 *
 * Recognised words are turned into positioned text items in PDF points, so the
 * same layout code that rebuilds lines, columns (TAB-separated), tables and
 * paragraphs from a PDF text layer also lays out OCR text. Every block keeps
 * its OCR confidence; `applyOcrConfidence` lowers the confidence of a field
 * whose quote sits on a low-confidence page or relies on an uncertain word, so
 * such fields are never bulk-accepted. */
import type { IntakeBlock, IntakeExtract, IntakeOcrLine, IntakeOcrPage, IntakeOcrSummary } from "../blocks";
import type { FieldValue } from "../schemas/common";

export type OcrBox = { x0: number; y0: number; x1: number; y1: number };
/** confidence 0–100 as engines report it; `line` groups words of one text line. */
export type OcrWord = { text: string; confidence: number; bbox: OcrBox; line: number };
export type OcrRecognition = { words: OcrWord[]; width: number; height: number };
/** An encoded raster (PNG/JPEG/…) the engine reads, with its pixel size. */
export type OcrImage = { bytes: Uint8Array; width: number; height: number; mime?: string };
export interface OcrEngine {
  /** e.g. "tesseract.js 7.0.0 (eng, LSTM)" or "tesseract 5.3.4 (system)". */
  readonly name: string;
  recognize(image: OcrImage): Promise<OcrRecognition>;
  terminate?(): Promise<void>;
}

/** A per-run page allowance shared by every file (OCR is the slow stage). */
export class OcrPageBudget {
  used = 0;
  constructor(public readonly limit: number) {}
  take(): boolean {
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
  get exhausted() {
    return this.used >= this.limit;
  }
}

export type OcrHost = {
  engine: OcrEngine;
  /** Renders a pdf.js page (PDFPageProxy) to an image at `scale` with `rotation` (degrees, clockwise, absolute). */
  renderPdfPage(page: unknown, options: { scale: number; rotation: number }): Promise<OcrImage>;
  /** Decodes an image file, rotated clockwise by `rotation`, downscaled to at most `maxPixels`; null when the format cannot be read here. */
  decodeImage?(bytes: Uint8Array, fileName: string, options: { rotation: number; maxPixels: number }): Promise<OcrImage | null>;
  budget?: OcrPageBudget;
  /** Rendering resolution for PDF pages (default 300). */
  dpi?: number;
  /** Upper bound on rendered pixels per page (default 20 M). */
  maxPixels?: number;
  /** pdf.js `wasmUrl` (JBIG2 / JPEG 2000 decoders, common in scans). */
  pdfjsWasmUrl?: string;
  /** Extra pdf.js getDocument parameters for rendering (e.g. an OffscreenCanvas factory in a worker). */
  pdfjsDocumentOptions?: Record<string, unknown>;
  /** Keep line boxes and per-word confidences in the extract (default true). */
  keepLineBoxes?: boolean;
};

/** The same host, calling `onActivity` as each page is rendered or recognised (a per-file
 * progress signal: the pipeline's extract deadline restarts on it). Budget and engine stay shared. */
export function withOcrActivity(host: OcrHost, onActivity: () => void): OcrHost {
  const engine = host.engine;
  const touch = <T>(value: T): T => { onActivity(); return value; };
  return {
    ...host,
    engine: { name: engine.name, recognize: async (image) => { onActivity(); return touch(await engine.recognize(image)); } },
    renderPdfPage: async (page, options) => { onActivity(); return touch(await host.renderPdfPage(page, options)); },
    ...(host.decodeImage ? { decodeImage: async (bytes: Uint8Array, fileName: string, options: { rotation: number; maxPixels: number }) => touch(await host.decodeImage!(bytes, fileName, options)) } : {}),
  };
}

export const OCR_LOW_WORD_CONFIDENCE = 60;
const MIN_PROBE_WORDS = 8;

/** Words that look like text in the language (3+ letters) recognised with confidence. */
export function recognitionQuality(recognition: OcrRecognition): { meanConfidence: number; words: number; goodWords: number; score: number } {
  const words = recognition.words.filter((word) => word.text.trim());
  let weighted = 0;
  let chars = 0;
  let goodWords = 0;
  let score = 0;
  for (const word of words) {
    const length = word.text.trim().length;
    weighted += word.confidence * length;
    chars += length;
    if (/[A-Za-z]{3,}/.test(word.text) && word.confidence >= 70) {
      goodWords += 1;
      score += word.confidence;
    }
  }
  return { meanConfidence: chars ? weighted / chars : 0, words: words.length, goodWords, score };
}

/** Scanner specks and ruled-line fragments come back as stray marks ("|", ":", "oo", "Co")
 * with low confidence, usually far from any real word. Those are dropped: punctuation-only
 * marks that stand alone (or were read below 50%), and one- or two-letter marks read below 40%
 * that stand alone. Item numbers ("1.", "3") always stay; a smeared prefix ("--Avery") is cut. */
export function cleanRecognition(recognition: OcrRecognition): OcrRecognition {
  const byLine = new Map<number, OcrWord[]>();
  for (const word of recognition.words) byLine.set(word.line, [...(byLine.get(word.line) ?? []), word]);
  const kept: OcrWord[] = [];
  for (const words of byLine.values()) {
    const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const height = median(sorted.map((word) => word.bbox.y1 - word.bbox.y0)) || 10;
    sorted.forEach((word, index) => {
      const text = word.text.trim();
      if (!text) return;
      const left = index > 0 ? word.bbox.x0 - sorted[index - 1].bbox.x1 : Infinity;
      const right = index < sorted.length - 1 ? sorted[index + 1].bbox.x0 - word.bbox.x1 : Infinity;
      const isolated = left > height * 1.5 && right > height * 1.5;
      const symbolic = !/[\p{L}\p{N}]/u.test(text);
      if (symbolic && (isolated || word.confidence < 50)) return;
      if (text.length <= 2 && word.confidence < 40 && isolated && !/^\d+[.)]?$/.test(text)) return;
      const smeared = word.confidence < 50 ? /^[-~_=|]{2,}(?=[\p{L}\p{N}])/u.exec(text) : null;
      kept.push(smeared ? { ...word, text: text.slice(smeared[0].length) } : word);
    });
  }
  return { ...recognition, words: kept };
}

/** Recognises a page upright. A page read at 0° with many low-confidence words is probed at
 * 90°, 270° and 180° (at reduced resolution when the host can render it) and re-read at the
 * rotation whose words look most like text. */
export async function recognizeUpright(engine: OcrEngine, render: (rotation: number, probe: boolean) => Promise<OcrImage>): Promise<{ recognition: OcrRecognition; rotation: 0 | 90 | 180 | 270; image: OcrImage }> {
  const image = await render(0, false);
  const recognition = cleanRecognition(await engine.recognize(image));
  const quality = recognitionQuality(recognition);
  const upright = quality.words < MIN_PROBE_WORDS || (quality.meanConfidence >= 70 && quality.goodWords >= quality.words * 0.4);
  if (upright) return { recognition, rotation: 0, image };
  let best: { rotation: 0 | 90 | 180 | 270; score: number } = { rotation: 0, score: quality.score };
  // At probe resolution the upright score is re-measured so the comparison is like for like.
  const baseline = await render(0, true).then(async (probe) => (probe === image ? quality.score : recognitionQuality(await engine.recognize(probe)).score));
  best.score = baseline;
  for (const rotation of [90, 270, 180] as const) {
    const probe = await render(rotation, true);
    const score = recognitionQuality(await engine.recognize(probe)).score;
    if (score > best.score * 1.5 + 50) best = { rotation, score };
  }
  if (best.rotation === 0) return { recognition, rotation: 0, image };
  const rotated = await render(best.rotation, false);
  return { recognition: cleanRecognition(await engine.recognize(rotated)), rotation: best.rotation, image: rotated };
}

/** Positioned text item in PDF points (y up, as pdf.js reports a text layer) with word confidence. */
export type OcrTextItem = { str: string; x: number; y: number; w: number; h: number; conf: number };

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** OCR words → text items. Words of one recognised line share its baseline, so the PDF line
 * builder keeps them on one line even on a slightly skewed scan; `pixelsPerPoint` converts
 * the raster back to page points (dpi / 72). */
export function itemsFromRecognition(recognition: OcrRecognition, pixelsPerPoint: number): OcrTextItem[] {
  const byLine = new Map<number, OcrWord[]>();
  for (const word of recognition.words) {
    if (!word.text.trim()) continue;
    const list = byLine.get(word.line) ?? [];
    list.push(word);
    byLine.set(word.line, list);
  }
  const pageHeight = recognition.height / pixelsPerPoint;
  const items: OcrTextItem[] = [];
  for (const words of byLine.values()) {
    const baseline = median(words.map((word) => word.bbox.y1));
    // The line box (ascenders to descenders) approximates the font size a text layer reports;
    // single word boxes are smaller ("on", "a"), which would make every line gap look like a paragraph break.
    const lineHeight = Math.max(...words.map((word) => word.bbox.y1)) - Math.min(...words.map((word) => word.bbox.y0));
    const height = Math.max(4, Math.min(lineHeight, median(words.map((word) => word.bbox.y1 - word.bbox.y0)) * 2) / pixelsPerPoint);
    for (const word of words) {
      items.push({
        str: word.text.trim(),
        x: word.bbox.x0 / pixelsPerPoint,
        y: pageHeight - baseline / pixelsPerPoint,
        w: Math.max(1, (word.bbox.x1 - word.bbox.x0) / pixelsPerPoint),
        h: height,
        conf: word.confidence,
      });
    }
  }
  return items;
}

/** Page summary with line boxes (points, top-left origin) and per-word confidences. */
export function ocrPageSummary(recognition: OcrRecognition, options: { page: number; rotation: 0 | 90 | 180 | 270; dpi: number; keepLines?: boolean }): IntakeOcrPage {
  const pixelsPerPoint = options.dpi / 72;
  const point = (value: number) => Math.round((value / pixelsPerPoint) * 10) / 10;
  const quality = recognitionQuality(recognition);
  const lines: IntakeOcrLine[] = [];
  if (options.keepLines !== false) {
    const byLine = new Map<number, OcrWord[]>();
    for (const word of recognition.words) if (word.text.trim()) byLine.set(word.line, [...(byLine.get(word.line) ?? []), word]);
    for (const words of byLine.values()) {
      const confidence = words.reduce((sum, word) => sum + word.confidence, 0) / words.length / 100;
      lines.push({
        text: words.map((word) => word.text.trim()).join(" "),
        confidence: Math.round(confidence * 1000) / 1000,
        bbox: [point(Math.min(...words.map((word) => word.bbox.x0))), point(Math.min(...words.map((word) => word.bbox.y0))), point(Math.max(...words.map((word) => word.bbox.x1))), point(Math.max(...words.map((word) => word.bbox.y1)))],
        words: words.map((word) => [word.text.trim(), Math.round(word.confidence), point(word.bbox.x0), point(word.bbox.y0), point(word.bbox.x1), point(word.bbox.y1)]),
      });
    }
  }
  return {
    page: options.page,
    confidence: Math.round(quality.meanConfidence * 10) / 1000,
    rotation: options.rotation,
    dpi: options.dpi,
    words: quality.words,
    lowConfidenceWords: recognition.words.filter((word) => word.text.trim() && word.confidence < OCR_LOW_WORD_CONFIDENCE).length,
    width: point(recognition.width),
    height: point(recognition.height),
    ...(options.keepLines !== false ? { lines } : {}),
  };
}

/** The OCR summary a workspace row keeps: page confidences and rotations, without line boxes
 * (the run output and the extract blocks keep the text; boxes are only needed by the CLI output). */
export function compactOcrSummary(summary: IntakeOcrSummary): IntakeOcrSummary {
  return { ...summary, pages: summary.pages.map(({ lines: _lines, ...page }) => page) };
}

/** Block-level OCR confidence from the items it was built from. */
export function ocrBlockStats(items: Array<{ str: string; conf?: number }>): IntakeBlock["ocr"] | undefined {
  const read = items.filter((item) => item.conf !== undefined && item.str.trim());
  if (!read.length) return undefined;
  let weighted = 0;
  let chars = 0;
  const low = new Set<string>();
  for (const item of read) {
    const length = item.str.trim().length;
    weighted += item.conf! * length;
    chars += length;
    if (item.conf! < OCR_LOW_WORD_CONFIDENCE && /[\p{L}\p{N}]/u.test(item.str)) low.add(item.str.trim());
  }
  const lowWords = [...low].slice(0, 200);
  return { confidence: Math.round((weighted / chars) * 10) / 1000, ...(lowWords.length ? { lowWords } : {}) };
}

export { OCR_IMAGE_EXTENSIONS } from "./extensions";

const DOCUMENT_IMAGE_NAME = /\b(?:scan(?:ned)?|signed|signature|certificate|cert|letter|form|receipt|invoice|minutes|agenda|consent|proxy|bylaws?|constitution|resolution|notice|filing|registry|agreement|contract|statement|cheque|page\s*\d+|p\d+|doc(?:ument)?|fax)\b|\b(?:scan|doc)[_ -]?\d{3,}\b/i;
const PHOTO_NAME = /\b(?:photo|pic|picture|logo|banner|poster|flyer|graphic|icon|selfie|event|workshop|group|team|screenshot|facebook|instagram|twitter|header|background|map)\b|^(?:dsc|dscn|dji|gopr|p\d{7}|pxl|mvimg)[_ -]?\d+/i;

/** True for an image whose name or folder says it is a document (a scanned letter, a signed form,
 * a certificate), as opposed to a photo, logo or graphic. Undecided names are not OCR'd. */
export function isDocumentImage(name: string, path?: string): boolean {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ");
  const folder = (path ?? "").replace(/[^/\\]*$/, "").replace(/[_]+/g, " ");
  if (PHOTO_NAME.test(base)) return false;
  if (DOCUMENT_IMAGE_NAME.test(base)) return true;
  return /\b(?:scans?|scanned|signed|forms?|certificates?|letters?|correspondence|consents?|proxies|minutes|receipts|invoices|filings?|annual society records|director and proxy forms)\b/i.test(folder) && !/\b(?:photos?|pictures|graphics|images|logos?|facebook|outreach|media)\b/i.test(folder);
}

/** An OCR'd image with fewer words than this (or a lower mean confidence) is a photo, not a document. */
export const MIN_DOCUMENT_IMAGE_WORDS = 12;
export const MIN_DOCUMENT_IMAGE_CONFIDENCE = 0.45;

/** Field confidence after OCR: a value quoted from a low-confidence page, or whose quote contains
 * a word read below 0.6, is capped under every bulk-accept threshold (a person must look at it);
 * good OCR lowers confidence slightly. Returns how many fields were lowered. */
export function applyOcrConfidence(record: unknown, extract: Pick<IntakeExtract, "blocks">): number {
  if (!extract.blocks.some((block) => block.ocr)) return 0;
  let lowered = 0;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const field = node as FieldValue<unknown>;
    if ("status" in field && "locators" in field && Array.isArray(field.locators) && typeof field.confidence === "number") {
      let cap = 1;
      let factor = 1;
      let reason: string | undefined;
      for (const locator of field.locators) {
        const block = locator.blockIndex !== undefined ? extract.blocks[locator.blockIndex] : extract.blocks.find((candidate) => locator.charStart !== undefined && candidate.charStart <= locator.charStart && locator.charStart < candidate.charEnd);
        if (!block?.ocr) continue;
        const quoteWords = new Set((locator.quote ?? "").split(/\s+/).map((word) => word.trim()).filter(Boolean));
        const uncertain = (block.ocr.lowWords ?? []).filter((word) => quoteWords.has(word));
        if (uncertain.length) {
          cap = Math.min(cap, 0.5);
          reason = `OCR read ${uncertain.slice(0, 3).map((word) => `"${word}"`).join(", ")} with low confidence; check the scan.`;
        } else if (block.ocr.confidence < 0.75) {
          cap = Math.min(cap, 0.6);
          reason ??= `Read by OCR from a low-confidence page (${Math.round(block.ocr.confidence * 100)}%); check the scan.`;
        } else {
          factor = Math.min(factor, Math.min(1, 0.55 + block.ocr.confidence / 2));
          reason ??= `Read by OCR (${Math.round(block.ocr.confidence * 100)}% confidence).`;
        }
      }
      if (reason) {
        const next = Math.round(Math.min(cap, field.confidence * factor) * 1000) / 1000;
        if (next < field.confidence) lowered += 1;
        field.confidence = Math.min(field.confidence, next);
        if (!field.note?.includes("OCR")) field.note = field.note ? `${field.note} ${reason}` : reason;
      }
      if (field.value && typeof field.value === "object") visit(field.value);
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(record);
  return lowered;
}
