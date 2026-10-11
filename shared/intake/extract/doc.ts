/** Word 97–2003 (.doc) text without LibreOffice, so a browser-only intake does
 * not have to catalogue legacy minutes unread. Reads the compound file (MS-CFB),
 * the FIB and the piece table (MS-DOC §2.4.1) and returns the main document's
 * paragraphs and tables. Field codes are dropped and field results kept; cell
 * and row marks become table blocks (cells joined by TAB). Character and
 * paragraph formatting are not read, so headings are not distinguished and an
 * empty table cell can end a row early: hosts with LibreOffice convert to DOCX
 * instead (exact tables and page numbers). Word 6/95 files and encrypted files
 * are reported as unsupported. */
import { finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract, type IntakeRow } from "../blocks";

const FREE = 0xffffffff, END_OF_CHAIN = 0xfffffffe;

/** Minimal MS-CFB reader: named streams of the root storage (and nested storages, flattened by name). */
export function readCompoundStreams(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.length < 512 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error("Not an OLE compound file.");
  const sectorSize = 1 << view.getUint16(0x1e, true);
  const miniSectorSize = 1 << view.getUint16(0x20, true);
  const firstDirSector = view.getUint32(0x30, true);
  const miniCutoff = view.getUint32(0x38, true);
  const firstMiniFat = view.getUint32(0x3c, true);
  const miniFatCount = view.getUint32(0x40, true);
  let difatSector = view.getUint32(0x44, true);
  const difatCount = view.getUint32(0x48, true);
  const sectorOffset = (sector: number) => (sector + 1) * sectorSize;
  // DIFAT → FAT sectors.
  const fatSectors: number[] = [];
  for (let index = 0; index < 109; index++) {
    const sector = view.getUint32(0x4c + index * 4, true);
    if (sector !== FREE) fatSectors.push(sector);
  }
  for (let count = 0; count < difatCount && difatSector !== END_OF_CHAIN && difatSector !== FREE; count++) {
    const base = sectorOffset(difatSector);
    for (let index = 0; index < sectorSize / 4 - 1; index++) {
      const sector = view.getUint32(base + index * 4, true);
      if (sector !== FREE) fatSectors.push(sector);
    }
    difatSector = view.getUint32(base + sectorSize - 4, true);
  }
  const fat: number[] = [];
  for (const sector of fatSectors) {
    const base = sectorOffset(sector);
    if (base + sectorSize > bytes.length) break;
    for (let index = 0; index < sectorSize / 4; index++) fat.push(view.getUint32(base + index * 4, true));
  }
  const chain = (start: number, table: number[], limit = 1 << 20) => {
    const out: number[] = [];
    for (let sector = start; sector !== END_OF_CHAIN && sector !== FREE && sector < table.length && out.length < limit; sector = table[sector]) {
      if (out.includes(sector)) break; // corrupt (cyclic) chain
      out.push(sector);
    }
    return out;
  };
  const readChain = (start: number, size: number) => {
    const out = new Uint8Array(size);
    let written = 0;
    for (const sector of chain(start, fat)) {
      const base = sectorOffset(sector);
      const take = Math.min(sectorSize, size - written, bytes.length - base);
      if (take <= 0) break;
      out.set(bytes.subarray(base, base + take), written);
      written += take;
      if (written >= size) break;
    }
    return out;
  };
  // Directory.
  const dirSectors = chain(firstDirSector, fat);
  const dirBytes = new Uint8Array(dirSectors.length * sectorSize);
  dirSectors.forEach((sector, index) => dirBytes.set(bytes.subarray(sectorOffset(sector), sectorOffset(sector) + sectorSize), index * sectorSize));
  const dirView = new DataView(dirBytes.buffer);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let offset = 0; offset + 128 <= dirBytes.length; offset += 128) {
    const nameLength = dirView.getUint16(offset + 64, true);
    let name = "";
    for (let index = 0; index + 2 < nameLength && index < 64; index += 2) name += String.fromCharCode(dirView.getUint16(offset + index, true));
    entries.push({ name, type: dirView.getUint8(offset + 66), start: dirView.getUint32(offset + 116, true), size: dirView.getUint32(offset + 120, true) });
  }
  const root = entries[0];
  const miniStream = root ? readChain(root.start, root.size) : new Uint8Array();
  const miniFat: number[] = [];
  if (miniFatCount) {
    const miniFatBytes = readChain(firstMiniFat, miniFatCount * sectorSize);
    const miniView = new DataView(miniFatBytes.buffer);
    for (let index = 0; index < miniFatBytes.length / 4; index++) miniFat.push(miniView.getUint32(index * 4, true));
  }
  const streams = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.type !== 2 || !entry.name) continue;
    if (entry.size < miniCutoff) {
      const out = new Uint8Array(entry.size);
      let written = 0;
      for (const sector of chain(entry.start, miniFat)) {
        const base = sector * miniSectorSize;
        const take = Math.min(miniSectorSize, entry.size - written, miniStream.length - base);
        if (take <= 0) break;
        out.set(miniStream.subarray(base, base + take), written);
        written += take;
      }
      streams.set(entry.name, out);
    } else streams.set(entry.name, readChain(entry.start, entry.size));
  }
  return streams;
}

/** Windows-1252 bytes 0x80–0x9F (curly quotes, dashes, bullet …); other bytes are Latin-1.
 * Decoded by hand: some runtimes' TextDecoder("windows-1252") falls back to Latin-1. */
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const cp1252 = {
  decode(bytes: Uint8Array): string {
    let out = "";
    for (let index = 0; index < bytes.length; index += 4096) {
      out += String.fromCharCode(...Array.from(bytes.subarray(index, index + 4096), (byte) => (byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH.charCodeAt(byte - 0x80) : byte)));
    }
    return out;
  },
};

/** Marks a table row end (a 0x07 whose paragraph has fTtp); field stripping keeps it. */
const ROW_END = "\uE000";
/** Paragraph mark of a list paragraph at level n (0–8): U+E001 + n. */
const LIST_END_BASE = 0xe001;

type Piece = { cpStart: number; cpEnd: number; fc: number; compressed: boolean };
type ParagraphRun = { start: number; end: number; rowEnd: boolean; listLevel?: number };

/** Paragraph runs (by file offset) with the properties the text needs: table row end
 * (sprmPFTtp / sprmPFInnerTtp) and list membership (sprmPIlfo, level from sprmPIlvl). */
function paragraphRuns(word: Uint8Array, table: Uint8Array, fcPlc: number, lcbPlc: number): ParagraphRun[] {
  if (!lcbPlc || fcPlc + lcbPlc > table.length) return [];
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const wordView = new DataView(word.buffer, word.byteOffset, word.byteLength);
  const pages = Math.floor((lcbPlc - 4) / 8);
  const runs: ParagraphRun[] = [];
  for (let index = 0; index < pages; index++) {
    const pn = view.getUint32(fcPlc + (pages + 1) * 4 + index * 4, true) & 0x3fffff;
    const base = pn * 512;
    if (base + 512 > word.length) continue;
    const crun = word[base + 511];
    for (let run = 0; run < crun; run++) {
      const start = wordView.getUint32(base + run * 4, true);
      const end = wordView.getUint32(base + (run + 1) * 4, true);
      const bOffset = word[base + (crun + 1) * 4 + run * 13];
      if (!bOffset) continue;
      let at = base + bOffset * 2;
      let size = word[at] * 2 - 1;
      at += 1;
      if (word[at - 1] === 0) { size = word[at] * 2; at += 1; }
      // GrpPrlAndIstd: istd (2 bytes), then sprms.
      let cursor = at + 2;
      const limit = Math.min(at + size, base + 511);
      let rowEnd = false, ilfo = 0, ilvl = 0;
      while (cursor + 2 <= limit) {
        const sprm = wordView.getUint16(cursor, true);
        cursor += 2;
        if ((sprm === 0x2417 || sprm === 0x244c) && word[cursor] === 1) rowEnd = true;
        if (sprm === 0x460b) ilfo = wordView.getInt16(cursor, true);
        if (sprm === 0x260a) ilvl = word[cursor];
        const spra = sprm >> 13;
        const operand = spra === 0 || spra === 1 ? 1 : spra === 2 || spra === 4 || spra === 5 ? 2 : spra === 3 ? 4 : spra === 7 ? 3
          : sprm === 0xd608 || sprm === 0xc615 ? wordView.getUint16(cursor, true) + 1 : word[cursor] + 1;
        cursor += operand;
      }
      if (rowEnd || ilfo > 0) runs.push({ start, end, rowEnd, ...(ilfo > 0 ? { listLevel: Math.min(8, ilvl) } : {}) });
    }
  }
  return runs.sort((a, b) => a.start - b.start);
}

/** The document's character stream (CP order) from the piece table, with table row ends and list paragraphs marked. */
function pieceText(word: Uint8Array, table: Uint8Array, fcClx: number, lcbClx: number, runs: ParagraphRun[]): string {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let pos = fcClx;
  const end = Math.min(table.length, fcClx + lcbClx);
  while (pos < end && table[pos] === 0x01) pos += 3 + view.getInt16(pos + 1, true); // Prc (property modifiers)
  if (table[pos] !== 0x02) throw new Error("The piece table is missing.");
  const lcb = view.getUint32(pos + 1, true);
  const plc = pos + 5;
  const count = Math.floor((lcb - 4) / 12);
  const wordView = new DataView(word.buffer, word.byteOffset, word.byteLength);
  const pieces: Piece[] = [];
  for (let index = 0; index < count; index++) {
    const fcValue = view.getUint32(plc + (count + 1) * 4 + index * 8 + 2, true);
    const compressed = Boolean(fcValue & 0x40000000);
    pieces.push({ cpStart: view.getUint32(plc + index * 4, true), cpEnd: view.getUint32(plc + (index + 1) * 4, true), fc: compressed ? (fcValue & 0x3fffffff) / 2 : fcValue & 0x3fffffff, compressed });
  }
  const runAt = (fc: number): ParagraphRun | undefined => {
    let low = 0, high = runs.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (fc < runs[mid].start) high = mid - 1;
      else if (fc >= runs[mid].end) low = mid + 1;
      else return runs[mid];
    }
    return undefined;
  };
  let text = "";
  for (const piece of pieces) {
    const length = piece.cpEnd - piece.cpStart;
    if (length <= 0) continue;
    let chunk = piece.compressed
      ? cp1252.decode(word.subarray(piece.fc, Math.min(word.length, piece.fc + length)))
      : Array.from({ length: Math.max(0, Math.min(length, Math.floor((word.length - piece.fc) / 2))) }, (_, offset) => String.fromCharCode(wordView.getUint16(piece.fc + offset * 2, true))).join("");
    if (runs.length) {
      chunk = chunk.replace(/[\r\x07]/g, (mark, offset: number) => {
        const run = runAt(piece.fc + offset * (piece.compressed ? 1 : 2));
        if (mark === "\x07") return run?.rowEnd ? ROW_END : mark;
        return run?.listLevel !== undefined ? String.fromCharCode(LIST_END_BASE + run.listLevel) : mark;
      });
    }
    text += chunk;
  }
  return text;
}

/** Field instructions (between 0x13 and 0x14) are dropped; field results (0x14…0x15) kept. */
function stripFields(text: string): string {
  let out = "";
  const stack: boolean[] = []; // per open field: still inside its instruction part?
  for (const char of text) {
    if (char === "\x13") { stack.push(true); continue; }
    if (char === "\x14") { if (stack.length) stack[stack.length - 1] = false; continue; }
    if (char === "\x15") { stack.pop(); continue; }
    if (stack.some((inInstruction) => inInstruction)) continue;
    out += char;
  }
  return out;
}

const clean = (value: string) => value
  .replace(/[\x01\x02\x05\x08]/g, "") // pictures, footnote/annotation marks, drawn objects
  .replace(/\x1e/g, "-").replace(/\x1f/g, "").replace(/\x0b/g, "\n").replace(/\u00a0/g, " ")
  .replace(/[ \t]+\n/g, "\n").trimEnd();

/** Paragraphs and tables of the main document text. A cell ends with 0x07 and a row
 * with one more 0x07; paragraphs inside an open row belong to its next cell. */
export function docTextToBlocks(main: string): DraftBlock[] {
  const drafts: DraftBlock[] = [];
  let page = 1;
  let rows: IntakeRow[] = [];
  let cells: string[] = [];
  let pending: string[] = [];
  let lastWasCell = false;
  const closeRow = () => {
    if (cells.length) rows.push({ cells: cells.map((text, index) => ({ text, cell: `R${rows.length + 1}C${index + 1}` })) });
    cells = [];
  };
  const flushTable = () => {
    closeRow();
    // Merged cells are not read: a row with fewer cells than the table's widest row is taken to
    // merge its first cells ("Agenda item" over the number and title columns), so columns line up.
    const width = Math.max(0, ...rows.map((row) => row.cells.length));
    rows.forEach((row, rowIndex) => {
      if (row.cells.length < width && row.cells.length) row.cells[0] = { ...row.cells[0], colSpan: width - row.cells.length + 1 };
      let column = 1;
      row.cells = row.cells.map((cell) => {
        const placed = { ...cell, cell: `R${rowIndex + 1}C${column}` };
        column += cell.colSpan ?? 1;
        return placed;
      });
    });
    if (rows.length) drafts.push({ kind: "table", rows, page });
    rows = [];
    for (const paragraph of pending) drafts.push({ kind: "paragraph", text: paragraph, page });
    pending = [];
  };
  // With paragraph properties read, row ends are marked exactly; otherwise an empty mark right after a cell ends the row.
  const exactRows = main.includes(ROW_END);
  for (const unit of main.split(/(?<=[\r\x07\x0c\uE000-\uE009])/)) {
    const mark = unit.slice(-1);
    const body = clean(/[\r\x07\x0c\uE000-\uE009]/.test(mark) ? unit.slice(0, -1) : unit);
    const listLevel = mark >= "\uE001" && mark <= "\uE009" ? mark.charCodeAt(0) - LIST_END_BASE : undefined;
    if (mark === ROW_END || (mark === "\x07" && !exactRows && !body.trim() && lastWasCell && !pending.length)) {
      closeRow();
      lastWasCell = false;
      continue;
    }
    if (mark === "\x07") {
      cells.push([...pending, body].filter((part) => part.trim()).join("\n").trim());
      pending = [];
      lastWasCell = true;
      continue;
    }
    lastWasCell = false;
    if (cells.length) {
      if (body.trim()) pending.push(body); // a paragraph inside the open row's next cell
    } else {
      if (rows.length) flushTable(); // a paragraph after a closed row ends the table
      if (body.trim()) drafts.push(listLevel !== undefined ? { kind: "list_item", level: listLevel, text: body, page } : { kind: "paragraph", text: body, page });
    }
    if (mark === "\x0c") {
      flushTable();
      drafts.push({ kind: "page_break", page });
      page += 1;
    }
  }
  flushTable();
  return drafts;
}

export function extractDoc(bytes: Uint8Array): IntakeExtract {
  const streams = readCompoundStreams(bytes);
  const word = streams.get("WordDocument");
  if (!word || word.length < 0x200) throw new Error("No WordDocument stream: not a Word 97–2003 document.");
  const view = new DataView(word.buffer, word.byteOffset, word.byteLength);
  if (view.getUint16(0, true) !== 0xa5ec) throw new Error("Unrecognised Word file header.");
  const nFib = view.getUint16(2, true);
  if (nFib < 101) throw new Error("Word 6/95 documents are not supported without LibreOffice.");
  const flags = view.getUint16(0x0a, true);
  if (flags & 0x0100) throw new Error("The document is encrypted (password-protected).");
  const table = streams.get(flags & 0x0200 ? "1Table" : "0Table");
  if (!table) throw new Error("The Word table stream is missing.");
  const csw = view.getUint16(32, true);
  const lwBase = 34 + csw * 2 + 2;
  const cslw = view.getUint16(34 + csw * 2, true);
  const ccpText = cslw > 3 ? view.getUint32(lwBase + 3 * 4, true) : 0;
  const fcLcbBase = lwBase + cslw * 4 + 2;
  const fcClx = view.getUint32(fcLcbBase + 33 * 8, true);
  const lcbClx = view.getUint32(fcLcbBase + 33 * 8 + 4, true);
  if (!lcbClx) throw new Error("The Word piece table is empty.");
  const fcPapx = view.getUint32(fcLcbBase + 13 * 8, true);
  const lcbPapx = view.getUint32(fcLcbBase + 13 * 8 + 4, true);
  let runs: ParagraphRun[] = [];
  try { runs = paragraphRuns(word, table, fcPapx, lcbPapx); } catch { runs = []; }
  const all = pieceText(word, table, fcClx, lcbClx, runs);
  const main = stripFields(ccpText > 0 ? all.slice(0, ccpText) : all);
  const { blocks, text } = finalizeBlocks(docTextToBlocks(main));
  return {
    method: "doc-binary", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text,
    warnings: ["Read directly from the Word 97–2003 file without LibreOffice: headings are not distinguished and table layout is approximate (the desktop app converts with LibreOffice for exact tables)."],
  };
}
