import JSZip from "jszip";

/**
 * Minimal, read-only XLSX → table conversion for the document preview
 * (finding D-02). Only cell text is read (shared strings, inline strings,
 * numbers, booleans); formulas show their cached value. Output is plain
 * strings rendered as text by React, never HTML.
 */
export type SheetPreview = { name: string; rows: string[][]; truncated: boolean };

const MAX_SHEETS = 4;
const MAX_ROWS = 200;
const MAX_COLS = 30;

function columnIndex(ref: string) {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function textOf(node: Element | null | undefined) {
  if (!node) return "";
  // Rich text runs (<r><t>) and plain <t>.
  const runs = node.getElementsByTagName("t");
  if (runs.length) return Array.from(runs).map((t) => t.textContent ?? "").join("");
  return node.textContent ?? "";
}

export async function xlsxToSheets(bytes: ArrayBuffer): Promise<SheetPreview[]> {
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  const read = async (path: string) => {
    const file = zip.file(path);
    return file ? parser.parseFromString(await file.async("string"), "application/xml") : null;
  };
  const shared = await read("xl/sharedStrings.xml");
  const sharedStrings = shared ? Array.from(shared.getElementsByTagName("si")).map((si) => textOf(si)) : [];
  const workbook = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  for (const rel of Array.from(rels?.getElementsByTagName("Relationship") ?? [])) {
    const target = rel.getAttribute("Target") ?? "";
    targets.set(rel.getAttribute("Id") ?? "", target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const sheetEntries = Array.from(workbook?.getElementsByTagName("sheet") ?? []).map((sheet, index) => ({
    name: sheet.getAttribute("name") ?? `Sheet ${index + 1}`,
    path: targets.get(sheet.getAttribute("r:id") ?? sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "") ?? `xl/worksheets/sheet${index + 1}.xml`,
  }));
  const sheets: SheetPreview[] = [];
  for (const entry of sheetEntries.slice(0, MAX_SHEETS)) {
    const doc = await read(entry.path);
    if (!doc) continue;
    const rows: string[][] = [];
    let truncated = false;
    for (const row of Array.from(doc.getElementsByTagName("row"))) {
      if (rows.length >= MAX_ROWS) { truncated = true; break; }
      const cells: string[] = [];
      for (const cell of Array.from(row.getElementsByTagName("c"))) {
        const col = columnIndex(cell.getAttribute("r") ?? "");
        if (col >= MAX_COLS) { truncated = true; continue; }
        const type = cell.getAttribute("t");
        let value = "";
        if (type === "s") value = sharedStrings[Number(textOf(cell.getElementsByTagName("v")[0]))] ?? "";
        else if (type === "inlineStr") value = textOf(cell.getElementsByTagName("is")[0]);
        else if (type === "b") value = textOf(cell.getElementsByTagName("v")[0]) === "1" ? "TRUE" : "FALSE";
        else value = textOf(cell.getElementsByTagName("v")[0]);
        while (cells.length < col) cells.push("");
        cells[col] = value;
      }
      if (cells.some((cell) => cell.trim())) rows.push(cells);
    }
    sheets.push({ name: entry.name, rows, truncated });
  }
  if (sheetEntries.length > MAX_SHEETS) sheets.push({ name: `${sheetEntries.length - MAX_SHEETS} more sheet(s) not shown`, rows: [], truncated: true });
  return sheets;
}
