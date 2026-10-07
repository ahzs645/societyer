/** The intake text-and-layout model (stage 2). Every extractor emits these
 * blocks; every locator points back into them. It extends the source meeting
 * block model (`shared/sourceMeetingRecord.ts`) with page, sheet, cell and
 * character offsets so a field value can be re-found and highlighted. */
import type { SourceMeetingBlock } from "../sourceMeetingRecord";

export type IntakeCell = {
  text: string;
  /** A1-style reference for spreadsheets; R{row}C{col} (1-based) for document tables. */
  cell: string;
  colSpan?: number;
  rowSpan?: number;
  header?: boolean;
  charStart?: number;
  charEnd?: number;
};
export type IntakeRow = { cells: IntakeCell[] };
export type IntakeBlockKind = "paragraph" | "heading" | "list_item" | "table" | "page_break" | "image" | "email_header";

export type IntakeBlock = {
  index: number;
  kind: IntakeBlockKind;
  /** Canonical text. Tables: cells joined by TAB, rows by newline; never pipe-flattened. */
  text: string;
  level?: number;
  style?: string;
  /** "header" / "footer" / "body" / "attachment:<name>" for content outside the main story. */
  part?: string;
  page?: number;
  sheet?: string;
  rows?: IntakeRow[];
  charStart: number;
  charEnd: number;
};

export type IntakeExtractMethod =
  | "docx-ooxml" | "pdfjs-text" | "xlsx-ooxml" | "msg-msgreader" | "libreoffice-docx" | "libreoffice-xlsx" | "plain-text" | "eml-headers" | "unsupported";

export type IntakeExtract = {
  method: IntakeExtractMethod;
  methodVersion: string;
  blocks: IntakeBlock[];
  text: string;
  pageCount?: number;
  sheetNames?: string[];
  /** Pages with no text layer (candidates for OCR). */
  emptyPages?: number[];
  attachments?: Array<{ name: string; extract?: IntakeExtract; error?: string }>;
  emailHeaders?: Record<string, string>;
  warnings: string[];
};

export const BLOCK_SEPARATOR = "\n\n";
export const INTAKE_EXTRACT_VERSION = "intake-extract/1";

export type DraftBlock = Omit<IntakeBlock, "index" | "charStart" | "charEnd" | "text"> & { text?: string };

export function tableText(rows: IntakeRow[]): string {
  return rows.map((row) => row.cells.map((cell) => cell.text.replace(/[\t\n]+/g, " ").trim()).join("\t")).join("\n");
}

/** Assign indices and character offsets; the joined text is the extract's addressable text. */
export function finalizeBlocks(drafts: DraftBlock[]): { blocks: IntakeBlock[]; text: string } {
  const blocks: IntakeBlock[] = [];
  let offset = 0;
  let text = "";
  for (const draft of drafts) {
    if (draft.kind !== "page_break" && draft.kind !== "table" && !(draft.text ?? "").trim()) continue;
    if (draft.kind === "table" && !(draft.rows ?? []).some((row) => row.cells.some((cell) => cell.text.trim()))) continue;
    const body = draft.kind === "table" ? tableText(draft.rows ?? []) : draft.kind === "page_break" ? "" : String(draft.text ?? "");
    if (blocks.length) {
      text += BLOCK_SEPARATOR;
      offset += BLOCK_SEPARATOR.length;
    }
    const block: IntakeBlock = { ...draft, index: blocks.length, text: body, charStart: offset, charEnd: offset + body.length } as IntakeBlock;
    if (draft.kind === "table" && draft.rows) {
      let cursor = offset;
      block.rows = draft.rows.map((row, rowIndex) => {
        const cells = row.cells.map((cell, cellIndex) => {
          const cellText = cell.text.replace(/[\t\n]+/g, " ").trim();
          const placed = { ...cell, charStart: cursor, charEnd: cursor + cellText.length };
          cursor += cellText.length + (cellIndex < row.cells.length - 1 ? 1 : 0);
          return placed;
        });
        if (rowIndex < draft.rows!.length - 1) cursor += 1;
        return { cells };
      });
    }
    blocks.push(block);
    text += body;
    offset += body.length;
  }
  return { blocks, text };
}

/** Plain text → paragraphs (blank-line separated; form feed = page break). */
export function blocksFromPlainText(value: string): DraftBlock[] {
  const drafts: DraftBlock[] = [];
  let page = 1;
  for (const pageText of value.replace(/\r\n?/g, "\n").split("\f")) {
    if (drafts.length) {
      drafts.push({ kind: "page_break", page });
      page += 1;
    }
    for (const paragraph of pageText.split(/\n{2,}/)) {
      if (paragraph.trim()) drafts.push({ kind: "paragraph", text: paragraph.replace(/\s+$/g, ""), page });
    }
  }
  return drafts;
}

/** Bridge to the existing source meeting record viewer: real tables, no pipes. */
export function toSourceMeetingBlocks(blocks: IntakeBlock[]): SourceMeetingBlock[] {
  return blocks.map((block): SourceMeetingBlock => {
    const sourceReference = `block ${block.index}${block.page ? `, page ${block.page}` : ""}${block.sheet ? `, sheet ${block.sheet}` : ""}`;
    if (block.kind === "table") {
      return { kind: "table", rows: (block.rows ?? []).map((row) => ({ cells: row.cells.map((cell) => ({ text: cell.text, colSpan: cell.colSpan, rowSpan: cell.rowSpan, header: cell.header })) })), sourceReference };
    }
    if (block.kind === "page_break") return { kind: "page_break", sourceReference };
    if (block.kind === "image") return { kind: "image", alt: block.text, sourceReference };
    return { kind: block.kind === "heading" ? "heading" : "paragraph", text: block.text, level: block.level, sourceReference };
  });
}

/** Rows of a table block with each cell's text, trimmed. */
export function tableMatrix(block: IntakeBlock): string[][] {
  return (block.rows ?? []).map((row) => row.cells.map((cell) => cell.text.trim()));
}
