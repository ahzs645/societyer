/** Builds a minimal synthetic Word 97–2003 (.doc) file for gates: an OLE compound
 * file with a WordDocument stream (FIB, one compressed text piece, one PAPX FKP)
 * and a 1Table stream (piece table + PlcBtePapx). Paragraph runs can mark a table
 * row end (sprmPFTtp) or a list paragraph (sprmPIlfo/sprmPIlvl). Synthetic only. */

type Paragraph = { text: string; mark?: "\r" | "\x07"; rowEnd?: boolean; listLevel?: number };

const SECTOR = 512;

function u16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function u32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }

/** Windows-1252 encoding for the few characters the fixtures use. */
function cp1252(text: string): number[] {
  const high: Record<string, number> = { "–": 0x96, "—": 0x97, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95 };
  return [...text].map((char) => high[char] ?? (char.charCodeAt(0) < 256 ? char.charCodeAt(0) : 0x3f));
}

export function buildLegacyDoc(paragraphs: Paragraph[]): Uint8Array {
  // ---- text: one compressed piece at TEXT_FC in WordDocument
  const TEXT_FC = 0x800; // after the FIB
  const chars: number[] = [];
  const marks: Array<{ fc: number; rowEnd?: boolean; listLevel?: number }> = [];
  for (const paragraph of paragraphs) {
    chars.push(...cp1252(paragraph.text));
    marks.push({ fc: TEXT_FC + chars.length, rowEnd: paragraph.rowEnd, listLevel: paragraph.listLevel });
    chars.push((paragraph.mark ?? "\r").charCodeAt(0));
  }
  const ccpText = chars.length;
  // ---- PAPX FKP page (one page) after the text
  const fkpPage = Math.ceil((TEXT_FC + chars.length) / SECTOR) + 1;
  const runs: Array<{ start: number; end: number; grpprl: number[] }> = [];
  let cursor = TEXT_FC;
  for (const mark of marks) {
    const grpprl: number[] = [];
    if (mark.rowEnd) grpprl.push(0x17, 0x24, 1); // sprmPFTtp
    if (mark.listLevel !== undefined) grpprl.push(0x0b, 0x46, 1, 0, 0x0a, 0x26, mark.listLevel); // sprmPIlfo = 1, sprmPIlvl
    runs.push({ start: cursor, end: mark.fc + 1, grpprl });
    cursor = mark.fc + 1;
  }
  const word = new Uint8Array(Math.max(8 * SECTOR, (fkpPage + 1) * SECTOR));
  const wv = new DataView(word.buffer);
  // FIB
  u16(wv, 0, 0xa5ec); u16(wv, 2, 193); u16(wv, 0x0a, 0x0200); // nFib Word 97, fWhichTblStm = 1Table
  u16(wv, 32, 14); // csw
  u16(wv, 34 + 28, 22); // cslw
  u32(wv, 64 + 3 * 4, ccpText); // ccpText
  u16(wv, 64 + 88, 93); // cbRgFcLcb
  const fcLcb = 64 + 88 + 2;
  word.set(chars, TEXT_FC);
  // FKP: rgfc (crun + 1), BxPap (13 bytes each), PAPX from the end of the page.
  const base = fkpPage * SECTOR;
  const crun = runs.length;
  runs.forEach((run, index) => u32(wv, base + index * 4, run.start));
  u32(wv, base + crun * 4, runs[runs.length - 1].end);
  let papxAt = SECTOR - 2;
  runs.forEach((run, index) => {
    const bytes = [0, 0, ...run.grpprl]; // istd 0, then sprms
    if (bytes.length % 2 === 0) bytes.push(0);
    const cb = (bytes.length + 1) / 2;
    papxAt -= bytes.length + 1;
    papxAt -= papxAt % 2;
    word[base + papxAt] = cb;
    word.set(bytes, base + papxAt + 1);
    word[base + (crun + 1) * 4 + index * 13] = papxAt / 2;
  });
  word[base + 511] = crun;
  // ---- 1Table: Clx (Pcdt with one PCD) and PlcBtePapx (one page)
  const table = new Uint8Array(8 * SECTOR);
  const tv = new DataView(table.buffer);
  const clxAt = 0x100;
  table[clxAt] = 0x02;
  u32(tv, clxAt + 1, 4 * 2 + 8);
  u32(tv, clxAt + 5, 0); u32(tv, clxAt + 9, ccpText); // CPs
  u32(tv, clxAt + 13 + 2, ((TEXT_FC * 2) | 0x40000000) >>> 0); // PCD: compressed fc
  u32(wv, fcLcb + 33 * 8, clxAt); u32(wv, fcLcb + 33 * 8 + 4, 1 + 4 + 16);
  const papxPlcAt = 0x200;
  u32(tv, papxPlcAt, runs[0].start); u32(tv, papxPlcAt + 4, runs[runs.length - 1].end); u32(tv, papxPlcAt + 8, fkpPage);
  u32(wv, fcLcb + 13 * 8, papxPlcAt); u32(wv, fcLcb + 13 * 8 + 4, 12);
  return compoundFile([["WordDocument", word], ["1Table", table]]);
}

/** OLE compound file with regular (non-mini) streams only; every stream is ≥ 4096 bytes. */
function compoundFile(streams: Array<[string, Uint8Array]>): Uint8Array {
  const dataSectors = streams.map(([, data]) => Math.ceil(data.length / SECTOR));
  const dirSectors = 1;
  const totalData = dataSectors.reduce((sum, count) => sum + count, 0) + dirSectors;
  const fatSectors = Math.ceil((totalData + 1) / (SECTOR / 4)) || 1;
  const sectorCount = fatSectors + dirSectors + dataSectors.reduce((sum, count) => sum + count, 0);
  const out = new Uint8Array((sectorCount + 1) * SECTOR);
  const view = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  u16(view, 0x18, 0x3e); u16(view, 0x1a, 3); u16(view, 0x1c, 0xfffe); u16(view, 0x1e, 9); u16(view, 0x20, 6);
  u32(view, 0x2c, fatSectors); u32(view, 0x30, fatSectors); u32(view, 0x38, 4096); u32(view, 0x3c, 0xfffffffe); u32(view, 0x44, 0xfffffffe);
  for (let index = 0; index < 109; index++) u32(view, 0x4c + index * 4, index < fatSectors ? index : 0xffffffff);
  const fat: number[] = [];
  for (let index = 0; index < fatSectors; index++) fat.push(0xfffffffd);
  fat.push(0xfffffffe); // directory (one sector)
  const starts: number[] = [];
  for (const count of dataSectors) {
    starts.push(fat.length);
    for (let index = 0; index < count; index++) fat.push(index === count - 1 ? 0xfffffffe : fat.length + 1);
  }
  fat.forEach((value, index) => u32(view, SECTOR + index * 4, value));
  for (let index = fat.length; index < fatSectors * (SECTOR / 4); index++) u32(view, SECTOR + index * 4, 0xffffffff);
  // Directory: root + streams (flat: root's child is the first stream; siblings chained right).
  const dir = (fatSectors + 1) * SECTOR;
  const entry = (index: number, name: string, type: number, start: number, size: number, child: number, right: number) => {
    const at = dir + index * 128;
    [...name].forEach((char, offset) => u16(view, at + offset * 2, char.charCodeAt(0)));
    u16(view, at + 64, (name.length + 1) * 2);
    out[at + 66] = type; out[at + 67] = 1;
    u32(view, at + 68, 0xffffffff); u32(view, at + 72, right); u32(view, at + 76, child);
    u32(view, at + 116, start); u32(view, at + 120, size);
  };
  entry(0, "Root Entry", 5, 0xfffffffe, 0, 1, 0xffffffff);
  streams.forEach(([name, data], index) => entry(index + 1, name, 2, starts[index], data.length, 0xffffffff, index + 2 <= streams.length ? index + 2 : 0xffffffff));
  for (let index = streams.length + 1; index < 4; index++) entry(index, "", 0, 0, 0, 0xffffffff, 0xffffffff);
  streams.forEach(([, data], index) => out.set(data, (starts[index] + 1) * SECTOR));
  return out;
}
