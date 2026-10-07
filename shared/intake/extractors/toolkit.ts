/** Shared helpers for the deterministic per-class extractors (WP-L).
 * Every value carries a locator whose quote is a verbatim substring of the
 * block (or cell) it cites, so stage-6 span verification re-finds it. */
import type { IntakeBlock, IntakeExtract } from "../blocks";
import { findDates, findMoney, normalizeWhitespace, type DateMatch, type MoneyMatch } from "../parse";
import { inferred, notStated, stated, type FieldValue, type Locator } from "../schemas/common";

/** One addressable line: a line of a paragraph, or one line of a table cell. */
export type Line = {
  text: string;
  blockIndex: number;
  kind: IntakeBlock["kind"];
  page?: number;
  sheet?: string;
  cell?: string;
  row?: number;
  col?: number;
  part?: string;
  style?: string;
  /** For table lines: the other cells of the same row (trimmed), in column order. */
  rowCells?: Array<{ text: string; cell: string }>;
};

const BULLET = /^[\s•●▪◦·\-–*o§]+(?=\S)/;
export const stripBullet = (value: string) => value.replace(/^[\s•●▪◦·\-–*§]+/, "").replace(/^o\s+(?=[A-Z])/, "").trim();
export { BULLET };

/** Lines of the body (headers/footers excluded unless asked for). */
export function linesOf(extract: Pick<IntakeExtract, "blocks">, options: { includeParts?: boolean; blockStart?: number; blockEnd?: number } = {}): Line[] {
  const out: Line[] = [];
  const start = options.blockStart ?? 0;
  const end = options.blockEnd ?? extract.blocks.length - 1;
  for (const block of extract.blocks) {
    if (block.index < start || block.index > end) continue;
    if (!options.includeParts && block.part && block.part !== "body") continue;
    if (block.kind === "page_break") continue;
    if (block.kind === "table") {
      (block.rows ?? []).forEach((row, rowIndex) => {
        const rowCells = row.cells.filter((cell) => cell.text.trim()).map((cell) => ({ text: normalizeWhitespace(cell.text), cell: cell.cell }));
        row.cells.forEach((cell, colIndex) => {
          for (const piece of cell.text.split("\n")) {
            const text = piece.replace(/\s+$/g, "");
            if (!text.trim()) continue;
            out.push({ text, blockIndex: block.index, kind: "table", page: block.page, sheet: block.sheet, cell: cell.cell, row: rowIndex, col: colIndex, part: block.part, style: block.style, rowCells });
          }
        });
      });
      continue;
    }
    for (const piece of block.text.split("\n")) {
      const text = piece.replace(/\s+$/g, "");
      if (!text.trim()) continue;
      out.push({ text, blockIndex: block.index, kind: block.kind, page: block.page, sheet: block.sheet, part: block.part, style: block.style });
    }
  }
  return out;
}

/** Locator for (part of) a line. The quote must be a substring of the line. */
export function loc(line: Line, quote?: string): Locator {
  let text = (quote ?? line.text).trim();
  if (!line.text.includes(text)) text = line.text.trim();
  if (text.length > 400) text = text.slice(0, 400);
  return {
    kind: line.cell ? "cell" : line.kind === "email_header" ? "email_header" : "block",
    blockIndex: line.blockIndex,
    ...(line.page ? { page: line.page } : {}),
    ...(line.sheet ? { sheet: line.sheet } : {}),
    ...(line.cell ? { cell: line.cell } : {}),
    quote: text,
  };
}
export const fileLoc = (fileName: string): Locator => ({ kind: "filename", quote: fileName });

export function at<T>(value: T, line: Line, quote?: string, confidence = 0.85, note?: string): FieldValue<T> {
  return stated(value, [loc(line, quote)], confidence, note);
}
export function guessAt<T>(value: T, line: Line, quote?: string, confidence = 0.6, note?: string): FieldValue<T> {
  return inferred(value, [loc(line, quote)], confidence, note);
}
export function fromFile<T>(value: T, fileName: string, confidence = 0.5, note?: string): FieldValue<T> {
  return inferred(value, [fileLoc(fileName)], confidence, note ?? "From the file name.");
}
export { notStated };

/** The first `Label: value` line matching a label pattern; value may be on the next line or in the next cell. */
export function labelled(lines: Line[], label: RegExp, options: { from?: number; to?: number } = {}): { line: Line; value: string; index: number } | undefined {
  const from = options.from ?? 0;
  const to = Math.min(lines.length, options.to ?? lines.length);
  const re = new RegExp(`^\\s*(?:${label.source})\\s*(?::|-|–|\\t)\\s*(.*)$`, label.flags.includes("i") ? "i" : "");
  const bare = new RegExp(`^\\s*(?:${label.source})\\s*:?\\s*$`, label.flags.includes("i") ? "i" : "");
  for (let index = from; index < to; index++) {
    const line = lines[index];
    const match = re.exec(line.text);
    if (match && match[1].trim()) return { line, value: match[1].trim(), index };
    if (bare.test(line.text) || (match && !match[1].trim())) {
      // Value in the next cell of the row, or on the next line.
      if (line.rowCells) {
        const position = line.rowCells.findIndex((cell) => cell.cell === line.cell);
        const next = line.rowCells[position + 1];
        if (next) {
          const nextLine = lines.slice(index + 1, index + 12).find((candidate) => candidate.cell === next.cell && candidate.blockIndex === line.blockIndex);
          if (nextLine) return { line: nextLine, value: nextLine.text.trim(), index: lines.indexOf(nextLine) };
        }
      }
      const nextLine = lines[index + 1];
      if (nextLine && nextLine.text.trim() && !re.test(nextLine.text)) return { line: nextLine, value: nextLine.text.trim(), index: index + 1 };
    }
  }
  return undefined;
}

export type DateHit = { line: Line; date: DateMatch; index: number };
export function firstDate(lines: Line[], options: { from?: number; to?: number; skip?: RegExp; monthPrecision?: boolean } = {}): DateHit | undefined {
  const to = Math.min(lines.length, options.to ?? lines.length);
  for (let index = options.from ?? 0; index < to; index++) {
    const line = lines[index];
    if (options.skip?.test(line.text)) continue;
    const date = findDates(line.text, { allowMonthPrecision: options.monthPrecision })[0];
    if (date && (date.precision === "day" || options.monthPrecision)) return { line, date, index };
  }
  return undefined;
}

export function dateValue(date: DateMatch) {
  return { iso: date.iso, precision: date.precision, text: date.text } as { iso: string; precision: "day" | "month" | "year"; text: string };
}

/** Money with an optional sign: "(1,234.56)" and "-1,234" are negative. Accepts bare numbers in sheets. */
export function parseAmount(raw: string, options: { bare?: boolean } = {}): { cents: number; text: string } | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const money = findMoney(text)[0];
  if (money) {
    const negative = /^\(.*\)$|^-|\(\s*\$/.test(text);
    return { cents: negative ? -Math.abs(money.amountCents) : money.amountCents, text: money.text };
  }
  if (!options.bare) return undefined;
  const bare = /^\(?\s*(-)?\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,4}))?\s*\)?$/.exec(text);
  if (!bare) return undefined;
  const whole = Number(bare[2].replace(/,/g, ""));
  const fraction = bare[3] ? Number(`0.${bare[3]}`) : 0;
  const negative = Boolean(bare[1]) || /^\(.*\)$/.test(text);
  const cents = Math.round((whole + fraction) * 100);
  return { cents: negative ? -cents : cents, text };
}

export function moneyAt(line: Line, match: MoneyMatch | { cents: number; text: string }, confidence = 0.85, currency = "CAD"): FieldValue<{ amountCents: number; currency: string; text?: string }> {
  const cents = "cents" in match ? match.cents : match.amountCents;
  return at({ amountCents: cents, currency: "currency" in match ? match.currency : currency, text: match.text }, line, match.text, confidence);
}

export function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b([a-z])/g, (char) => char.toUpperCase());
}

/** The first meaningful heading-like line (skips letterhead addresses and phone lines). */
export function titleLine(lines: Line[], limit = 8): Line | undefined {
  for (const line of lines.slice(0, limit)) {
    const text = line.text.trim();
    if (text.length < 4 || text.length > 160) continue;
    if (/^(?:p\.?o\.? box|tel|phone|fax|email|www\.|http)|@|\d{3}[.\-) ]\d{3}[.\-]\d{4}/i.test(text)) continue;
    if (/^(?:date|time|location|subject|to|from|re|cc)\s*:/i.test(text)) continue;
    return line;
  }
  return undefined;
}

export function clean(value: string): string {
  return normalizeWhitespace(value.replace(/^[\s•●▪◦·\-–*:]+/, "").replace(/[\s,;:.]+$/, ""));
}

export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** Sub-extract for a block range (packages): blocks re-indexed from 0, text re-based. */
export function subExtract(extract: IntakeExtract, blockStart: number, blockEnd: number): { extract: IntakeExtract; blockOffset: number; charOffset: number } {
  const blocks = extract.blocks.filter((block) => block.index >= blockStart && block.index <= blockEnd);
  const charOffset = blocks[0]?.charStart ?? 0;
  const charEnd = blocks[blocks.length - 1]?.charEnd ?? charOffset;
  const shifted = blocks.map((block, index) => ({
    ...block,
    index,
    charStart: block.charStart - charOffset,
    charEnd: block.charEnd - charOffset,
    ...(block.rows ? { rows: block.rows.map((row) => ({ cells: row.cells.map((cell) => ({ ...cell, ...(cell.charStart !== undefined ? { charStart: cell.charStart - charOffset } : {}), ...(cell.charEnd !== undefined ? { charEnd: cell.charEnd - charOffset } : {}) })) })) } : {}),
  }));
  return { extract: { ...extract, blocks: shifted, text: extract.text.slice(charOffset, charEnd) }, blockOffset: blockStart, charOffset };
}

/** Moves every locator of a record extracted from a sub-extract back onto the parent extract. */
export function rebaseLocators(node: unknown, blockOffset: number, charOffset: number): void {
  if (Array.isArray(node)) return node.forEach((item) => rebaseLocators(item, blockOffset, charOffset));
  if (!node || typeof node !== "object") return;
  const value = node as Record<string, any>;
  if (Array.isArray(value.locators)) {
    for (const locator of value.locators) {
      if (!locator || typeof locator !== "object" || locator.kind === "filename" || locator.kind === "path") continue;
      if (typeof locator.blockIndex === "number") locator.blockIndex += blockOffset;
      if (typeof locator.charStart === "number") locator.charStart += charOffset;
      if (typeof locator.charEnd === "number") locator.charEnd += charOffset;
    }
  }
  if (typeof value.blockStart === "number" && typeof value.blockEnd === "number" && !("locators" in value)) {
    value.blockStart += blockOffset;
    value.blockEnd += blockOffset;
  }
  for (const child of Object.values(value)) rebaseLocators(child, blockOffset, charOffset);
}
