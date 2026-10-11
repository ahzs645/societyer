/** PDF text layer → intake blocks with page numbers (pdf.js). Lines are rebuilt
 * from glyph positions; wide horizontal gaps become TABs so table-like layouts
 * keep their columns, and ruled tables with a recognisable header row are
 * rebuilt as real table blocks. Pages without a text layer are reported in
 * `emptyPages` for OCR. */
import { finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract, type IntakeOcrPage, type IntakeRow } from "../blocks";
import { itemsFromRecognition, ocrBlockStats, ocrPageSummary, recognizeUpright, type OcrHost } from "./ocr";

/** A positioned text item in PDF points (y up). `conf` (0-100) is set for words read by OCR. */
export type PdfItem = { str: string; x: number; y: number; w: number; h: number; conf?: number };
export type PdfLine = { y: number; h: number; items: PdfItem[]; text: string; x0: number; x1: number };

export type PdfJsModule = { getDocument: (src: any) => { promise: Promise<any> }; GlobalWorkerOptions?: any; version?: string };

let cachedPdfJs: Promise<PdfJsModule> | null = null;
async function loadPdfJs(): Promise<PdfJsModule> {
  // The legacy build runs in Node (CLI, Convex node actions, Electron main) and browsers.
  cachedPdfJs ??= import("pdfjs-dist/legacy/build/pdf.mjs" as string) as Promise<PdfJsModule>;
  return cachedPdfJs;
}

export function linesFromItems(items: PdfItem[]): PdfLine[] {
  const sorted = items.filter((item) => item.str.length).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfLine[] = [];
  for (const item of sorted) {
    const tolerance = Math.max(2, Math.min(item.h || 10, 14) * 0.45);
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, h: item.h || 10, items: [item], text: "", x0: 0, x1: 0 });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    let pendingSpace = false;
    for (const item of line.items) {
      // pdf.js reports the gap between two columns as one wide " " item: it is a separator,
      // not text, so it must not close the gap that makes the next cell a new column.
      if (!item.str.trim()) {
        pendingSpace = Boolean(text);
        continue;
      }
      const charWidth = item.w / Math.max(1, item.str.length);
      const gap = item.x - end;
      if (text && gap > Math.max(18, charWidth * 4)) text = `${text.replace(/ +$/, "")}\t`;
      // OCR items are whole words: two of them are always separated, however tight the boxes.
      else if (text && (pendingSpace || gap > charWidth * 0.25 || item.conf !== undefined) && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
      pendingSpace = false;
      text += item.str;
      end = Math.max(end, item.x + item.w);
    }
    line.text = text.replace(/[  ]+/g, " ").replace(/ ?\t ?/g, "\t").trimEnd();
    line.x0 = (line.items.find((item) => item.str.trim()) ?? line.items[0]).x;
    line.x1 = end;
    line.h = Math.max(...line.items.map((item) => item.h || 10));
  }
  return lines.sort((a, b) => b.y - a.y).filter((line) => line.text.trim());
}

/** Column anchors from a header line such as "Agenda Item\tDiscussion\tAction". */
const TABLE_HEADER_LABELS = "discussion|notes|summary|details|update|action|actions|decisions?|group|outcome|who|responsib\\w*|minutes";
const TABLE_HEADER = new RegExp(`^(?:item|agenda item|topic|#|no\\.?)\\t.*\\b(?:${TABLE_HEADER_LABELS})\\b`, "i");

/** Header labels are often centred over their column while cell text is left-aligned:
 * move each column start to the most common left edge of text found under it. */
function alignAnchors(anchors: number[], lines: PdfLine[], minGap: number) {
  const starts = new Map<number, number>();
  for (const line of lines.slice(0, 80)) {
    let end = -Infinity;
    for (const item of line.items) {
      if (item.str.trim() && item.x - end > 8) {
        const key = Math.round(item.x / 2) * 2;
        starts.set(key, (starts.get(key) ?? 0) + 1);
      }
      end = item.x + item.w;
    }
  }
  for (let column = 1; column < anchors.length; column++) {
    const low = anchors[column - 1] + minGap, high = anchors[column] + 5;
    const best = [...starts.entries()].filter(([x, count]) => x > low && x <= high && count >= 2).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (best) anchors[column] = Math.min(anchors[column], best[0]);
  }
}

/** Action registers: "Description | Date Added | Assigned to | Date Due | Status | Notes". */
const REGISTER_HEADER = /\bdescription\b.*\bassigned\b|\baction(?: items?)?\b.*\b(?:assigned|responsib\w*|who)\b.*\b(?:due|deadline|status)\b/i;
type OpenRegister = { anchors: number[]; labels: string[] };

/** Rows of a register start on the line where the assignee (or date) column has text;
 * item numbers are often vertically centred and attach to the row they sit in. */
function registerFromLines(lines: PdfLine[], open: OpenRegister, page: number): { block: DraftBlock; consumed: number } {
  const { anchors, labels } = open;
  const rowStartColumns = labels.map((label, index) => (/assigned|responsib|who|date added|added/i.test(label) ? index : -1)).filter((index) => index >= 0);
  const rows: IntakeRow[] = [{ cells: labels.map((text, column) => ({ text, cell: `R1C${column + 1}`, header: true })) }];
  let current: string[][] | null = null;
  let consumed = 0;
  let lastY = Infinity;
  const flushRow = () => {
    if (current && current.some((cell) => cell.length)) rows.push({ cells: current.map((cell, column) => ({ text: cell.join(" ").replace(/\s+/g, " ").trim(), cell: `R${rows.length + 1}C${column + 1}` })) });
  };
  for (const line of lines) {
    if (lastY !== Infinity && lastY - line.y > line.h * 4 && line.x0 < anchors[0] - 12) break;
    const parts: string[][] = anchors.map(() => []);
    for (const item of line.items) parts[columnOf(item.x, anchors)].push(item.str);
    const texts = parts.map((part) => part.join(" ").replace(/\s+/g, " ").trim());
    const starts = !current || rowStartColumns.some((column) => texts[column]);
    if (starts) {
      flushRow();
      current = anchors.map(() => []);
    }
    texts.forEach((text, column) => text && current![column].push(text));
    lastY = line.y;
    consumed += 1;
  }
  flushRow();
  return { block: { kind: "table", rows, page }, consumed };
}

function registerHeader(header: PdfLine): OpenRegister {
  const anchors: number[] = [];
  const labels: string[] = [];
  let previousEnd = -Infinity;
  for (const item of header.items) {
    if (!item.str.trim()) continue;
    if (!anchors.length || item.x - previousEnd > 12) {
      anchors.push(item.x);
      labels.push(item.str.trim());
    } else labels[labels.length - 1] = `${labels[labels.length - 1]} ${item.str.trim()}`;
    previousEnd = item.x + item.w;
  }
  return { anchors, labels };
}

function columnOf(x: number, anchors: number[]): number {
  let column = 0;
  for (let index = 0; index < anchors.length; index++) if (x >= anchors[index] - 6) column = index;
  return column;
}

type OpenTable = { header: PdfLine; anchors: number[] };

function tableFromLines(lines: PdfLine[], header: PdfLine, page: number, rightEdge: number, preset?: number[]): { block: DraftBlock; consumed: number; anchors: number[] } {
  const anchors: number[] = preset ? [...preset] : [];
  let previousEnd = -Infinity;
  if (!preset) for (const item of header.items) {
    if (!item.str.trim()) continue;
    if (!anchors.length || item.x - previousEnd > 20) anchors.push(item.x);
    previousEnd = item.x + item.w;
  }
  const headerCells = anchors.map((_, column) => header.items.filter((item) => columnOf(item.x, anchors) === column).map((item) => item.str).join(" ").replace(/\s+/g, " ").trim());
  if (!preset) alignAnchors(anchors, lines, 30);
  const rows: IntakeRow[] = [{ cells: headerCells.map((text, column) => ({ text, cell: `R1C${column + 1}`, header: true })) }];
  let current: string[][] | null = null;
  const lastEnd: number[] = anchors.map(() => 0);
  let consumed = 0;
  let lastY = header.y;
  for (const line of lines) {
    // A table ends at a large vertical gap with text that starts left of the first column.
    if (lastY - line.y > line.h * 4 && line.x0 < anchors[0] - 12) break;
    const parts: string[][] = anchors.map(() => []);
    const ends: number[] = anchors.map(() => 0);
    for (const item of line.items) {
      const column = columnOf(item.x, anchors);
      parts[column].push(item.str);
      ends[column] = Math.max(ends[column], item.x + item.w);
    }
    const texts = parts.map((part) => part.join(" ").replace(/\s+/g, " ").trim());
    // A new row starts when the first column has text after a vertical gap, or holds an item number.
    let startsRow = !current || (texts[0] && (/^\d+(?:\.\d+)*\.?\s/.test(texts[0]) || /^\d+(?:\.\d+)*\.?$/.test(texts[0]) || lastY - line.y > line.h * 1.9));
    // A one-line cell drawn just above its row's item ("1:08PM" over "7. Adjourn") is a vertically
    // centred cell of that row, not a row of its own with an empty item column.
    if (startsRow && current && !current[0].length && current.reduce((sum, cell) => sum + cell.length, 0) === 1 && lastY - line.y <= line.h * 1.6) startsRow = false;
    if (startsRow) {
      if (current) rows.push({ cells: current.map((cell, column) => ({ text: cell.join("\n"), cell: `R${rows.length + 1}C${column + 1}` })) });
      current = anchors.map(() => []);
    }
    texts.forEach((text, column) => {
      if (!text) return;
      const cell = current![column];
      // Soft wrap inside a cell: the previous line reached the column's right boundary.
      const boundary = (anchors[column + 1] ?? rightEdge) - 40;
      const soft = cell.length > 0 && !startsRow && lastEnd[column] >= boundary && !/^\s*(?:[•●▪◦*]|ACTION\b)/.test(text);
      if (soft) cell[cell.length - 1] = `${cell[cell.length - 1]} ${text}`;
      else cell.push(text);
      lastEnd[column] = ends[column];
    });
    lastY = line.y;
    consumed += 1;
  }
  if (current) rows.push({ cells: (current as string[][]).map((cell, column) => ({ text: cell.join("\n"), cell: `R${rows.length + 1}C${column + 1}` })) });
  return { block: { kind: "table", rows, page }, consumed, anchors };
}

/** A page is read by OCR when its text layer has fewer characters than this and it paints an
 * image (a scan) or many vector paths (text converted to outlines). */
const MIN_TEXT_LAYER_CHARS = 20;

async function pageNeedsOcr(page: any, pdfjs: PdfJsModule, textChars: number): Promise<boolean> {
  if (textChars >= MIN_TEXT_LAYER_CHARS) return false;
  const OPS = (pdfjs as { OPS?: Record<string, number> }).OPS;
  if (!OPS || typeof page.getOperatorList !== "function") return textChars === 0;
  try {
    const list = await page.getOperatorList();
    const images = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat].filter((op) => op !== undefined));
    let paths = 0;
    for (const fn of list.fnArray as number[]) {
      if (images.has(fn)) return true;
      if (fn === OPS.constructPath) paths += 1;
    }
    return paths > 60;
  } catch {
    return textChars === 0;
  }
}

export type PdfExtractOptions = { pdfjs?: PdfJsModule; maxPages?: number; ocr?: OcrHost };

export async function extractPdf(bytes: Uint8Array | ArrayBuffer, options: PdfExtractOptions = {}): Promise<IntakeExtract> {
  const pdfjs = options.pdfjs ?? await loadPdfJs();
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const ocr = options.ocr;
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0, ...(ocr?.pdfjsWasmUrl ? { wasmUrl: ocr.pdfjsWasmUrl } : {}), ...(ocr?.pdfjsDocumentOptions ?? {}) });
  const doc = await task.promise;
  const warnings: string[] = [];
  const pageCount: number = doc.numPages;
  const limit = Math.min(pageCount, options.maxPages ?? 400);
  if (limit < pageCount) warnings.push(`Only the first ${limit} of ${pageCount} pages were read.`);
  const pages: PdfLayoutPage[] = [];
  const ocrPages: IntakeOcrPage[] = [];
  const skipped: number[] = [];
  let skippedReason: string | undefined;
  for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    let items: PdfItem[] = (content.items as any[]).filter((item) => typeof item.str === "string").map((item) => ({
      str: String(item.str), x: Number(item.transform?.[4] ?? 0), y: Number(item.transform?.[5] ?? 0), w: Number(item.width ?? 0), h: Math.abs(Number(item.height ?? item.transform?.[3] ?? 10)),
    }));
    const textChars = items.reduce((sum, item) => sum + item.str.trim().length, 0);
    if (ocr && await pageNeedsOcr(page, pdfjs, textChars)) {
      if (ocr.budget && !ocr.budget.take()) {
        skipped.push(pageNumber);
        skippedReason = `the run's OCR page budget (${ocr.budget.limit} pages) is used up`;
      } else {
        try {
          const read = await ocrPdfPage(page, pageNumber, ocr);
          items = read.items;
          ocrPages.push(read.summary);
        } catch (error) {
          skipped.push(pageNumber);
          skippedReason = `OCR failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }
    pages.push({ pageNumber, lines: linesFromItems(items) });
    page.cleanup?.();
  }
  await doc.destroy?.();
  const { drafts, emptyPages } = layoutPages(pages);
  if (ocrPages.length) {
    const mean = ocrPages.reduce((sum, page) => sum + page.confidence, 0) / ocrPages.length;
    const rotated = ocrPages.filter((page) => page.rotation);
    warnings.push(`OCR read page(s) ${ocrPages.map((page) => page.page).join(", ")} (mean confidence ${Math.round(mean * 100)}%${rotated.length ? `; rotated ${rotated.map((page) => `p${page.page} ${page.rotation}°`).join(", ")}` : ""}).`);
  }
  if (skipped.length) warnings.push(`OCR skipped page(s) ${skipped.join(", ")}: ${skippedReason}.`);
  const ocrBlank = emptyPages.filter((page) => ocrPages.some((read) => read.page === page));
  const unread = emptyPages.filter((page) => !ocrBlank.includes(page));
  if (ocrBlank.length) warnings.push(`OCR found no text on page(s) ${ocrBlank.join(", ")}.`);
  if (unread.length) warnings.push(`No text layer on page(s) ${unread.join(", ")}; OCR required.`);
  const { blocks, text } = finalizeBlocks(drafts);
  const method = !ocrPages.length ? "pdfjs-text" : ocrPages.length === pages.length ? "ocr" : "pdfjs-text+ocr";
  return {
    method,
    methodVersion: `${INTAKE_EXTRACT_VERSION}+pdfjs-${pdfjs.version ?? "unknown"}${ocrPages.length && ocr ? `+${ocr.engine.name}` : ""}`,
    blocks, text, pageCount, emptyPages: unread, warnings,
    ...(ocr && (ocrPages.length || skipped.length) ? { ocr: { engine: ocr.engine.name, pages: ocrPages, ...(skipped.length ? { skippedPages: skipped, skippedReason } : {}) } } : {}),
  };
}

async function ocrPdfPage(page: any, pageNumber: number, ocr: OcrHost): Promise<{ items: PdfItem[]; summary: IntakeOcrPage }> {
  const base = page.getViewport({ scale: 1 });
  const dpi = ocr.dpi ?? 300;
  const maxPixels = ocr.maxPixels ?? 20_000_000;
  // Large-format pages are read at a lower resolution so one page stays within the pixel budget.
  const scale = Math.min(dpi / 72, Math.sqrt(maxPixels / Math.max(1, base.width * base.height)));
  const probeScale = Math.min(scale, 150 / 72);
  const pageRotation = Number(page.rotate ?? 0);
  const { recognition, rotation } = await recognizeUpright(ocr.engine, (extra, probe) => ocr.renderPdfPage(page, { scale: probe ? probeScale : scale, rotation: (pageRotation + extra) % 360 }));
  return {
    items: itemsFromRecognition(recognition, scale),
    summary: ocrPageSummary(recognition, { page: pageNumber, rotation, dpi: Math.round(scale * 72), keepLines: ocr.keepLineBoxes }),
  };
}

export type PdfLayoutPage = { pageNumber: number; lines: PdfLine[] };

function withOcr(block: DraftBlock, lines: PdfLine[]): DraftBlock {
  const stats = ocrBlockStats(lines.flatMap((line) => line.items));
  return stats ? { ...block, ocr: stats } : block;
}

/** Lines of positioned text (a PDF text layer or OCR words) → blocks: running headers removed,
 * minutes tables and action registers rebuilt, paragraphs from vertical gaps and soft wraps. */
export function layoutPages(pages: PdfLayoutPage[]): { drafts: DraftBlock[]; emptyPages: number[] } {
  const drafts: DraftBlock[] = [];
  const emptyPages: number[] = [];
  // Running headers/footers (repeated at the top or bottom of several pages) and
  // "Page X of Y" lines are page furniture, not content: keep the first occurrence only.
  const runningKey = (text: string) => text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
  const seenOnPages = new Map<string, Set<number>>();
  for (const { pageNumber, lines } of pages) {
    for (const line of [...lines.slice(0, 6), ...lines.slice(-3)]) {
      const key = runningKey(line.text);
      if (!seenOnPages.has(key)) seenOnPages.set(key, new Set());
      seenOnPages.get(key)!.add(pageNumber);
    }
  }
  for (const page of pages) {
    const edge = new Set([...page.lines.slice(0, 6), ...page.lines.slice(-3)]);
    page.lines = page.lines.filter((line) => {
      if (/^\s*page\s+\d+(?:\s+of\s+\d+)?\s*$/i.test(line.text)) return false;
      const pagesWithLine = seenOnPages.get(runningKey(line.text));
      return !(edge.has(line) && pagesWithLine && pagesWithLine.size >= 2 && Math.min(...pagesWithLine) < page.pageNumber);
    });
  }
  let openRegister: OpenRegister | null = null;
  // A two-column minutes table often runs over several pages without repeating its header:
  // its column anchors carry to the next page so the cells are not read across both columns.
  let openTable: OpenTable | null = null;
  for (const { pageNumber, lines } of pages) {
    if (pageNumber > 1) drafts.push({ kind: "page_break", page: pageNumber });
    if (!lines.length) {
      emptyPages.push(pageNumber);
      continue;
    }
    let paragraph: PdfLine[] = [];
    let previous: PdfLine | null = null;
    // A line that reaches the text column's right edge wraps softly into the next one;
    // a short line ends with a hard break (list entries, labels, signatures).
    const rightEdge = Math.max(...lines.map((line) => line.x1));
    const flush = () => {
      if (paragraph.length) {
        let text = paragraph[0].text;
        for (let index = 1; index < paragraph.length; index++) {
          const prior = paragraph[index - 1];
          const next = paragraph[index].text;
          // Two rows of a tabbed list ("Name<TAB>Organization") that start at the same left edge are
          // two entries, even when the first row's long organization reaches the right margin.
          const tabbedRows = prior.text.includes("\t") && next.includes("\t") && Math.abs(paragraph[index].x0 - prior.x0) < 4;
          const soft = !tabbedRows && prior.x1 >= rightEdge - 45 && !/:$/.test(prior.text) && !/^\s*(?:[•●▪◦*]|ACTION\b|\d{1,2}[.)]\s)/.test(next);
          text += soft ? `${/[a-z]-$/.test(prior.text) && /^[a-z]/.test(next) ? "" : " "}${next}` : `\n${next}`;
        }
        drafts.push(withOcr({ kind: "paragraph", text, page: pageNumber }, paragraph));
      }
      paragraph = [];
    };
    let registerStart = 0;
    if (openRegister && lines.length && lines[0].items.filter((item) => openRegister!.anchors.some((anchor) => Math.abs(anchor - item.x) < 8)).length >= 1 && lines[0].x0 >= openRegister.anchors[0] - 30) {
      // A register continued from the previous page without a repeated header.
      alignAnchors(openRegister.anchors, lines, 15);
      const { block, consumed } = registerFromLines(lines, openRegister, pageNumber);
      drafts.push(withOcr(block, lines.slice(0, consumed)));
      registerStart = consumed;
    }
    openRegister = null;
    if (openTable && registerStart === 0) {
      const anchors = openTable.anchors;
      const aligned = lines.slice(0, 6).filter((line) => line.items.some((item) => item.str.trim() && Math.abs(item.x - anchors[anchors.length - 1]) < 12) && line.x0 >= anchors[0] - 30).length;
      if (aligned >= 1 && lines[0].x0 >= anchors[0] - 30) {
        const { block, consumed } = tableFromLines(lines, openTable.header, pageNumber, Math.max(...lines.map((line) => line.x1)), anchors);
        drafts.push(withOcr(block, lines.slice(0, consumed)));
        registerStart = consumed;
        openTable = consumed >= lines.length ? openTable : null;
      } else openTable = null;
    }
    for (let index = registerStart; index < lines.length; index++) {
      const line = lines[index];
      if (REGISTER_HEADER.test(line.text) && line.items.length >= 3) {
        flush();
        const open = registerHeader(line);
        // Leading item-number column ("Item #") sits left of the first header label.
        const leftmost = Math.min(...lines.slice(index + 1, index + 15).map((candidate) => candidate.x0));
        if (leftmost < open.anchors[0] - 20) {
          open.anchors.unshift(leftmost);
          open.labels.unshift("Item");
        }
        alignAnchors(open.anchors, lines.slice(index + 1), 15);
        const { block, consumed } = registerFromLines(lines.slice(index + 1), open, pageNumber);
        drafts.push(withOcr(block, lines.slice(index + 1, index + 1 + consumed)));
        index += consumed;
        previous = lines[index] ?? null;
        if (index >= lines.length - 1) openRegister = open;
        continue;
      }
      if (TABLE_HEADER.test(line.text.replace(new RegExp(` +(?=(?:${TABLE_HEADER_LABELS})\\b)`, "i"), "\t")) && line.items.length >= 2) {
        flush();
        const { block, consumed, anchors } = tableFromLines(lines.slice(index + 1), line, pageNumber, rightEdge);
        drafts.push(withOcr(block, lines.slice(index + 1, index + 1 + consumed)));
        index += consumed;
        previous = lines[index] ?? null;
        // The table reached the bottom of the page: it may continue on the next one.
        openTable = index >= lines.length - 1 && anchors.length >= 2 ? { header: line, anchors } : null;
        continue;
      }
      if (previous && previous.y - line.y > Math.max(previous.h, line.h) * 1.7) flush();
      paragraph.push(line);
      previous = line;
    }
    flush();
  }
  return { drafts, emptyPages };
}
