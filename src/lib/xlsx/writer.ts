import JSZip from "jszip";
import { buildXlsxParts } from "./build";
import type { XlsxWorkbook } from "./types";

/** Package order: content types first, as Office writes it (some readers sniff it). */
const PART_ORDER = ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "docProps/app.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"];

/** A complete .xlsx file. Imported lazily (it pulls in JSZip) — use `downloadXlsx` from "./index" in UI code. */
export async function writeXlsx(workbook: XlsxWorkbook): Promise<Uint8Array> {
  const parts = buildXlsxParts(workbook);
  const zip = new JSZip();
  const date = workbook.created ?? new Date();
  const names = [...PART_ORDER.filter((name) => name in parts), ...Object.keys(parts).filter((name) => !PART_ORDER.includes(name))];
  for (const name of names) zip.file(name, parts[name], { date, createFolders: false });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
