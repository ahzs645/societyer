import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "imports", "bylaws-history-markdown");

const sources = [
  {
    id: "bc-registry-2018-transition-constitution",
    source: "BC Registry scrape",
    date: "2018-11-14",
    kind: "constitution",
    title: "2018 transition application - constitution",
    pdf: "browser-connector-exports/S0048345-2026-04-21T16-36-34-598Z/pdfs/S0048345_Nov-14-2018_Transition-Application_Constitution_101951914.pdf",
  },
  {
    id: "bc-registry-2018-transition-bylaws",
    source: "BC Registry scrape",
    date: "2018-11-14",
    kind: "bylaws",
    title: "2018 transition application - bylaws",
    pdf: "browser-connector-exports/S0048345-2026-04-21T16-36-34-598Z/pdfs/S0048345_Nov-14-2018_Transition-Application_Bylaws_101951914.pdf",
  },
  {
    id: "bc-registry-2018-transition-package",
    source: "BC Registry scrape",
    date: "2018-11-14",
    kind: "filing-package",
    title: "2018 transition application - full package",
    pdf: "browser-connector-exports/S0048345-2026-04-21T16-36-34-598Z/pdfs/S0048345_Nov-14-2018_Transition-Application_Transition_101951914.pdf",
  },
  {
    id: "bc-registry-2024-bylaw-alteration",
    source: "BC Registry scrape",
    date: "2024-07-05",
    kind: "filing-package",
    title: "2024 bylaw alteration application",
    pdf: "browser-connector-exports/S0048345-2026-04-21T16-36-34-598Z/pdfs/S0048345_Jul-05-2024_Bylaw-Alteration-Application_BylawAlteration_103443066.pdf",
  },
  {
    id: "bc-registry-2024-bylaws",
    source: "BC Registry scrape",
    date: "2024-07-05",
    kind: "bylaws",
    title: "2024 filed bylaws",
    pdf: "browser-connector-exports/S0048345-2026-04-21T16-36-34-598Z/pdfs/S0048345_Jul-05-2024_Bylaw-Alteration-Application_Bylaws_103443066.pdf",
  },
  {
    id: "paperless-2276-ote-constitution",
    source: "Paperless archive",
    date: "2011-03-30",
    kind: "constitution-and-bylaws",
    title: "Paperless 2276 - OTEConstitution",
    pdf: "imports/over-the-edge-paperless/ai-review/documents/paperless-2276/archive.pdf",
  },
  {
    id: "paperless-2264-cfur-constitution-bylaws",
    source: "Paperless archive",
    date: null,
    kind: "reference",
    title: "Paperless 2264 - CFUR Constitution and Bylaws",
    pdf: "imports/over-the-edge-paperless/session-review/pending-visual-review/documents/paperless-2264/archive.pdf",
  },
  {
    id: "paperless-1326-oten-constitution",
    source: "Paperless archive",
    date: null,
    kind: "legacy-constitution",
    title: "Paperless 1326 - OTEN Constitution",
    pdf: "imports/over-the-edge-paperless/session-review/pending-visual-review/documents/paperless-1326/archive.pdf",
  },
  {
    id: "paperless-2275-oteconstitution",
    source: "Paperless archive",
    date: "2011-03-30",
    kind: "reference-duplicate",
    title: "Paperless 2275 - OTEConstitution",
    pdf: "imports/over-the-edge-paperless/session-review/pending-visual-review/documents/paperless-2275/archive.pdf",
  },
  {
    id: "paperless-1328-oten-ministry-constitution",
    source: "Paperless archive",
    date: null,
    kind: "legacy-constitution",
    title: "Paperless 1328 - OTEN Ministry Constitution",
    pdf: "imports/over-the-edge-paperless/session-review/pending-visual-review/documents/paperless-1328/archive.pdf",
  },
  {
    id: "paperless-2204-society-act-amendments-2013",
    source: "Paperless archive",
    date: "2013",
    kind: "amendment-source",
    title: "Paperless 2204 - Over the Edge Society Act proposed amendments 2013",
    pdf: "imports/over-the-edge-paperless/ai-review/documents/paperless-2204/archive.pdf",
  },
  {
    id: "paperless-1434-society-act-resolution",
    source: "Paperless archive",
    date: null,
    kind: "resolution-source",
    title: "Paperless 1434 - Society Act Resolution",
    pdf: "imports/over-the-edge-paperless/session-review/pending-visual-review/documents/paperless-1434/archive.pdf",
  },
  {
    id: "paperless-1403-society-act-copy-resolution",
    source: "Paperless archive",
    date: null,
    kind: "resolution-source",
    title: "Paperless 1403 - Society Act Copy of Resolution",
    pdf: "imports/over-the-edge-paperless/session-review/pending-visual-review/documents/paperless-1403/archive.pdf",
  },
];

mkdirSync(outputDir, { recursive: true });

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function pdfInfo(file) {
  const info = run("pdfinfo", [file]);
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
  const title = info.match(/^Title:\s+(.+)$/m)?.[1]?.trim();
  const creator = info.match(/^Creator:\s+(.+)$/m)?.[1]?.trim();
  const producer = info.match(/^Producer:\s+(.+)$/m)?.[1]?.trim();
  return { pages, title, creator, producer };
}

function extractText(file) {
  return run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"]);
}

function normalizeText(text) {
  return text
    .replace(/\r/g, "")
    .replace(/\f/g, "\n\n---\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function markdownBody(text, options = {}) {
  const includeFilingHeaders = options.includeFilingHeaders ?? true;
  const includePageMarkers = options.includePageMarkers ?? true;
  const lines = normalizeText(text).split("\n");
  const out = [];
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) {
      if (out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (/^\d{1,3}$/.test(line) && out[out.length - 1] === "---") {
      out.pop();
      if (out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (!includePageMarkers && /^[-—]{3,}$/.test(line)) {
      if (out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (/^Drafted\s+January\s+28(?:th)?,\s*2013$/i.test(line)) {
      continue;
    }
    if (/^Filed Date and Time:/i.test(line) || /^Society Incorporation Number:/i.test(line)) {
      if (includeFilingHeaders) out.push(`> ${line}`);
      continue;
    }
    if (/^[-—]{3,}$/.test(line)) {
      out.push("---");
      continue;
    }
    if (/^(constitution|bylaws?|by-laws?)$/i.test(line)) {
      out.push(`## ${titleCase(line)}`);
      continue;
    }
    if (/^part\s+\d+\b/i.test(line)) {
      out.push(`## ${line}`);
      continue;
    }
    if (/^section\s+\d+(\([a-z]\))?\b/i.test(line)) {
      out.push(`### ${line}`);
      continue;
    }
    if (/^\d+(\.\d+)*\s+[-–—]?\s*[A-Z][A-Za-z ,()'"/-]{2,}$/.test(line) && line.length < 90) {
      out.push(`### ${line}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function titleCase(value) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace("Bylaws", "Bylaws");
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function markdownForSource(source, text, info) {
  const sourcePath = source.pdf;
  const lines = [
    "---",
    `id: ${source.id}`,
    `title: ${JSON.stringify(source.title)}`,
    `source: ${JSON.stringify(source.source)}`,
    `kind: ${JSON.stringify(source.kind)}`,
    `date: ${source.date ? JSON.stringify(source.date) : "null"}`,
    `pdf: ${JSON.stringify(sourcePath)}`,
    `pages: ${info.pages}`,
    `pdfTitle: ${info.title ? JSON.stringify(info.title) : "null"}`,
    `creator: ${info.creator ? JSON.stringify(info.creator) : "null"}`,
    `producer: ${info.producer ? JSON.stringify(info.producer) : "null"}`,
    "---",
    "",
    `# ${source.title}`,
    "",
    `Source PDF: \`${sourcePath}\``,
    "",
    markdownBody(text),
    "",
  ];
  return lines.join("\n");
}

const manifest = [];
const bylawVersions = [];

for (const source of sources) {
  const pdfPath = path.join(root, source.pdf);
  const info = pdfInfo(pdfPath);
  const text = extractText(pdfPath);
  const normalized = normalizeText(text);
  const fileName = `${source.date ? `${source.date}-` : ""}${slug(source.id)}.md`;
  const outputPath = path.join(outputDir, fileName);
  writeFileSync(outputPath, markdownForSource(source, text, info), "utf8");

  const wordCount = normalized.match(/[\p{L}\p{N}'’-]+/gu)?.length ?? 0;
  const needsVisionReview = wordCount < Math.max(150, info.pages * 120);
  const entry = {
    ...source,
    pdf: source.pdf,
    markdown: path.relative(root, outputPath),
    pages: info.pages,
    extractedCharacters: normalized.length,
    wordCount,
    needsVisionReview,
    pdfTitle: info.title ?? null,
  };
  manifest.push(entry);

  if (["bylaws", "constitution-and-bylaws"].includes(source.kind) && !needsVisionReview) {
    bylawVersions.push({
      title: source.title,
      status: "Filed",
      sourceDate: source.date,
      filedAtISO: source.date && /^\d{4}-\d{2}-\d{2}$/.test(source.date) ? `${source.date}T12:00:00.000Z` : undefined,
      sourceExternalIds: [source.id],
      importedFrom: source.source,
      confidence: "Review",
      notes: `Converted locally from ${source.pdf}. Review against source PDF before approving.`,
      proposedText: markdownBody(text, { includeFilingHeaders: false, includePageMarkers: false }),
    });
  }
}

bylawVersions.sort((a, b) => String(a.sourceDate ?? "").localeCompare(String(b.sourceDate ?? "")) || a.title.localeCompare(b.title));
let previous = "";
const bylawAmendments = bylawVersions.map((version) => {
  const record = { ...version, baseText: previous };
  previous = version.proposedText;
  return record;
});

writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify({ generatedAtISO: new Date().toISOString(), sources: manifest }, null, 2)}\n`, "utf8");
writeFileSync(path.join(outputDir, "bylaw-import-bundle.json"), `${JSON.stringify({
  metadata: {
    name: "Locally converted bylaws history Markdown",
    createdFrom: "scripts/convert-bylaw-pdfs-to-md.mjs",
    note: "Text was extracted locally with pdftotext and normalized to Markdown. Review source PDFs before applying.",
  },
  sources: manifest.map((entry) => ({
    externalSystem: entry.source,
    externalId: entry.id,
    title: entry.title,
    sourceDate: entry.date,
    category: entry.kind,
    confidence: entry.needsVisionReview ? "Review" : "Medium",
    notes: entry.needsVisionReview ? "Local text extraction was sparse for page count; page image review recommended." : "Local text extraction produced a usable Markdown candidate.",
    fileName: path.basename(entry.pdf),
    url: entry.pdf,
  })),
  bylawAmendments,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  outputDir: path.relative(root, outputDir),
  markdownFiles: manifest.length,
  importBundle: path.relative(root, path.join(outputDir, "bylaw-import-bundle.json")),
  needsVisionReview: manifest.filter((entry) => entry.needsVisionReview).map((entry) => entry.id),
}, null, 2));
