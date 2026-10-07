/** Excel 97–2003 (.xls, BIFF8; BIFF5 strings best effort) without LibreOffice, so a browser or a
 * host without LibreOffice still reads legacy budgets and statements. Reads the compound file's
 * Workbook stream: sheet names (BOUNDSHEET), the shared string table (SST with CONTINUE
 * records), number formats and XF records (dates), and cell records (LABELSST, LABEL, RSTRING,
 * NUMBER, RK, MULRK, BOOLERR, FORMULA with its cached result and STRING). Formulas are not
 * evaluated: the value Excel saved is used, as for .xlsx. Encrypted workbooks are reported. */
import { finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract, type IntakeRow } from "../blocks";
import { readCompoundStreams } from "./doc";
import { columnLetters, excelSerialToIso, isDateFormatCode } from "./xlsx";

type BiffRecord = { type: number; data: Uint8Array; offset: number };

function* records(stream: Uint8Array): Generator<BiffRecord> {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  let offset = 0;
  while (offset + 4 <= stream.length) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    if (offset + 4 + length > stream.length) break;
    yield { type, data: stream.subarray(offset + 4, offset + 4 + length), offset };
    offset += 4 + length;
  }
}

const latin1 = (bytes: Uint8Array) => {
  let out = "";
  for (let index = 0; index < bytes.length; index += 4096) out += String.fromCharCode(...bytes.subarray(index, index + 4096));
  return out;
};
const utf16 = (bytes: Uint8Array) => {
  let out = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) out += String.fromCharCode(bytes[index] | (bytes[index + 1] << 8));
  return out;
};

/** XLUnicodeString (BIFF8): cch u16, flags u8, characters. BIFF5: cch u16 (or u8), 8-bit characters. */
function unicodeString(data: Uint8Array, offset: number, biff8: boolean, shortLength = false): { text: string; next: number } {
  const cch = shortLength ? data[offset] : data[offset] | (data[offset + 1] << 8);
  let position = offset + (shortLength ? 1 : 2);
  if (!biff8) return { text: latin1(data.subarray(position, position + cch)), next: position + cch };
  const flags = data[position];
  position += 1;
  const high = (flags & 0x01) !== 0;
  let runs = 0;
  let ext = 0;
  if (flags & 0x08) {
    runs = data[position] | (data[position + 1] << 8);
    position += 2;
  }
  if (flags & 0x04) {
    ext = data[position] | (data[position + 1] << 8) | (data[position + 2] << 16) | (data[position + 3] << 24);
    position += 4;
  }
  const byteLength = high ? cch * 2 : cch;
  const text = high ? utf16(data.subarray(position, position + byteLength)) : latin1(data.subarray(position, position + byteLength));
  return { text, next: position + byteLength + runs * 4 + ext };
}

/** The shared string table spans SST + CONTINUE records; a string's characters may break across a
 * CONTINUE, where a fresh option byte says whether the rest is 8- or 16-bit. */
function readSst(parts: Uint8Array[]): string[] {
  const strings: string[] = [];
  if (!parts.length) return strings;
  let part = 0;
  let data = parts[0];
  let position = 8; // cstTotal, cstUnique
  const total = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true);
  const nextPart = () => {
    part += 1;
    data = parts[part];
    position = 0;
    return Boolean(data);
  };
  const ensure = (bytes: number) => {
    if (position + bytes <= data.length) return true;
    if (position === data.length) return nextPart();
    return false;
  };
  while (strings.length < total) {
    if (!ensure(3)) break;
    const cch = data[position] | (data[position + 1] << 8);
    let flags = data[position + 2];
    position += 3;
    let runs = 0;
    let ext = 0;
    if (flags & 0x08) {
      if (!ensure(2)) break;
      runs = data[position] | (data[position + 1] << 8);
      position += 2;
    }
    if (flags & 0x04) {
      if (!ensure(4)) break;
      ext = data[position] | (data[position + 1] << 8) | (data[position + 2] << 16) | (data[position + 3] << 24);
      position += 4;
    }
    let text = "";
    let remaining = cch;
    while (remaining > 0) {
      if (position >= data.length) {
        if (!nextPart()) break;
        flags = data[position];
        position += 1;
      }
      const high = (flags & 0x01) !== 0;
      const available = Math.floor((data.length - position) / (high ? 2 : 1));
      const take = Math.min(remaining, available);
      const slice = data.subarray(position, position + take * (high ? 2 : 1));
      text += high ? utf16(slice) : latin1(slice);
      position += take * (high ? 2 : 1);
      remaining -= take;
      if (take === 0 && !nextPart()) break;
    }
    strings.push(text);
    // Rich-text runs and phonetic data follow; they may also continue into the next record.
    let skip = runs * 4 + ext;
    while (skip > 0 && data) {
      const step = Math.min(skip, data.length - position);
      position += step;
      skip -= step;
      if (skip > 0 && !nextPart()) break;
    }
    if (!data) break;
  }
  return strings;
}

function rkValue(rk: number): number {
  let value: number;
  if (rk & 0x02) value = rk >> 2;
  else {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(0, 0, true);
    buffer.setUint32(4, rk & 0xfffffffc, true);
    value = buffer.getFloat64(0, true);
  }
  return rk & 0x01 ? value / 100 : value;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 45, 46, 47]);
const isDateFormat = isDateFormatCode;

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1e10) / 1e10);
}

export function extractXls(bytes: Uint8Array, options: { maxCellsPerSheet?: number } = {}): IntakeExtract {
  const streams = readCompoundStreams(bytes);
  const stream = streams.get("Workbook") ?? streams.get("Book") ?? streams.get("WORKBOOK") ?? streams.get("BOOK");
  if (!stream) throw new Error("Not an Excel workbook: no Workbook stream.");
  const warnings: string[] = [];
  let biff8 = true;
  let date1904 = false;
  const sheets: Array<{ name: string; offset: number; hidden: boolean }> = [];
  const sstParts: Uint8Array[] = [];
  const formats = new Map<number, string>();
  const xfFormats: number[] = [];
  let inSst = false;
  for (const record of records(stream)) {
    const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);
    if (record.type === 0x0809 && record.offset === 0) biff8 = view.getUint16(0, true) === 0x0600;
    if (record.type === 0x002f) throw new Error("This workbook is password-protected (encrypted).");
    if (record.type === 0x0022) date1904 = view.getUint16(0, true) === 1;
    if (record.type === 0x0085) {
      const name = unicodeString(record.data, 6, biff8, true).text;
      sheets.push({ name, offset: view.getUint32(0, true), hidden: (record.data[4] & 0x03) !== 0 });
      // dt (byte 5): 0 worksheet, 2 chart, 6 VB module; only worksheets hold cells.
      if (record.data[5] !== 0) sheets.pop();
    }
    if (record.type === 0x041e || record.type === 0x001e) {
      const id = view.getUint16(0, true);
      formats.set(id, unicodeString(record.data, 2, biff8, !biff8).text);
    }
    if (record.type === 0x00e0) xfFormats.push(view.getUint16(2, true));
    if (record.type === 0x00fc) {
      inSst = true;
      sstParts.push(record.data);
      continue;
    }
    if (record.type === 0x003c && inSst) {
      sstParts.push(record.data);
      continue;
    }
    inSst = false;
    if (record.type === 0x000a) break; // end of the workbook globals
  }
  const sst = readSst(sstParts);
  const dateXf = (xf: number) => {
    const format = xfFormats[xf];
    if (format === undefined) return false;
    return BUILTIN_DATE_FORMATS.has(format) || (formats.has(format) && isDateFormat(formats.get(format)!));
  };
  const numberText = (value: number, xf: number) => {
    if (dateXf(xf)) {
      const iso = excelSerialToIso(date1904 ? value + 1462 : value);
      if (iso) return iso;
    }
    return formatNumber(value);
  };
  const drafts: DraftBlock[] = [];
  const limit = options.maxCellsPerSheet ?? 20000;
  for (const sheet of sheets) {
    if (sheet.offset <= 0 || sheet.offset >= stream.length) {
      warnings.push(`Sheet ${sheet.name} could not be located.`);
      continue;
    }
    const cells = new Map<number, Map<number, string>>();
    let count = 0;
    let pendingFormula: { row: number; col: number } | undefined;
    const put = (row: number, col: number, value: string) => {
      if (!value.trim()) return;
      if (count >= limit) return;
      count += 1;
      if (!cells.has(row)) cells.set(row, new Map());
      cells.get(row)!.set(col, value);
    };
    let first = true;
    for (const record of records(stream.subarray(sheet.offset))) {
      if (first) {
        first = false;
        if (record.type !== 0x0809) break;
        continue;
      }
      const data = record.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (record.type === 0x000a) break;
      if (data.length < 6) continue;
      const row = view.getUint16(0, true);
      const col = view.getUint16(2, true);
      const xf = view.getUint16(4, true);
      switch (record.type) {
        case 0x00fd: put(row, col, sst[view.getUint32(6, true)] ?? ""); break;
        case 0x0204: case 0x00d6: put(row, col, unicodeString(data, 6, biff8).text); break;
        case 0x0203: put(row, col, numberText(view.getFloat64(6, true), xf)); break;
        case 0x027e: put(row, col, numberText(rkValue(view.getUint32(6, true)), xf)); break;
        case 0x00bd: {
          const last = view.getUint16(data.length - 2, true);
          for (let column = col, position = 4; column <= last && position + 6 <= data.length - 2; column++, position += 6) {
            put(row, column, numberText(rkValue(view.getUint32(position + 2, true)), view.getUint16(position, true)));
          }
          break;
        }
        case 0x0205: if (data[7] === 0) put(row, col, data[6] ? "TRUE" : "FALSE"); break;
        case 0x0006: {
          if (data.length < 14) break;
          if (data[12] === 0xff && data[13] === 0xff) {
            if (data[6] === 0) pendingFormula = { row, col };
            else if (data[6] === 1) put(row, col, data[8] ? "TRUE" : "FALSE");
          } else put(row, col, numberText(view.getFloat64(6, true), xf));
          break;
        }
        default: break;
      }
      if (record.type === 0x0207 && pendingFormula) {
        put(pendingFormula.row, pendingFormula.col, unicodeString(data, 0, biff8).text);
        pendingFormula = undefined;
      }
    }
    if (count >= limit) warnings.push(`Sheet ${sheet.name} truncated at ${limit} cells.`);
    if (!cells.size) continue;
    const maxColumn = Math.max(...[...cells.values()].flatMap((cellsInRow) => [...cellsInRow.keys()]));
    const rows: IntakeRow[] = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([rowIndex, cellsInRow]) => ({
      cells: Array.from({ length: maxColumn + 1 }, (_, column) => ({ text: cellsInRow.get(column) ?? "", cell: `${columnLetters(column)}${rowIndex + 1}` })),
    }));
    drafts.push({ kind: "heading", text: sheet.name, level: 2, sheet: sheet.name, ...(sheet.hidden ? { style: "hidden-sheet" } : {}) });
    drafts.push({ kind: "table", rows, sheet: sheet.name });
  }
  if (!biff8) warnings.push("BIFF5 (Excel 95) workbook: text is read as Windows Latin-1.");
  const { blocks, text } = finalizeBlocks(drafts);
  return { method: "xls-biff8", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, sheetNames: sheets.map((sheet) => sheet.name), warnings };
}
