/** Synthetic, local-only UI regression: the shared dialog needs no storage provider. */
import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { PDFDocument, StandardFonts } from "pdf-lib";
import JSZip from "jszip";
import { FilePreviewDialog } from "../../src/components/FilePreviewDialog";
import { DocumentPreviewPane } from "../../src/components/DocumentPreviewPane";
import "../../src/theme/palette.css";
import "../../src/theme/tokens.css";
import "../../src/styles/index.scss";
let pdf: Promise<ArrayBuffer> | undefined;
function fixturePdf() {
  pdf ??= (async () => {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const index of [1, 2]) doc.addPage([612, 792]).drawText(`Shared preview fixture - page ${index}`, { x: 45, y: 720, size: 18, font });
    return (await doc.save()).buffer as ArrayBuffer;
  })();
  return pdf;
}
let longPdf: Promise<ArrayBuffer> | undefined;
/** 120 pages for the lazy, windowed renderer; page 60 is landscape. */
function fixtureLongPdf() {
  longPdf ??= (async () => {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let index = 1; index <= 120; index++) {
      const page = doc.addPage(index === 60 ? [792, 612] : [612, 792]);
      page.drawText(`Long fixture - page ${index}`, { x: 45, y: page.getHeight() - 72, size: 22, font });
      for (let line = 0; line < 30; line++) page.drawText(`Line ${line + 1} of page ${index}: selectable text for the PDF text layer.`, { x: 45, y: page.getHeight() - 120 - line * 18, size: 11, font });
    }
    return (await doc.save()).buffer as ArrayBuffer;
  })();
  return longPdf;
}
const LONG_DOCX_NAME = "Forestry Digital Services Senior End to End Product Design (with AI Expertise) - IS27NRI014 MULRFQ Forestry Digital Services Senior End to End Product Design.docx";
/** A Letter-size Word file (816px wide at 100%) with a full-width table: wider than a phone. */
async function fixtureDocx() {
  const zip = new JSZip();
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  zip.file("[Content_Types].xml", `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  const paragraph = (text: string, size = 22) => `<w:p><w:r><w:rPr><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (text: string) => `<w:tc><w:tcPr><w:tcW w:w="2340" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
  const row = (index: number) => `<w:tr>${[1, 2, 3, 4].map(column => cell(`Row ${index}, column ${column}`)).join("")}</w:tr>`;
  const borders = '<w:tblBorders>' + ["top", "left", "bottom", "right", "insideH", "insideV"].map(side => `<w:${side} w:val="single" w:sz="4" w:color="444444"/>`).join("") + "</w:tblBorders>";
  const body = [
    paragraph("MINISTRY OF FORESTS - REQUEST FOR QUOTATIONS", 36),
    paragraph("Forestry Digital Services Senior End to End Product Design (with AI Expertise)", 28),
    `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>${borders}</w:tblPr><w:tblGrid>${"<w:gridCol w:w=\"2340\"/>".repeat(4)}</w:tblGrid>${Array.from({ length: 12 }, (_, index) => row(index + 1)).join("")}</w:tbl>`,
    ...Array.from({ length: 80 }, (_, index) => paragraph(`Paragraph ${index + 1}. The contractor must provide end to end product design services, including research, prototyping and accessibility review, for the forestry digital services program.`)),
  ].join("");
  zip.file("word/document.xml", `${xml}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: "arraybuffer" });
}
type FixtureKind = "pdf" | "long-pdf" | "docx" | "html" | "wav" | "large";
const FIXTURE_NAMES: Record<FixtureKind, string> = {
  pdf: "pdf-fixture.pdf", "long-pdf": "long-fixture-120-pages.pdf", docx: LONG_DOCX_NAME, html: "html-fixture.pdf", wav: "wav-fixture.wav", large: "large-fixture.pdf",
};
function Fixture() {
  const [kind, setKind] = useState<FixtureKind | null>(null);
  const [inline, setInline] = useState(false);
  const loadInline = useCallback(() => fixtureLongPdf(), []);
  const load = useCallback(async (signal: AbortSignal) => {
    if (kind === "wav") {
      const bytes = new ArrayBuffer(44 + 1600); const view = new DataView(bytes);
      const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, 1600, true);
      return bytes;
    }
    if (kind === "large") throw new Error("Large preview must never request bytes");
    if (kind === "long-pdf") return fixtureLongPdf();
    if (kind === "docx") return fixtureDocx();
    const bytes = kind === "html" ? new TextEncoder().encode('<html><script>alert("must not run")</script>not a PDF</html>').buffer : await fixturePdf();
    signal.throwIfAborted(); return bytes;
  }, [kind]);
  return <div className="page"><h1>Shared preview regression fixture</h1><button className="btn" onClick={() => setKind("pdf")}>Open synthetic PDF</button><button className="btn" onClick={() => setKind("long-pdf")}>Open 120-page PDF</button><button className="btn" onClick={() => setKind("docx")}>Open wide Word file</button><button className="btn" onClick={() => setInline(true)}>Show 120-page PDF inline</button><button className="btn" onClick={() => setKind("html")}>Open mislabeled PDF</button><button className="btn" onClick={() => setKind("wav")}>Open synthetic audio</button><button className="btn" onClick={() => setKind("large")}>Open 500 MB source</button>
    {/* The document workbench's inline pane: its own max-height scroll box, not a dialog. */}
    {inline && <DocumentPreviewPane document={{ _id: "inline", fileName: "inline-fixture.pdf", mimeType: "application/pdf" }} fallbackUrl={null} hasAnyFile loadBytes={loadInline} />}
    {kind && <FilePreviewDialog file={{ id: kind, name: FIXTURE_NAMES[kind], mimeType: kind === "wav" ? "audio/wav" : kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf", bytes: kind === "large" ? 500_000_000 : undefined }} loadBytes={load} onClose={() => setKind(null)} onDownload={() => { document.body.dataset.downloaded = kind; }} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
