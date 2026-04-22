import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import {
  blocksToPlainText,
  renderStarterTemplateBlocks,
  renderStarterTemplateSampleHtml,
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
  source?: { primaryFileName?: string; sha256?: string };
  sampleData?: StarterTemplateSampleData;
  comparison?: {
    status?: string;
    sourceKeywordCoverage?: number;
    renderedKeywordOverlap?: number;
    sourceOnlyKeywords?: string[];
  };
  remadeTemplate: {
    includeBoardAcceptance?: boolean;
    sections: StarterTemplateLike["sections"];
    html: string;
  };
};

const jsonDir = resolve("convex/data/starterPolicyTemplates");
const outputDir = resolve("data/starter-template-exports");

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
    const blocks = renderStarterTemplateBlocks(template, sampleData);
    const base = join(outputDir, artifact.key);

    writeFileSync(`${base}.sample.txt`, `${blocksToPlainText(blocks)}\n`, "utf8");
    writeFileSync(`${base}.sample.html`, fullHtmlDocument(artifact.name, renderStarterTemplateSampleHtml(template, artifact.remadeTemplate.html, sampleData)), "utf8");
    writeDocx(`${base}.sample.docx`, blocks);
    await writePdf(`${base}.sample.pdf`, blocks);

    report.push({
      key: artifact.key,
      name: artifact.name,
      comparisonStatus: artifact.comparison?.status ?? "not_compared",
      sourceKeywordCoverage: artifact.comparison?.sourceKeywordCoverage,
      renderedKeywordOverlap: artifact.comparison?.renderedKeywordOverlap,
      sourceOnlyKeywords: artifact.comparison?.sourceOnlyKeywords ?? [],
      outputs: {
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
    "body{font-family:Arial,sans-serif;line-height:1.45;max-width:760px;margin:48px auto;color:#111827}",
    "h1{font-size:24px;margin:0 0 20px}h2{font-size:16px;margin:24px 0 8px}p{margin:8px 0}small{color:#4b5563}",
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
    if (block.kind === "title") drawBlock(state, block.text, fonts.bold, 18, 24, rgb(0.07, 0.09, 0.15), 0);
    else if (block.kind === "heading") drawBlock(state, block.text, fonts.bold, 13, 18, rgb(0.07, 0.09, 0.15), 0, 8);
    else if (block.kind === "listItem") drawBlock(state, `- ${block.text}`, fonts.regular, 10.5, 15, rgb(0.12, 0.16, 0.22), 14);
    else if (block.kind === "small") drawBlock(state, block.text, fonts.regular, 8, 11, rgb(0.35, 0.39, 0.46), 0, 8);
    else drawBlock(state, block.text, fonts.regular, 10.5, 15, rgb(0.12, 0.16, 0.22), 0);
  }

  writeFileSync(path, await pdfDoc.save());
}

function drawBlock(
  state: { pdfDoc: PDFDocument; fonts: { regular: PDFFont; bold: PDFFont }; page: PDFPage; y: number; margin: number; width: number },
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
  const style = block.kind === "title" ? "Title" : block.kind === "heading" ? "Heading1" : block.kind === "small" ? "Small" : "Normal";
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
</w:styles>`;
}

function markdownReport(rows: Array<{ key: string; name: string; comparisonStatus: string; sourceKeywordCoverage?: number; renderedKeywordOverlap?: number; outputs: Record<string, string> }>) {
  const lines = [
    "# Starter Template Comparison Report",
    "",
    "The comparison uses normalized keyword overlap between the original PDF text extraction and the dummy-filled remade template. It is a drift screen, not a legal-equivalence review.",
    "",
    "| Template | Status | Source coverage | Render overlap | Outputs |",
    "| --- | --- | ---: | ---: | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${escapeMarkdown(row.name)} | ${row.comparisonStatus} | ${formatPercent(row.sourceKeywordCoverage)} | ${formatPercent(row.renderedKeywordOverlap)} | ${row.outputs.pdf}, ${row.outputs.docx} |`,
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
