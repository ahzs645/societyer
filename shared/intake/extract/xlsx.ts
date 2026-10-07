/** XLSX → one table block per sheet, every cell keeping its A1 reference.
 * Formulas are not evaluated: the cached value Excel saved is used. */
import JSZip from "jszip";
import { finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract, type IntakeRow } from "../blocks";
import { attr, childrenNamed, descendants, firstChild, isNode, parseXml, textContent } from "../xml";

export function columnLetters(index: number): string {
  let value = index + 1;
  let out = "";
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}
export function columnIndex(letters: string): number {
  let value = 0;
  for (const char of letters.toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

/** Excel serial date (1900 system) → ISO date. */
export function excelSerialToIso(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return undefined;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180]);

export async function extractXlsx(bytes: Uint8Array | ArrayBuffer, options: { maxCellsPerSheet?: number } = {}): Promise<IntakeExtract> {
  const zip = await JSZip.loadAsync(bytes);
  const warnings: string[] = [];
  const read = async (path: string) => zip.file(path)?.async("string");
  const workbookXml = await read("xl/workbook.xml");
  if (!workbookXml) throw new Error("Not a spreadsheet: xl/workbook.xml is missing.");
  const shared: string[] = [];
  const sharedXml = await read("xl/sharedStrings.xml");
  if (sharedXml) {
    const root = parseXml(sharedXml).children.find(isNode);
    if (root) for (const si of childrenNamed(root, "si")) shared.push(descendants(si, "t").filter((t) => !descendants(si, "rPh").some((phonetic) => descendants(phonetic, "t").includes(t))).map(textContent).join(""));
  }
  // Number formats that render as dates.
  const dateStyles = new Set<number>();
  const stylesXml = await read("xl/styles.xml");
  if (stylesXml) {
    const root = parseXml(stylesXml).children.find(isNode);
    const customDateFormats = new Set<number>();
    for (const fmt of descendants(root ?? { name: "", attrs: {}, children: [] }, "numFmt")) {
      if (/[dy]/i.test(attr(fmt, "formatCode") ?? "") && !/\[h\]|h:mm/i.test(attr(fmt, "formatCode") ?? "")) customDateFormats.add(Number(attr(fmt, "numFmtId")));
    }
    const cellXfs = root ? firstChild(root, "cellXfs") : undefined;
    childrenNamed(cellXfs ?? { name: "", attrs: {}, children: [] }, "xf").forEach((xf, index) => {
      const id = Number(attr(xf, "numFmtId") ?? 0);
      if ((id >= 14 && id <= 22) || customDateFormats.has(id) || (DATE_FORMAT_IDS.has(id) && customDateFormats.has(id))) dateStyles.add(index);
    });
  }
  const rels = new Map<string, string>();
  const relsXml = await read("xl/_rels/workbook.xml.rels");
  if (relsXml) for (const rel of descendants(parseXml(relsXml), "Relationship")) rels.set(attr(rel, "Id") ?? "", attr(rel, "Target") ?? "");
  const sheets = descendants(parseXml(workbookXml), "sheet").map((sheet) => ({ name: attr(sheet, "name") ?? "Sheet", target: rels.get(attr(sheet, "id") ?? "") ?? "", hidden: attr(sheet, "state") === "hidden" || attr(sheet, "state") === "veryHidden" }));
  const drafts: DraftBlock[] = [];
  const limit = options.maxCellsPerSheet ?? 20000;
  for (const sheet of sheets) {
    const path = sheet.target.startsWith("/") ? sheet.target.slice(1) : `xl/${sheet.target.replace(/^\.\//, "")}`;
    const xml = await read(path);
    if (!xml) {
      warnings.push(`Sheet ${sheet.name} could not be read.`);
      continue;
    }
    const root = parseXml(xml);
    const rowsByIndex = new Map<number, Map<number, string>>();
    let cellCount = 0;
    for (const c of descendants(root, "c")) {
      if (cellCount >= limit) {
        warnings.push(`Sheet ${sheet.name} truncated at ${limit} cells.`);
        break;
      }
      const ref = attr(c, "r") ?? "";
      const match = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!match) continue;
      const type = attr(c, "t");
      const v = firstChild(c, "v");
      let value = "";
      if (type === "s") value = shared[Number(v ? textContent(v) : -1)] ?? "";
      else if (type === "inlineStr") value = descendants(c, "t").map(textContent).join("");
      else if (type === "b") value = v && textContent(v) === "1" ? "TRUE" : "FALSE";
      else if (v) {
        value = textContent(v);
        const style = Number(attr(c, "s") ?? -1);
        if (type !== "str" && type !== "e" && dateStyles.has(style)) value = excelSerialToIso(Number(value)) ?? value;
      }
      if (!value.trim()) continue;
      cellCount += 1;
      const rowIndex = Number(match[2]);
      if (!rowsByIndex.has(rowIndex)) rowsByIndex.set(rowIndex, new Map());
      rowsByIndex.get(rowIndex)!.set(columnIndex(match[1]), value);
    }
    if (!rowsByIndex.size) continue;
    const maxColumn = Math.max(...[...rowsByIndex.values()].flatMap((row) => [...row.keys()]));
    const rows: IntakeRow[] = [...rowsByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([rowIndex, cells]) => ({
      cells: Array.from({ length: maxColumn + 1 }, (_, column) => ({ text: cells.get(column) ?? "", cell: `${columnLetters(column)}${rowIndex}` })),
    }));
    drafts.push({ kind: "heading", text: sheet.name, level: 2, sheet: sheet.name, ...(sheet.hidden ? { style: "hidden-sheet" } : {}) });
    drafts.push({ kind: "table", rows, sheet: sheet.name });
  }
  const { blocks, text } = finalizeBlocks(drafts);
  return { method: "xlsx-ooxml", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, sheetNames: sheets.map((sheet) => sheet.name), warnings };
}
