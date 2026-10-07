/** Renders the committed synthetic golden fixture (tests/fixtures/intake) into
 * real DOCX / PDF / text files so evaluation exercises the full extraction path. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { GoldenSet } from "../../shared/intake/eval";

type Cell = string | { text: string; span?: number };
type DocxContent = Array<{ p?: string; li?: string; level?: number; table?: Cell[][] }>;

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function runs(text: string): string {
  return text.split("\t").map((part, index) => `${index ? "<w:r><w:tab/></w:r>" : ""}${part ? `<w:r><w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>` : ""}`).join("");
}
function paragraph(text: string, list?: number): string {
  const props = list === undefined ? "" : `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${list}"/><w:numId w:val="1"/></w:numPr></w:pPr>`;
  return `<w:p>${props}${runs(text)}</w:p>`;
}
function table(rows: Cell[][]): string {
  const body = rows.map((row) => `<w:tr>${row.map((cell) => {
    const text = typeof cell === "string" ? cell : cell.text;
    const span = typeof cell === "string" ? 1 : cell.span ?? 1;
    const lines = text.split("\n");
    return `<w:tc><w:tcPr>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}</w:tcPr>${lines.map((line) => paragraph(line)).join("") || "<w:p/>"}</w:tc>`;
  }).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${body}</w:tbl>`;
}

export async function buildDocx(content: DocxContent): Promise<Uint8Array> {
  const body = content.map((item) => (item.table ? table(item.table) : item.li !== undefined ? paragraph(item.li, item.level ?? 0) : paragraph(item.p ?? ""))).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

export async function buildPdf(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([612, 792]);
  let y = 740;
  for (const line of lines) {
    if (y < 60) {
      page = pdf.addPage([612, 792]);
      y = 740;
    }
    if (!line) {
      y -= 12;
      continue;
    }
    // TAB-separated content is drawn as two real columns (title | discussion), as Word tables export.
    const [left, right] = line.replace(/[–]/g, "-").split("\t");
    if (left) page.drawText(left, { x: 54, y, size: 10, font });
    if (right) page.drawText(right, { x: 160, y, size: 9, font });
    y -= 14;
  }
  return pdf.save();
}

export async function writeSyntheticFixtures(dir: string): Promise<{ golden: GoldenSet; files: Record<string, string> }> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(here, "../../tests/fixtures/intake/synthetic-golden.json");
  const golden = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as GoldenSet & { documents: Array<GoldenSet["documents"][number] & { content: unknown }> };
  const files: Record<string, string> = {};
  for (const doc of golden.documents) {
    const file = path.join(dir, doc.source.fileName);
    const format = String(doc.source.format ?? path.extname(doc.source.fileName).slice(1));
    if (format === "docx") fs.writeFileSync(file, await buildDocx(doc.content as DocxContent));
    else if (format === "pdf") fs.writeFileSync(file, await buildPdf(doc.content as string[]));
    else fs.writeFileSync(file, String(doc.content));
    files[doc.id] = file;
  }
  return { golden, files };
}
