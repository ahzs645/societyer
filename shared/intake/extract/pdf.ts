/** PDF text layer → intake blocks with page numbers (pdf.js). Lines are rebuilt
 * from glyph positions; wide horizontal gaps become TABs so table-like layouts
 * keep their columns, and ruled tables with a recognisable header row are
 * rebuilt as real table blocks. Pages without a text layer are reported in
 * `emptyPages` for OCR. */
import { finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract, type IntakeRow } from "../blocks";

type PdfItem = { str: string; x: number; y: number; w: number; h: number };
type PdfLine = { y: number; h: number; items: PdfItem[]; text: string; x0: number; x1: number };

export type PdfJsModule = { getDocument: (src: any) => { promise: Promise<any> }; GlobalWorkerOptions?: any; version?: string };

let cachedPdfJs: Promise<PdfJsModule> | null = null;
async function loadPdfJs(): Promise<PdfJsModule> {
  // The legacy build runs in Node (CLI, Convex node actions, Electron main) and browsers.
  cachedPdfJs ??= import("pdfjs-dist/legacy/build/pdf.mjs" as string) as Promise<PdfJsModule>;
  return cachedPdfJs;
}

function linesFromItems(items: PdfItem[]): PdfLine[] {
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
    for (const item of line.items) {
      const charWidth = item.str.trim().length ? item.w / Math.max(1, item.str.length) : 4;
      const gap = item.x - end;
      if (text && gap > Math.max(18, charWidth * 4)) text = `${text.replace(/ +$/, "")}\t`;
      else if (text && gap > charWidth * 0.25 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
      text += item.str;
      end = Math.max(end, item.x + item.w);
    }
    line.text = text.replace(/[  ]+/g, " ").replace(/ ?\t ?/g, "\t").trimEnd();
    line.x0 = line.items[0].x;
    line.x1 = end;
    line.h = Math.max(...line.items.map((item) => item.h || 10));
  }
  return lines.sort((a, b) => b.y - a.y).filter((line) => line.text.trim());
}

/** Column anchors from a header line such as "Agenda Item\tDiscussion\tAction". */
const TABLE_HEADER = /^(?:item|agenda item|topic|#|no\.?)\t.*(?:discussion|notes|summary|details|update)/i;

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

function tableFromLines(lines: PdfLine[], header: PdfLine, page: number, rightEdge: number): { block: DraftBlock; consumed: number } {
  const anchors: number[] = [];
  let previousEnd = -Infinity;
  for (const item of header.items) {
    if (!item.str.trim()) continue;
    if (!anchors.length || item.x - previousEnd > 20) anchors.push(item.x);
    previousEnd = item.x + item.w;
  }
  const headerCells = anchors.map((_, column) => header.items.filter((item) => columnOf(item.x, anchors) === column).map((item) => item.str).join(" ").replace(/\s+/g, " ").trim());
  alignAnchors(anchors, lines, 30);
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
    const startsRow = !current || (texts[0] && (/^\d+(?:\.\d+)*\.?\s/.test(texts[0]) || /^\d+(?:\.\d+)*\.?$/.test(texts[0]) || lastY - line.y > line.h * 1.9));
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
  return { block: { kind: "table", rows, page }, consumed };
}

export async function extractPdf(bytes: Uint8Array | ArrayBuffer, options: { pdfjs?: PdfJsModule; maxPages?: number } = {}): Promise<IntakeExtract> {
  const pdfjs = options.pdfjs ?? await loadPdfJs();
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const drafts: DraftBlock[] = [];
  const emptyPages: number[] = [];
  const warnings: string[] = [];
  const pageCount: number = doc.numPages;
  const limit = Math.min(pageCount, options.maxPages ?? 400);
  if (limit < pageCount) warnings.push(`Only the first ${limit} of ${pageCount} pages were read.`);
  const pages: Array<{ pageNumber: number; lines: PdfLine[] }> = [];
  for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PdfItem[] = (content.items as any[]).filter((item) => typeof item.str === "string").map((item) => ({
      str: String(item.str), x: Number(item.transform?.[4] ?? 0), y: Number(item.transform?.[5] ?? 0), w: Number(item.width ?? 0), h: Math.abs(Number(item.height ?? item.transform?.[3] ?? 10)),
    }));
    pages.push({ pageNumber, lines: linesFromItems(items) });
    page.cleanup?.();
  }
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
          const soft = prior.x1 >= rightEdge - 45 && !/:$/.test(prior.text) && !/^\s*(?:[•●▪◦*]|ACTION\b|\d{1,2}[.)]\s)/.test(next);
          text += soft ? `${/[a-z]-$/.test(prior.text) && /^[a-z]/.test(next) ? "" : " "}${next}` : `\n${next}`;
        }
        drafts.push({ kind: "paragraph", text, page: pageNumber });
      }
      paragraph = [];
    };
    let registerStart = 0;
    if (openRegister && lines.length && lines[0].items.filter((item) => openRegister!.anchors.some((anchor) => Math.abs(anchor - item.x) < 8)).length >= 1 && lines[0].x0 >= openRegister.anchors[0] - 30) {
      // A register continued from the previous page without a repeated header.
      alignAnchors(openRegister.anchors, lines, 15);
      const { block, consumed } = registerFromLines(lines, openRegister, pageNumber);
      drafts.push(block);
      registerStart = consumed;
    }
    openRegister = null;
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
        drafts.push(block);
        index += consumed;
        previous = lines[index] ?? null;
        if (index >= lines.length - 1) openRegister = open;
        continue;
      }
      if (TABLE_HEADER.test(line.text.replace(/ +(?=(?:discussion|notes|summary|details|update)\b)/i, "\t")) && line.items.length >= 2) {
        flush();
        const { block, consumed } = tableFromLines(lines.slice(index + 1), line, pageNumber, rightEdge);
        drafts.push(block);
        index += consumed;
        previous = lines[index] ?? null;
        continue;
      }
      if (previous && previous.y - line.y > Math.max(previous.h, line.h) * 1.7) flush();
      paragraph.push(line);
      previous = line;
    }
    flush();
  }
  await doc.destroy?.();
  if (emptyPages.length) warnings.push(`No text layer on page(s) ${emptyPages.join(", ")}; OCR required.`);
  const { blocks, text } = finalizeBlocks(drafts);
  return { method: "pdfjs-text", methodVersion: `${INTAKE_EXTRACT_VERSION}+pdfjs-${pdfjs.version ?? "unknown"}`, blocks, text, pageCount, emptyPages, warnings };
}
