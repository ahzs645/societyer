import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import {
  blocksToPlainText,
  exactSourceTextToHtml,
  renderExactSourceSampleText,
  renderStarterTemplateSampleHtml,
  sourceTextToBlocks,
  starterSampleData,
  type StarterTemplateBlock,
  type StarterTemplateLike,
  type StarterTemplateSampleData,
} from "./starter-template-rendering";

type StarterTemplateArtifact = {
  key: string;
  name: string;
  policyNumber: string;
  templateType?: "policy" | "document";
  source?: { primaryFileName?: string; primaryRelativePath?: string; sha256?: string };
  sampleData?: StarterTemplateSampleData;
  comparison?: {
    status?: string;
    exactTextMatch?: boolean;
    sourceKeywordCoverage?: number;
    renderedKeywordOverlap?: number;
    sourceOnlyKeywords?: string[];
  };
  dummySampleComparison?: {
    status?: string;
    sourceKeywordCoverage?: number;
    renderedKeywordOverlap?: number;
  };
  exactTemplate?: {
    text?: string;
    html?: string;
  };
  extraction?: {
    text?: string;
  };
  renderedSample?: {
    text?: string;
    html?: string;
  };
  remadeTemplate: {
    includeBoardAcceptance?: boolean;
    sections: StarterTemplateLike["sections"];
    html: string;
    text?: string;
  };
};

const jsonDir = resolve("convex/data/starterPolicyTemplates");
const outputDir = resolve("data/starter-template-exports");
const sourceRoot = "/Users/ahmadjalil/Downloads/New Folder With Items";

async function main() {
  if (!existsSync(jsonDir)) throw new Error(`Missing starter template JSON directory: ${jsonDir}`);
  mkdirSync(outputDir, { recursive: true });

  const artifacts = readdirSync(jsonDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(jsonDir, file), "utf8")) as StarterTemplateArtifact);

  const report = [];
  for (const artifact of artifacts) {
    const template = artifactToTemplate(artifact);
    const sampleData = artifact.sampleData ?? starterSampleData(template);
    const exactText = artifact.exactTemplate?.text ?? artifact.remadeTemplate.text ?? artifact.extraction?.text;
    if (!exactText) throw new Error(`${artifact.key} is missing exact template text`);
    const sampleText = artifact.renderedSample?.text ?? renderExactSourceSampleText(exactText, sampleData);
    const exactBlocks = sourceTextToBlocks(exactText);
    const sampleBlocks = sourceTextToBlocks(sampleText);
    const base = join(outputDir, artifact.key);
    const sourcePdfPath = artifact.source?.primaryRelativePath ? join(sourceRoot, artifact.source.primaryRelativePath) : undefined;

    writeFileSync(`${base}.exact.txt`, `${blocksToPlainText(exactBlocks)}\n`, "utf8");
    writeFileSync(`${base}.exact.html`, fullHtmlDocument(artifact.name, artifact.exactTemplate?.html ?? exactSourceTextToHtml(exactText)), "utf8");
    writeDocx(`${base}.exact.docx`, exactBlocks);
    await writePdf(`${base}.exact.pdf`, exactBlocks);
    if (sourcePdfPath && existsSync(sourcePdfPath)) copyFileSync(sourcePdfPath, `${base}.source.pdf`);

    writeFileSync(`${base}.sample.txt`, `${blocksToPlainText(sampleBlocks)}\n`, "utf8");
    writeFileSync(`${base}.sample.html`, fullHtmlDocument(artifact.name, artifact.renderedSample?.html ?? renderStarterTemplateSampleHtml(template, artifact.remadeTemplate.html, sampleData)), "utf8");
    writeDocx(`${base}.sample.docx`, sampleBlocks);
    await writePdf(`${base}.sample.pdf`, sampleBlocks);

    report.push({
      key: artifact.key,
      name: artifact.name,
      comparisonStatus: artifact.comparison?.status ?? "not_compared",
      exactTextMatch: artifact.comparison?.exactTextMatch ?? false,
      dummySampleStatus: artifact.dummySampleComparison?.status ?? "not_compared",
      sourceKeywordCoverage: artifact.dummySampleComparison?.sourceKeywordCoverage,
      renderedKeywordOverlap: artifact.dummySampleComparison?.renderedKeywordOverlap,
      outputs: {
        exactText: `${artifact.key}.exact.txt`,
        exactHtml: `${artifact.key}.exact.html`,
        exactDocx: `${artifact.key}.exact.docx`,
        exactPdf: `${artifact.key}.exact.pdf`,
        sourcePdf: sourcePdfPath && existsSync(sourcePdfPath) ? `${artifact.key}.source.pdf` : undefined,
        text: `${artifact.key}.sample.txt`,
        html: `${artifact.key}.sample.html`,
        docx: `${artifact.key}.sample.docx`,
        pdf: `${artifact.key}.sample.pdf`,
      },
    });
  }

  writeFileSync(
    join(outputDir, "comparison-report.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sourceDir: jsonDir, outputDir, templates: report }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(outputDir, "comparison-report.md"), markdownReport(report), "utf8");
  console.log(`Rendered ${artifacts.length} starter templates to ${outputDir}`);
}

function artifactToTemplate(artifact: StarterTemplateArtifact): StarterTemplateLike {
  return {
    key: artifact.key,
    name: artifact.name,
    policyNumber: artifact.policyNumber,
    templateType: artifact.templateType ?? "policy",
    sourceFile: artifact.source?.primaryFileName,
    sourceSha256: artifact.source?.sha256,
    includeBoardAcceptance: artifact.remadeTemplate.includeBoardAcceptance,
    sections: artifact.remadeTemplate.sections,
  };
}

function fullHtmlDocument(title: string, body: string) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "body{font-family:Arial,sans-serif;line-height:1.45;max-width:860px;margin:48px auto;color:#111827}",
    "h1{font-size:24px;margin:0 0 20px}h2{font-size:16px;margin:24px 0 8px}p{margin:8px 0}small{color:#4b5563}",
    "pre.source-pdf-template{font-family:\"Courier New\",monospace;font-size:12px;line-height:1.25;white-space:pre-wrap}",
    "</style>",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

async function writePdf(path: string, blocks: StarterTemplateBlock[]) {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    mono: await pdfDoc.embedFont(StandardFonts.Courier),
  };
  const state = {
    pdfDoc,
    fonts,
    page: pdfDoc.addPage([612, 792]),
    y: 744,
    margin: 54,
    width: 504,
  };

  for (const block of blocks) {
    if (block.kind === "preformatted") drawPreformattedBlock(state, block.text, fonts.mono, 8.25, 10.5, rgb(0.07, 0.09, 0.15));
    else if (block.kind === "title") drawBlock(state, block.text, fonts.bold, 18, 24, rgb(0.07, 0.09, 0.15), 0);
    else if (block.kind === "heading") drawBlock(state, block.text, fonts.bold, 13, 18, rgb(0.07, 0.09, 0.15), 0, 8);
    else if (block.kind === "listItem") drawBlock(state, `- ${block.text}`, fonts.regular, 10.5, 15, rgb(0.12, 0.16, 0.22), 14);
    else if (block.kind === "small") drawBlock(state, block.text, fonts.regular, 8, 11, rgb(0.35, 0.39, 0.46), 0, 8);
    else drawBlock(state, block.text, fonts.regular, 10.5, 15, rgb(0.12, 0.16, 0.22), 0);
  }

  writeFileSync(path, await pdfDoc.save());
}

function drawBlock(
  state: { pdfDoc: PDFDocument; fonts: { regular: PDFFont; bold: PDFFont; mono: PDFFont }; page: PDFPage; y: number; margin: number; width: number },
  text: string,
  font: PDFFont,
  size: number,
  lineHeight: number,
  color: ReturnType<typeof rgb>,
  indent = 0,
  before = 4,
) {
  state.y -= before;
  for (const hardLine of text.split("\n")) {
    const lines = wrapLine(hardLine, font, size, state.width - indent);
    for (const line of lines) {
      if (state.y < 54) {
        state.page = state.pdfDoc.addPage([612, 792]);
        state.y = 744;
      }
      state.page.drawText(line || " ", { x: state.margin + indent, y: state.y, size, font, color });
      state.y -= lineHeight;
    }
  }
  state.y -= 4;
}

function drawPreformattedBlock(
  state: { pdfDoc: PDFDocument; fonts: { regular: PDFFont; bold: PDFFont; mono: PDFFont }; page: PDFPage; y: number; margin: number; width: number },
  text: string,
  font: PDFFont,
  size: number,
  lineHeight: number,
  color: ReturnType<typeof rgb>,
) {
  for (const line of text.split("\n")) {
    if (state.y < 54) {
      state.page = state.pdfDoc.addPage([612, 792]);
      state.y = 744;
    }
    state.page.drawText(line || " ", { x: state.margin, y: state.y, size, font, color });
    state.y -= lineHeight;
  }
}

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function writeDocx(path: string, blocks: StarterTemplateBlock[]) {
  const tempRoot = mkdtempSync(join(tmpdir(), "starter-template-docx-"));
  try {
    mkdirSync(join(tempRoot, "_rels"), { recursive: true });
    mkdirSync(join(tempRoot, "word"), { recursive: true });
    writeFileSync(join(tempRoot, "[Content_Types].xml"), contentTypesXml(), "utf8");
    writeFileSync(join(tempRoot, "_rels/.rels"), rootRelsXml(), "utf8");
    writeFileSync(join(tempRoot, "word/styles.xml"), stylesXml(), "utf8");
    writeFileSync(join(tempRoot, "word/document.xml"), documentXml(blocks), "utf8");
    if (existsSync(path)) unlinkSync(path);
    execFileSync("zip", ["-qr", path, "."], { cwd: tempRoot });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function documentXml(blocks: StarterTemplateBlock[]) {
  const body = blocks.map(docxParagraph).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

function docxParagraph(block: StarterTemplateBlock) {
  const style = block.kind === "preformatted" ? "Preformatted" : block.kind === "title" ? "Title" : block.kind === "heading" ? "Heading1" : block.kind === "small" ? "Small" : "Normal";
  const text = block.kind === "listItem" ? `- ${block.text}` : block.text;
  const runs = text.split("\n").map((part, index) => `${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join("");
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r>${runs}</w:r></w:p>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:pPr><w:spacing w:after="240"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:pPr><w:spacing w:before="280" w:after="120"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Preformatted"><w:name w:val="Preformatted"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`;
}

function markdownReport(rows: Array<{ key: string; name: string; comparisonStatus: string; exactTextMatch: boolean; dummySampleStatus: string; sourceKeywordCoverage?: number; renderedKeywordOverlap?: number; outputs: Record<string, string | undefined> }>) {
  const lines = [
    "# Starter Template Comparison Report",
    "",
    "The canonical comparison checks normalized text equality between the original PDF extraction and the generated exact template. The dummy-filled sample comparison is only a preview drift screen because placeholders are replaced with sample values.",
    "",
    "| Template | Exact status | Exact match | Dummy sample | Sample source coverage | Outputs |",
    "| --- | --- | ---: | --- | ---: | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${escapeMarkdown(row.name)} | ${row.comparisonStatus} | ${row.exactTextMatch ? "yes" : "no"} | ${row.dummySampleStatus} | ${formatPercent(row.sourceKeywordCoverage)} | ${row.outputs.sourcePdf ? `${row.outputs.sourcePdf}; ` : ""}${row.outputs.exactPdf}, ${row.outputs.exactDocx}; sample: ${row.outputs.pdf}, ${row.outputs.docx} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function formatPercent(value?: number) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "-";
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeXml(value: string) {
  return escapeHtml(value).replace(/'/g, "&apos;");
}

function escapeMarkdown(value: string) {
  return value.replace(/\|/g, "\\|");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
