// Builds a reviewed-import bundle from the local OTE BC Registry export folder.
// The output is designed for /app/imports: records stay pending until reviewed.
//
// Run: node scripts/build-ote-society-registry-bundle.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "/Users/ahmadjalil/Downloads/OTE society";
const OUT_DIR = path.join(process.cwd(), "imports", "ote-society-registry");
const OUT_BUNDLE = path.join(OUT_DIR, "ote-society-import-bundle.json");
const OUT_SUMMARY = path.join(OUT_DIR, "ote-society-import-summary.json");
const OUT_TASKS = path.join(OUT_DIR, "TASKS.md");
const CSV_NAME = "OTE_Society_S0048345_Filing_History_AllPages.csv";
const SOCIETY_NAME = "Over the Edge Newspaper Society";
const INCORPORATION_NUMBER = "S0048345";
const BUSINESS_NUMBER = "86136 8173 BC0001";

if (!existsSync(ROOT)) throw new Error(`Source folder not found: ${ROOT}`);

const files = readdirSync(ROOT)
  .filter((name) => !name.startsWith("."))
  .map((name) => path.join(ROOT, name))
  .filter((file) => statSync(file).isFile())
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

const textByFile = new Map();
for (const file of files.filter((file) => path.extname(file).toLowerCase() === ".pdf")) {
  textByFile.set(file, pdfText(file));
}

const csvPath = path.join(ROOT, CSV_NAME);
const csvRows = existsSync(csvPath) ? parseCsv(readFileSync(csvPath, "utf8")) : [];
const filingRows = csvRows.slice(1).map((row) => ({
  rowNumber: row[0],
  filingType: row[1],
  agmDate: row[2],
  filedAt: row[3],
  filedBy: row[4],
  additionalDetails: row[5],
  deliveryEmail: row[6],
  documentsAvailable: row[7],
}));

const sourceByBasename = new Map(files.map((file) => [path.basename(file), sourceExternalId(file)]));
const sources = files.map(sourceRecord);
const documentMap = files.map(documentCandidate);
const filings = filingRows.map(filingRecord);
const facts = buildFacts();
const events = buildEvents(filingRows);
const rosterSnapshots = buildRosterSnapshots();
const boardRoleAssignments = rosterSnapshots.flatMap(snapshotAssignments);
const explicitRoleChanges = buildExplicitRoleChanges();
const inferredRoleChanges = buildInferredRoleChanges(rosterSnapshots);
const boardRoleChanges = [...explicitRoleChanges, ...inferredRoleChanges];
const bylawAmendments = buildBylawAmendments();
const publications = buildPublications();
const sourceEvidence = buildSourceEvidence(rosterSnapshots);

const bundle = {
  metadata: {
    name: "OTE BC Registry society import",
    createdFrom: "local-ote-society-registry-folder",
    sourceRoot: ROOT,
    generatedAtISO: new Date().toISOString(),
    sourceDocumentCount: files.length,
    reviewNotes: [
      "Member register records are not created from these registry PDFs; the folder proves director/filing/bylaw evidence only.",
      "Director rows are staged as board role evidence and role changes, not final legal director-register writes.",
      "Receipt PDFs are staged as document/source evidence only; payment identifiers are not transposed into plain fields.",
      "Bylaw amendments are staged for review so the 2018 and 2024 texts can feed the bylaw redline/history system after approval.",
    ],
  },
  sources,
  documentMap,
  facts,
  events,
  filings,
  boardRoleAssignments,
  boardRoleChanges,
  bylawAmendments,
  publications,
  sourceEvidence,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_BUNDLE, `${JSON.stringify(bundle, null, 2)}\n`);

const latestSnapshot = rosterSnapshots[rosterSnapshots.length - 1];
const summary = {
  generatedAtISO: bundle.metadata.generatedAtISO,
  sourceFolder: ROOT,
  sourceDocumentCount: files.length,
  filings: filings.length,
  documentCandidates: documentMap.length,
  boardRoleAssignments: boardRoleAssignments.length,
  boardRoleChanges: boardRoleChanges.length,
  bylawAmendments: bylawAmendments.length,
  latestDirectorSnapshot: latestSnapshot
    ? {
        date: latestSnapshot.effectiveDate,
        source: latestSnapshot.sourceFile,
        directors: latestSnapshot.directors,
      }
    : null,
  outputBundle: OUT_BUNDLE,
};
writeFileSync(OUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(OUT_TASKS, tasksMarkdown(summary, bundle));

console.log(JSON.stringify(summary, null, 2));

function sourceRecord(file) {
  const basename = path.basename(file);
  const text = textByFile.get(file) ?? "";
  const stat = statSync(file);
  return {
    externalSystem: "local",
    externalId: sourceExternalId(file),
    title: titleForFile(basename),
    sourceDate: sourceDateForFile(file, text),
    category: categoryForFile(basename),
    confidence: "High",
    localPath: file,
    fileName: basename,
    mimeType: mimeTypeFor(file),
    fileSizeBytes: stat.size,
    sha256: sha256(file),
    sensitivity: basename.includes("Receipt") ? "restricted" : "standard",
    tags: ["ote-society-registry", categoryForFile(basename).toLowerCase().replace(/[^a-z0-9]+/g, "-")],
    notes: basename === "viewDocument.pdf"
      ? "Appears to duplicate the 2025 annual report export; keep pending until duplicate review."
      : "Local BC Registry export source.",
  };
}

function documentCandidate(file) {
  const basename = path.basename(file);
  const source = sourceRecord(file);
  return {
    externalSystem: source.externalSystem,
    externalId: source.externalId,
    title: source.title,
    category: source.category,
    fileName: source.fileName,
    mimeType: source.mimeType,
    fileSizeBytes: source.fileSizeBytes,
    localPath: source.localPath,
    sha256: source.sha256,
    sourceDate: source.sourceDate,
    sections: sectionsForFile(basename),
    tags: source.tags,
    sensitivity: source.sensitivity,
    confidence: basename === "viewDocument.pdf" ? "Medium" : "High",
    why: basename === "viewDocument.pdf"
      ? "Likely duplicate PDF staged for reviewer duplicate check."
      : "BC Registry source document in local OTE society folder.",
  };
}

function filingRecord(row) {
  const number = String(row.rowNumber ?? "").padStart(2, "0");
  const sourceIds = unique([
    sourceByBasename.get(CSV_NAME),
    ...files
      .filter((file) => path.basename(file).startsWith(`${number}_`))
      .map((file) => sourceExternalId(file)),
  ]);
  const filedAt = parseRegistryDate(row.filedAt);
  const agmDate = parseRegistryDate(row.agmDate);
  return {
    title: `${row.filingType} - ${filedAt ?? row.filedAt ?? "undated"}`,
    kind: filingKind(row.filingType),
    periodLabel: periodLabel(row),
    dueDate: filedAt ?? agmDate ?? todayDate(),
    filedAt,
    submissionMethod: "BC Registries and Online Services",
    confirmationNumber: undefined,
    feePaidCents: undefined,
    submissionChecklist: documentList(row.documentsAvailable),
    status: "Filed",
    sourceDate: filedAt,
    sourceExternalIds: sourceIds,
    confidence: sourceIds.length > 1 ? "High" : "Medium",
    notes: [
      row.additionalDetails,
      row.documentsAvailable === "Available on paper only" ? "Paper-only filing listed in filing-history CSV; no PDF was present in the local folder." : undefined,
      "Imported from filing history CSV and matching local registry PDFs where available.",
    ].filter(Boolean).join("\n"),
  };
}

function buildFacts() {
  return [
    {
      label: "Society name",
      value: SOCIETY_NAME,
      category: "Identity",
      confidence: "High",
      sourceExternalIds: [sourceByBasename.get("01_AnnualReport_2025.pdf")].filter(Boolean),
    },
    {
      label: "Incorporation number",
      value: INCORPORATION_NUMBER,
      category: "Identity",
      confidence: "High",
      sourceExternalIds: [sourceByBasename.get(CSV_NAME)].filter(Boolean),
    },
    {
      label: "Business number",
      value: BUSINESS_NUMBER,
      category: "Identity",
      confidence: "High",
      sourceExternalIds: [sourceByBasename.get("01_AnnualReport_2025.pdf")].filter(Boolean),
    },
  ];
}

function buildEvents(rows) {
  return rows.map((row) => {
    const filedAt = parseRegistryDate(row.filedAt);
    return {
      eventDate: filedAt ?? todayDate(),
      title: row.filingType,
      category: "Registry filing",
      summary: [
        row.agmDate ? `AGM date: ${parseRegistryDate(row.agmDate) ?? row.agmDate}` : undefined,
        row.additionalDetails,
        row.documentsAvailable,
      ].filter(Boolean).join(" | "),
      confidence: "High",
      sourceExternalIds: [sourceByBasename.get(CSV_NAME)].filter(Boolean),
    };
  });
}

function buildRosterSnapshots() {
  const snapshots = [];
  for (const file of files) {
    const basename = path.basename(file);
    if (!/(AnnualReport|StatementOfDirectorsAndOffice|DirectorsAndOffice)/.test(basename)) continue;
    const text = textByFile.get(file);
    if (!text) continue;
    const directors = extractDirectorNames(text).map(formatRegistryName);
    if (directors.length === 0) continue;
    const annual = basename.includes("AnnualReport");
    const filedDate = parsePdfFiledDate(text) ?? sourceDateFromBasename(basename);
    const agmDate = parsePdfAgmDate(text);
    snapshots.push({
      sourceFile: basename,
      sourceExternalIds: [sourceExternalId(file)],
      effectiveDate: annual ? agmDate ?? filedDate ?? todayDate() : filedDate ?? todayDate(),
      filedDate,
      agmDate,
      directors,
      confidence: "High",
      note: annual
        ? "Annual report roster snapshot; use AGM date as observed date, not exact term start."
        : "Statement of directors and registered office roster snapshot.",
    });
  }
  return snapshots.sort((a, b) => `${a.effectiveDate}:${a.sourceFile}`.localeCompare(`${b.effectiveDate}:${b.sourceFile}`));
}

function snapshotAssignments(snapshot) {
  const latest = snapshot.sourceFile === "01_AnnualReport_2025.pdf" || snapshot.sourceFile === "01_StatementOfDirectorsAndOffice_2025BCReport.pdf";
  return snapshot.directors.map((personName) => ({
    personName,
    roleTitle: "Director",
    roleType: "director",
    roleGroup: "Board",
    startDate: snapshot.effectiveDate,
    status: "Verified",
    confidence: snapshot.confidence,
    sourceDate: snapshot.effectiveDate,
    sourceExternalIds: snapshot.sourceExternalIds,
    importedFrom: "OTE BC Registry local folder",
    notes: [
      snapshot.note,
      latest ? "Latest 2025 registry evidence; use to review the current legal director register." : undefined,
    ].filter(Boolean).join("\n"),
  }));
}

function buildExplicitRoleChanges() {
  const changes = [];
  for (const file of files.filter((file) => path.basename(file).includes("ChangeOfDirectors"))) {
    const basename = path.basename(file);
    const text = textByFile.get(file) ?? "";
    const filedDate = parsePdfFiledDate(text) ?? sourceDateFromBasename(basename);
    const effectiveDate = parsePdfDirectorChangeDate(text) ?? filedDate ?? todayDate();
    const sourceExternalIds = [sourceExternalId(file)];
    const newNames = sectionNames(text, "NEW DIRECTORS");
    for (const personName of newNames.map(formatRegistryName)) {
      changes.push({
        effectiveDate,
        changeType: "added",
        roleTitle: "Director",
        personName,
        status: "Verified",
        confidence: "High",
        sourceDate: filedDate,
        sourceExternalIds,
        notes: `Explicit new-director filing: ${basename}`,
      });
    }
    const ceasedNames = sectionNames(text, "PERSONS WHO HAVE CEASED TO BE DIRECTORS");
    for (const personName of ceasedNames.map(formatRegistryName)) {
      changes.push({
        effectiveDate,
        changeType: "removed",
        roleTitle: "Director",
        personName,
        status: "Verified",
        confidence: "High",
        sourceDate: filedDate,
        sourceExternalIds,
        notes: `Explicit ceased-director filing: ${basename}`,
      });
    }
    const rename = text.match(/Last Name, First Name Middle Name:\s*\n\s*([A-Z '\-]+,\s*[A-Z '\-]+)\s*\(formerly\s+([A-Z '\-]+,\s*[A-Z '\-]+)\)/i);
    if (rename) {
      changes.push({
        effectiveDate: filedDate ?? effectiveDate,
        changeType: "renamed",
        roleTitle: "Director",
        personName: formatRegistryName(rename[1]),
        previousPersonName: formatRegistryName(rename[2]),
        status: "Verified",
        confidence: "High",
        sourceDate: filedDate,
        sourceExternalIds,
        notes: `Legal name correction filing: ${basename}`,
      });
    }
  }
  return changes;
}

function buildInferredRoleChanges(snapshots) {
  const changes = [];
  const yearly = snapshots.filter((snapshot) => /AnnualReport|StatementOfDirectorsAndOffice/.test(snapshot.sourceFile));
  for (let i = 1; i < yearly.length; i += 1) {
    const prev = yearly[i - 1];
    const next = yearly[i];
    const prevKeys = new Map(prev.directors.map((name) => [nameKey(name), name]));
    const nextKeys = new Map(next.directors.map((name) => [nameKey(name), name]));
    for (const [key, personName] of nextKeys) {
      if (prevKeys.has(key)) continue;
      if (hasExplicitChangeFor(personName, next.effectiveDate)) continue;
      changes.push(inferredChange("added", personName, next, prev));
    }
    for (const [key, personName] of prevKeys) {
      if (nextKeys.has(key)) continue;
      if (hasExplicitChangeFor(personName, next.effectiveDate)) continue;
      changes.push(inferredChange("removed", personName, next, prev));
    }
  }
  return changes;
}

function inferredChange(changeType, personName, next, prev) {
  return {
    effectiveDate: next.effectiveDate,
    changeType,
    roleTitle: "Director",
    personName,
    status: "NeedsReview",
    confidence: "Medium",
    sourceDate: next.effectiveDate,
    sourceExternalIds: unique([...next.sourceExternalIds, ...prev.sourceExternalIds]),
    notes: `Inferred from roster snapshot difference between ${prev.sourceFile} and ${next.sourceFile}; no separate change notice was matched in this local folder.`,
  };
}

function hasExplicitChangeFor(personName, date) {
  const key = nameKey(personName);
  return explicitRoleChanges.some(
    (change) =>
      (nameKey(change.personName) === key || nameKey(change.previousPersonName) === key) &&
      Math.abs(dateDistanceDays(change.effectiveDate, date)) <= 45,
  );
}

function buildBylawAmendments() {
  const bylaw2018File = files.find((file) => path.basename(file) === "15_Bylaws_Nov14_2018.pdf");
  const bylaw2024File = files.find((file) => path.basename(file) === "07_Bylaws_Jul05_2024.pdf");
  const text2018 = bylaw2018File ? cleanupBylawText(textByFile.get(bylaw2018File) ?? "") : "";
  const text2024 = bylaw2024File ? cleanupBylawText(textByFile.get(bylaw2024File) ?? "") : "";
  const out = [];
  if (text2018) {
    out.push({
      title: "2018 transition bylaws baseline",
      baseText: "",
      proposedText: text2018,
      status: "Filed",
      createdByName: "OTE registry import",
      createdAtISO: "2018-11-14T12:00:00.000Z",
      updatedAtISO: "2018-11-14T12:00:00.000Z",
      resolutionPassedAtISO: "2017-03-23T12:00:00.000Z",
      filedAtISO: "2018-11-14T12:00:00.000Z",
      sourceDate: "2018-11-14",
      sourceExternalIds: [
        sourceByBasename.get("15_TransitionApplication_Nov14_2018.pdf"),
        sourceByBasename.get("15_Bylaws_Nov14_2018.pdf"),
        sourceByBasename.get("15_Constitution_Nov14_2018.pdf"),
      ].filter(Boolean),
      importedFrom: "OTE BC Registry local folder",
      confidence: "High",
      notes: "Baseline filed transition bylaws. Review before marking as authoritative current text.",
    });
  }
  if (text2018 && text2024) {
    out.push({
      title: "2024 filed bylaw alteration",
      baseText: text2018,
      proposedText: text2024,
      status: "Filed",
      createdByName: "OTE registry import",
      createdAtISO: "2024-07-05T12:00:00.000Z",
      updatedAtISO: "2024-07-05T12:00:00.000Z",
      resolutionPassedAtISO: "2024-06-23T12:00:00.000Z",
      filedAtISO: "2024-07-05T12:00:00.000Z",
      sourceDate: "2024-07-05",
      sourceExternalIds: [
        sourceByBasename.get("07_BylawAlterationApplication_Jul05_2024.pdf"),
        sourceByBasename.get("07_Bylaws_Jul05_2024.pdf"),
      ].filter(Boolean),
      importedFrom: "OTE BC Registry local folder",
      confidence: "High",
      notes: "Broad 2024 rewrite/restructure. The redline is feasible but should be reviewed section by section.",
    });
  }
  return out;
}

function buildPublications() {
  return [
    {
      title: "Current bylaws - 2024 filed version",
      category: "Bylaws",
      publishedAtISO: undefined,
      status: "Draft",
      summary: "Draft publication candidate for the bylaws filed on 2024-07-05. Review text and public visibility before publishing.",
      sourceExternalIds: [sourceByBasename.get("07_Bylaws_Jul05_2024.pdf")].filter(Boolean),
      confidence: "High",
    },
  ];
}

function buildSourceEvidence(snapshots) {
  const latest = snapshots[snapshots.length - 1];
  return [
    latest
      ? {
          externalSystem: "local",
          externalId: latest.sourceExternalIds[0],
          sourceTitle: "Latest OTE director roster evidence",
          sourceDate: latest.effectiveDate,
          evidenceKind: "import_support",
          targetTable: "directors",
          sensitivity: "standard",
          accessLevel: "internal",
          summary: `Latest registry roster snapshot lists current directors as of ${latest.effectiveDate}: ${latest.directors.join(", ")}. Promote into the legal director register only after human review.`,
          status: "NeedsReview",
          sourceExternalIds: latest.sourceExternalIds,
          notes: "This evidence does not create member records.",
        }
      : null,
    {
      externalSystem: "local",
      externalId: sourceByBasename.get("07_Bylaws_Jul05_2024.pdf"),
      sourceTitle: "2024 bylaws rule extraction follow-up",
      sourceDate: "2024-07-05",
      evidenceKind: "import_support",
      targetTable: "bylawRuleSets",
      sensitivity: "standard",
      accessLevel: "internal",
      summary: "The filed 2024 bylaws include quorum, proxy, director, notice, and inspection rules. Active bylaw rules still need human interpretation before saving.",
      status: "NeedsReview",
      sourceExternalIds: [sourceByBasename.get("07_Bylaws_Jul05_2024.pdf")].filter(Boolean),
      notes: "Do not auto-activate bylaw rules from OCR.",
    },
  ].filter(Boolean);
}

function pdfText(file) {
  return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 25 * 1024 * 1024 });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function extractDirectorNames(text) {
  const names = [];
  const re = /Last Name, First Name Middle Name:\s*\n\s*([A-Z][A-Z '\-]+,\s*[A-Z][A-Z '\-]+)/g;
  let match;
  while ((match = re.exec(text))) names.push(match[1]);
  return unique(names);
}

function sectionNames(text, heading) {
  const start = text.indexOf(heading);
  if (start === -1) return [];
  const rest = text.slice(start + heading.length);
  const endMarkers = ["CERTIFICATION", "DIRECTOR CHANGE OF ADDRESS", "PERSONS WHO HAVE CEASED", "NEW DIRECTORS", "DIRECTOR LEGAL NAME CHANGE"];
  let section = rest;
  for (const marker of endMarkers) {
    const index = rest.indexOf(marker);
    if (index > 0) section = section.slice(0, index);
  }
  return extractDirectorNames(section);
}

function formatRegistryName(value) {
  const cleaned = String(value ?? "").replace(/\([^)]*\)/g, "").trim();
  const parts = cleaned.split(",");
  if (parts.length < 2) return titleCase(cleaned);
  const last = titleCase(parts[0].trim().replace(/\s+/g, " "));
  const first = titleCase(parts.slice(1).join(" ").trim().replace(/\s+/g, " "));
  return `${first} ${last}`.trim();
}

function titleCase(value) {
  return value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => /^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part)
    .join("");
}

function parsePdfFiledDate(text) {
  return parseRegistryDate(text.match(/Filed Date and Time:\s*([^\n]+)/i)?.[1]);
}

function parsePdfAgmDate(text) {
  return parseRegistryDate(text.match(/Annual General Meeting \(AGM\) Date:\s*([^\n]+)/i)?.[1]);
}

function parsePdfDirectorChangeDate(text) {
  return parseRegistryDate(text.match(/Date of Change of Directors:\s*([^\n]+)/i)?.[1]);
}

function sourceDateForFile(file, text) {
  return parsePdfFiledDate(text) ?? sourceDateFromBasename(path.basename(file));
}

function sourceDateFromBasename(basename) {
  const year = basename.match(/(20\d{2})/)?.[1];
  if (!year) return undefined;
  const monthDay = basename.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*([0-9]{2})?/i);
  if (!monthDay) return `${year}-01-01`;
  const month = monthNumber(monthDay[1]);
  const day = monthDay[2] ?? "01";
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function parseRegistryDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const iso = text.match(/\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const match = text.match(/\b([A-Z][a-z]+)\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/);
  if (!match) return undefined;
  return `${match[3]}-${monthNumber(match[1])}-${match[2].padStart(2, "0")}`;
}

function monthNumber(value) {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.findIndex((month) => value.toLowerCase().startsWith(month));
  if (index === -1) return "01";
  return String(index + 1).padStart(2, "0");
}

function cleanupBylawText(text) {
  return text
    .replace(/\f/g, "\n\n")
    .replace(/BC Registries and Online Services[\s\S]*?Page \d+ of \d+/g, "")
    .replace(/Filed Date and Time:[^\n]+\n/g, "")
    .replace(/Society Incorporation Number:[^\n]+\n/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function categoryForFile(basename) {
  if (/Bylaw|Constitution|Transition/i.test(basename)) return "Bylaws";
  if (/AnnualReport|ChangeOfDirectors|StatementOfDirectors|DirectorsAndOffice/i.test(basename)) return "Registry Filing";
  if (/Receipt/i.test(basename)) return "Receipt";
  if (/Filing_History/i.test(basename)) return "Filing History";
  return "Registry Document";
}

function sectionsForFile(basename) {
  const sections = ["records_and_archive", "compliance"];
  if (/Bylaw|Constitution|Transition/i.test(basename)) sections.push("public_transparency", "manual_only");
  if (/AnnualReport|ChangeOfDirectors|StatementOfDirectors|DirectorsAndOffice/i.test(basename)) sections.push("governance");
  if (/Receipt/i.test(basename)) sections.push("finance");
  return unique(sections);
}

function titleForFile(basename) {
  return basename
    .replace(/\.[^.]+$/, "")
    .replace(/^(\d+)_/, "$1 - ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filingKind(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("annual report")) return "AnnualReport";
  if (text.includes("change of directors")) return "ChangeOfDirectors";
  if (text.includes("bylaw")) return "BylawAmendment";
  if (text.includes("transition")) return "Transition";
  if (text.includes("special resolution")) return "SpecialResolution";
  if (text.includes("incorporate")) return "Incorporation";
  return "Other";
}

function periodLabel(row) {
  const year = row.filingType?.match(/\b(19|20)\d{2}\b/)?.[0];
  if (year) return year;
  const filed = parseRegistryDate(row.filedAt);
  return filed?.slice(0, 4);
}

function documentList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sourceExternalId(file) {
  return `ote-society:${path.basename(file)}`;
}

function mimeTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".csv") return "text/csv";
  return "application/octet-stream";
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean).map(String)));
}

function nameKey(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function dateDistanceDays(a, b) {
  const ad = Date.parse(a);
  const bd = Date.parse(b);
  if (!Number.isFinite(ad) || !Number.isFinite(bd)) return Infinity;
  return (ad - bd) / 864e5;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function tasksMarkdown(summary, data) {
  return `# OTE Society Registry Import Tasks

Generated: ${summary.generatedAtISO}

## Bundle

- Import bundle: \`ote-society-import-bundle.json\`
- Summary: \`ote-society-import-summary.json\`
- Source files indexed: ${summary.sourceDocumentCount}
- Import records staged by bundle: ${[
    data.sources.length,
    data.documentMap.length,
    data.facts.length,
    data.events.length,
    data.filings.length,
    data.boardRoleAssignments.length,
    data.boardRoleChanges.length,
    data.bylawAmendments.length,
    data.publications.length,
    data.sourceEvidence.length,
  ].reduce((a, b) => a + b, 0)}

## Counts

- sources: ${data.sources.length}
- documentMap: ${data.documentMap.length}
- facts: ${data.facts.length}
- events: ${data.events.length}
- filings: ${data.filings.length}
- boardRoleAssignments: ${data.boardRoleAssignments.length}
- boardRoleChanges: ${data.boardRoleChanges.length}
- bylawAmendments: ${data.bylawAmendments.length}
- publications: ${data.publications.length}
- sourceEvidence: ${data.sourceEvidence.length}

## Latest Director Evidence

${summary.latestDirectorSnapshot ? `Latest source: \`${summary.latestDirectorSnapshot.source}\` (${summary.latestDirectorSnapshot.date})

${summary.latestDirectorSnapshot.directors.map((name) => `- ${name}`).join("\n")}` : "No director snapshot found."}

## Review Notes

- These files do not contain a legal member register. Do not create member records from this bundle.
- Director roster rows are evidence records. Promote the legal director register manually after reviewing the current 2025 source.
- The 2024 bylaw record is a broad rewrite against the 2018 transition bylaws. Review the redline section by section before relying on it.
- Receipt PDFs are metadata/source evidence only. Do not copy payment identifiers into public or general notes.

## GUI Flow

1. Open \`/app/imports\`.
2. Create a new import session from \`ote-society-import-bundle.json\`.
3. Approve \`documentCandidate\`, \`filing\`, and current \`boardRoleAssignment\` records only after source review.
4. Apply documents and sections.
5. Open \`/app/bylaws-history\` and \`/app/bylaw-diff\` to review the staged 2018 baseline and 2024 filed alteration.
6. Use the current 2025 director evidence to update \`/app/directors\` intentionally; this bundle does not write the legal director register directly.
`;
}
