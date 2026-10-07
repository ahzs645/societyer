/** Synthetic fixtures for OCR and legacy Office readers (no real records).
 *
 * - A "scanned" two-page minutes PDF: synthetic text rendered to a slightly skewed, speckled
 *   greyscale JPEG per page (the second page scanned sideways), embedded as images with no
 *   text layer, the way an office scanner saves a PDF.
 * - A scanned consent form saved as a PNG image.
 * - PPTX and XPS files written from parts; legacy .xls and .ppt converted from them with
 *   LibreOffice when the generator runs (the committed copies make the gate independent of it).
 *
 * Regenerate with `npx tsx scripts/generate-intake-ocr-fixtures.ts` (fonts: DejaVu Sans). */
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

export const OCR_MINUTES_PAGES: string[][] = [
  [
    "Lakeside Clean Air Society",
    "Board of Directors Meeting Minutes",
    "",
    "Date:\tMarch 18, 2025",
    "Time:\t6:00 PM - 7:45 PM",
    "Location:\tNorthport Civic Centre, Room 2",
    "Chair:\tAvery Quill",
    "Present:\tAvery Quill, Robin Vale, Jordan Pike, Morgan Reyes",
    "Regrets:\tCasey Lund",
    "Recorder:\tTaylor Brook",
    "",
    "1. Call to Order",
    "The meeting was called to order at 6:02 PM by Avery Quill.",
    "",
    "2. Approval of the Agenda",
    "MOTION: To approve the agenda as circulated.",
    "Moved by Robin Vale, seconded by Jordan Pike. CARRIED.",
    "",
    "3. Adoption of Previous Minutes",
    "MOTION: To adopt the minutes of February 18, 2025 as presented.",
    "Moved by Morgan Reyes, seconded by Robin Vale. CARRIED.",
  ],
  [
    "4. Air Monitoring Update",
    "Jordan Pike reported that the new monitor at the rail yard is online.",
    "ACTION: Jordan Pike to circulate the quarterly data summary.",
    "",
    "5. Adjournment",
    "The meeting adjourned at 7:45 PM.",
    "Next meeting: April 15, 2025",
  ],
];

export const OCR_CONSENT_LINES = [
  "Lakeside Clean Air Society",
  "Consent to Act as a Director",
  "",
  "I, Robin Vale, consent to act as a director of",
  "Lakeside Clean Air Society effective June 1, 2025.",
  "",
  "Signed: Robin Vale",
  "Date: May 20, 2025",
];

/** Deterministic pseudo-random numbers (speckle noise must not change between runs). */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Canvas = { width: number; height: number; getContext(kind: "2d"): any; toBuffer(mime: string, quality?: number): Buffer };
type CanvasModule = { createCanvas(width: number, height: number): Canvas; GlobalFonts: { registerFromPath(path: string, alias?: string): unknown } };

let fontsReady = false;
async function canvasModule(): Promise<CanvasModule> {
  const module = (await import("@napi-rs/canvas")) as unknown as CanvasModule;
  if (!fontsReady) {
    for (const path of ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]) {
      try {
        module.GlobalFonts.registerFromPath(path, "FixtureSans");
      } catch {
        // the default font is used
      }
    }
    fontsReady = true;
  }
  return module;
}

/** One letter-size page at 200 dpi: off-white paper, dark grey text, a small skew, speckles. */
export async function renderScanPage(lines: string[], options: { seed: number; skewDegrees?: number; rotate?: 0 | 90 | 270; mime?: "image/jpeg" | "image/png" }): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { createCanvas } = await canvasModule();
  const dpi = 200;
  const width = Math.round(8.5 * dpi), height = Math.round(11 * dpi);
  const page = createCanvas(width, height);
  const context = page.getContext("2d");
  context.fillStyle = "#f3f0e8";
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(((options.skewDegrees ?? 0.5) * Math.PI) / 180);
  context.translate(-width / 2, -height / 2);
  context.fillStyle = "#26231f";
  let y = 220;
  const left = 190, tabStop = 520;
  for (const [index, line] of lines.entries()) {
    const heading = index < 2 && !line.includes("\t");
    context.font = `${heading ? "bold " : ""}${heading ? 38 : 31}px FixtureSans, sans-serif`;
    if (line.includes("\t")) {
      const [label, value] = line.split("\t");
      context.fillText(label, left, y);
      context.fillText(value, tabStop, y);
    } else if (line) context.fillText(line, left, y);
    y += line ? 58 : 34;
  }
  context.restore();
  const random = lcg(options.seed);
  context.fillStyle = "rgba(40, 36, 30, 0.55)";
  for (let index = 0; index < 400; index++) context.fillRect(random() * width, random() * height, 1 + random() * 1.5, 1 + random() * 1.5);
  let output = page;
  if (options.rotate) {
    output = createCanvas(height, width);
    const rotated = output.getContext("2d");
    rotated.translate(height / 2, width / 2);
    rotated.rotate((options.rotate * Math.PI) / 180);
    rotated.drawImage(page, -width / 2, -height / 2);
  }
  const mime = options.mime ?? "image/jpeg";
  return { bytes: new Uint8Array(mime === "image/jpeg" ? output.toBuffer(mime, 72) : output.toBuffer(mime)), width: output.width, height: output.height };
}

/** Image-only PDF (no text layer), one image per page; a landscape image gets a landscape page. */
export async function buildScannedPdf(pages: Array<{ bytes: Uint8Array; width: number; height: number }>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const image of pages) {
    const embedded = await pdf.embedJpg(image.bytes);
    const [pageWidth, pageHeight] = image.width > image.height ? [792, 612] : [612, 792];
    pdf.addPage([pageWidth, pageHeight]).drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }
  return pdf.save({ useObjectStreams: false });
}

export async function buildScannedMinutesPdf(): Promise<Uint8Array> {
  const first = await renderScanPage(OCR_MINUTES_PAGES[0], { seed: 7, skewDegrees: 0.6 });
  // The second sheet went through the scanner sideways: its text runs bottom to top.
  const second = await renderScanPage(OCR_MINUTES_PAGES[1], { seed: 11, skewDegrees: -0.4, rotate: 270 });
  return buildScannedPdf([first, second]);
}

export async function buildConsentScanPng(): Promise<Uint8Array> {
  return (await renderScanPage(OCR_CONSENT_LINES, { seed: 3, skewDegrees: -0.8, mime: "image/png" })).bytes;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Minimal PPTX: slides with a title placeholder, body paragraphs and optional table, plus notes. */
export async function buildPptx(slides: Array<{ title: string; body: string[]; table?: string[][]; notes?: string }>): Promise<Uint8Array> {
  const zip = new JSZip();
  const p = (ns: string) => `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"${ns}`;
  const overrides = slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  zip.file("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${overrides}</Types>`);
  zip.file("_rels/.rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file("ppt/presentation.xml", `${XML_HEADER}<p:presentation ${p("")}><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>`);
  slides.forEach((slide, index) => {
    const paragraphs = (lines: string[]) => lines.map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`).join("");
    const table = slide.table ? `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>${slide.table.map((row) => `<a:tr h="370840">${row.map((cell) => `<a:tc><a:txBody><a:bodyPr/>${paragraphs([cell])}</a:txBody></a:tc>`).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>` : "";
    zip.file(`ppt/slides/slide${index + 1}.xml`, `${XML_HEADER}<p:sld ${p("")}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paragraphs([slide.title])}</p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paragraphs(slide.body)}</p:txBody></p:sp>${table}</p:spTree></p:cSld></p:sld>`);
    if (slide.notes) {
      zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${index + 1}.xml"/></Relationships>`);
      zip.file(`ppt/notesSlides/notesSlide${index + 1}.xml`, `${XML_HEADER}<p:notes ${p("")}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paragraphs([slide.notes])}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);
    }
  });
  return zip.generateAsync({ type: "uint8array" });
}

/** Minimal XPS: one fixed page per entry; each line is a glyph run at (x, y) in 1/96 inch. */
export async function buildXps(pages: Array<Array<{ x: number; y: number; text: string; size?: number }>>): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/><Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/><Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`);
  zip.file("FixedDocSeq.fdseq", `<FixedDocumentSequence xmlns="http://schemas.microsoft.com/xps/2005/06"><DocumentReference Source="Documents/1/FixedDoc.fdoc"/></FixedDocumentSequence>`);
  zip.file("Documents/1/FixedDoc.fdoc", `<FixedDocument xmlns="http://schemas.microsoft.com/xps/2005/06">${pages.map((_, index) => `<PageContent Source="Pages/${index + 1}.fpage"/>`).join("")}</FixedDocument>`);
  pages.forEach((runs, index) => {
    const glyphs = runs.map((run) => `<Glyphs OriginX="${run.x}" OriginY="${run.y}" FontRenderingEmSize="${run.size ?? 14.67}" FontUri="/Resources/font.odttf" UnicodeString="${escapeXml(run.text)}" Fill="#FF000000"/>`).join("");
    zip.file(`Documents/1/Pages/${index + 1}.fpage`, `<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="816" Height="1056" xml:lang="en-US"><Canvas RenderTransform="1,0,0,1,0,0">${glyphs}</Canvas></FixedPage>`);
  });
  return zip.generateAsync({ type: "uint8array" });
}
