// BC Registry import pipeline extracted from api-gateway.ts: orchestrators that
// pull governance documents / filing history / bylaws from a BC Registry export,
// plus the CSV/text/markdown parsing and candidate-selection helpers.

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
  bcRegistryFilingHistoryBundle,
  bcRegistryGovernanceDocumentsBundle,
  type BcRegistryCsvRecord,
  type GovernanceImportCandidate,
} from "../integrations/bc-registry-staging";
import { stageConnectorImportSession } from "../integrations/staged-imports";
import { dropUndefined, httpError } from "./shared";
import { query, mutation, convexCall, connectorRunnerRequest } from "./convex-client";
import { sanitizeFileName, generatedWorkflowDocumentDir } from "./pdf";

async function importGovernanceDocumentsFromBcRegistry(
  client: ConvexHttpClient,
  input: {
    societyId: string;
    actingUserId?: string;
    corpNum?: string;
    refresh?: boolean;
    stageOnly?: boolean;
  },
) {
  const society: any = await convexCall(client, query("society.getById"), { id: input.societyId });
  if (!society) throw httpError(404, "society_not_found", "Society not found.");

  const corpNum = normalizeBcRegistryCorpNum(input.corpNum ?? society.incorporationNumber);
  if (!corpNum) {
    throw httpError(400, "bc_registry_corp_number_required", "A BC Registry incorporation number is required.");
  }

  const needs = {
    constitution: !society.constitutionDocId,
    bylaws: !society.bylawsDocId,
    privacyPolicy: !society.privacyPolicyDocId,
  };
  const imported: any[] = [];
  const skipped: any[] = [];
  const missing: any[] = [];

  if (!needs.constitution && !needs.bylaws && !needs.privacyPolicy) {
    return { ok: true, corpNum, imported, skipped: [{ kind: "all", reason: "governance_documents_already_present" }], missing };
  }

  if (!needs.constitution && !needs.bylaws && needs.privacyPolicy) {
    return {
      ok: true,
      corpNum,
      imported,
      skipped,
      missing: [
        {
          kind: "privacyPolicy",
          reason: "not_available_from_bc_registry",
          message: "BC Registry filing history does not normally include a PIPA privacy policy.",
        },
      ],
    };
  }

  const exportInfo = await resolveBcRegistryExport(corpNum, Boolean(input.refresh));
  const records = await readBcRegistryFilingRecords(exportInfo.directory, corpNum);
  const candidates = pickGovernanceImportCandidates(records, exportInfo.directory);
  const importQueue: GovernanceImportCandidate[] = [];

  if (needs.constitution && needs.bylaws && candidates.constitution?.fileName === candidates.bylaws?.fileName) {
    importQueue.push({ ...candidates.constitution, kind: "constitutionAndBylaws", category: "Bylaws" });
  } else {
    if (needs.constitution && candidates.constitution) importQueue.push(candidates.constitution);
    if (needs.bylaws && candidates.bylaws) importQueue.push(candidates.bylaws);
  }

  if (needs.privacyPolicy && candidates.privacyPolicy) {
    importQueue.push(candidates.privacyPolicy);
  }

  const queuedKinds = new Set(importQueue.flatMap((candidate) => {
    if (candidate.kind === "constitutionAndBylaws") return ["constitution", "bylaws"];
    return [candidate.kind];
  }));
  for (const kind of ["constitution", "bylaws", "privacyPolicy"] as const) {
    if (!needs[kind]) continue;
    if (queuedKinds.has(kind)) continue;
    missing.push(
      kind === "privacyPolicy"
        ? {
            kind,
            reason: "not_available_from_bc_registry",
            message: "BC Registry filing history does not normally include a PIPA privacy policy.",
          }
        : {
            kind,
            reason: "no_registry_document_found",
            message: `No ${kind === "constitution" ? "constitution" : "bylaws"} document was found in the filing export.`,
          },
    );
  }

  if (input.stageOnly) {
    const session = await stageConnectorImportSession(client, convexCall, {
      societyId: input.societyId,
      name: `BC Registry governance documents - ${new Date().toISOString().slice(0, 10)}`,
      bundle: bcRegistryGovernanceDocumentsBundle(corpNum, importQueue, exportInfo),
    });
    return {
      ok: true,
      staged: true,
      corpNum,
      source: exportInfo.source,
      exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
      import: session,
      candidateDocuments: importQueue.length,
      imported,
      skipped,
      missing,
    };
  }

  for (const candidate of importQueue) {
    const copied = await copyGovernanceCandidateToDocumentStorage(candidate);
    const created: any = await convexCall(client, mutation("documents.createGovernanceDocumentFromLocalFile"), dropUndefined({
      societyId: input.societyId,
      documentKind: candidate.kind,
      title: candidate.title,
      category: candidate.category,
      fileName: candidate.fileName,
      mimeType: "application/pdf",
      fileSizeBytes: copied.fileSizeBytes,
      storageKey: copied.storageKey,
      sha256: copied.sha256,
      tags: [
        "bc-registry",
        "browser-connector",
        candidate.kind === "constitutionAndBylaws" ? "constitution" : candidate.kind,
        ...(candidate.kind === "constitutionAndBylaws" ? ["bylaws"] : []),
        ...(candidate.eventId ? [`bc-registry-event:${candidate.eventId}`] : []),
      ],
      sourceUrl: candidate.sourceUrl,
      changeNote: candidate.combined
        ? "Imported from BC Registry filing history; constitution appears to be bundled with bylaws."
        : "Imported from BC Registry filing history.",
      actingUserId: input.actingUserId,
    }));
    imported.push({
      kind: candidate.kind,
      title: candidate.title,
      fileName: candidate.fileName,
      filing: candidate.filing,
      dateFiled: candidate.dateFiled,
      documentName: candidate.documentName,
      reportName: candidate.reportName,
      eventId: candidate.eventId,
      documentId: created?.documentId,
      versionId: created?.versionId,
      linked: created?.linked,
    });
  }

  return {
    ok: true,
    corpNum,
    source: exportInfo.source,
    exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
    latestFiling: records[0]
      ? {
          filing: records[0].Filing,
          dateFiled: records[0]["Date Filed"],
        }
      : undefined,
    imported,
    skipped,
    missing,
  };
}

async function importBcRegistryFilingHistory(
  client: ConvexHttpClient,
  input: {
    societyId: string;
    actingUserId?: string;
    corpNum?: string;
    refresh?: boolean;
    importDocuments?: boolean;
    stageOnly?: boolean;
  },
) {
  const society: any = await convexCall(client, query("society.getById"), { id: input.societyId });
  if (!society) throw httpError(404, "society_not_found", "Society not found.");

  const corpNum = normalizeBcRegistryCorpNum(input.corpNum ?? society.incorporationNumber);
  if (!corpNum) {
    throw httpError(400, "bc_registry_corp_number_required", "A BC Registry incorporation number is required.");
  }

  const exportInfo = await resolveBcRegistryExport(corpNum, Boolean(input.refresh));
  const records = await readBcRegistryFilingRecords(exportInfo.directory, corpNum);
  const documentImport = input.importDocuments === false
    ? { byFilename: new Map<string, string>(), created: 0, reused: 0, skipped: 0 }
    : await importBcRegistryPdfDocuments(client, {
        societyId: input.societyId,
        actingUserId: input.actingUserId,
        exportDirectory: exportInfo.directory,
        records,
      });
  const filingRecords = buildBcRegistryFilingImportRecords({
    corpNum,
    exportDirectory: exportInfo.directory,
    records,
    documentIdsByFilename: documentImport.byFilename,
  });
  if (input.stageOnly) {
    const session = await stageConnectorImportSession(client, convexCall, {
      societyId: input.societyId,
      name: `BC Registry filing history - ${new Date().toISOString().slice(0, 10)}`,
      bundle: bcRegistryFilingHistoryBundle(corpNum, filingRecords, records, exportInfo),
    });
    return {
      ok: true,
      staged: true,
      corpNum,
      source: exportInfo.source,
      exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
      filingCount: filingRecords.length,
      import: session,
      documents: {
        created: documentImport.created,
        reused: documentImport.reused,
        skipped: documentImport.skipped,
        linkedFilingDocumentCount: filingRecords.reduce((sum, row: any) => sum + (row.sourceDocumentIds?.length ?? 0), 0),
      },
      latestFiling: records[0]
        ? {
            filing: records[0].Filing,
            dateFiled: records[0]["Date Filed"],
          }
        : undefined,
    };
  }
  const imported: any = await convexCall(client, mutation("filings.importBcRegistryHistory"), {
    societyId: input.societyId,
    records: filingRecords,
  });
  return {
    ok: true,
    corpNum,
    source: exportInfo.source,
    exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
    filingCount: filingRecords.length,
    inserted: imported?.inserted ?? 0,
    updated: imported?.updated ?? 0,
    documents: {
      created: documentImport.created,
      reused: documentImport.reused,
      skipped: documentImport.skipped,
      linkedFilingDocumentCount: filingRecords.reduce((sum, row: any) => sum + (row.sourceDocumentIds?.length ?? 0), 0),
    },
    latestFiling: records[0]
      ? {
          filing: records[0].Filing,
          dateFiled: records[0]["Date Filed"],
        }
      : undefined,
  };
}

async function importBylawsHistoryFromBcRegistry(
  client: ConvexHttpClient,
  input: {
    societyId: string;
    actingUserId?: string;
    corpNum?: string;
    refresh?: boolean;
  },
) {
  const society: any = await convexCall(client, query("society.getById"), { id: input.societyId });
  if (!society) throw httpError(404, "society_not_found", "Society not found.");

  const corpNum = normalizeBcRegistryCorpNum(input.corpNum ?? society.incorporationNumber);
  if (!corpNum) {
    throw httpError(400, "bc_registry_corp_number_required", "A BC Registry incorporation number is required.");
  }

  const exportInfo = await resolveBcRegistryExport(corpNum, Boolean(input.refresh));
  const records = await readBcRegistryFilingRecords(exportInfo.directory, corpNum);
  const documentImport = await importBcRegistryPdfDocuments(client, {
    societyId: input.societyId,
    actingUserId: input.actingUserId,
    exportDirectory: exportInfo.directory,
    records,
  });
  const bundle = await buildBcRegistryBylawsHistoryBundle({
    corpNum,
    exportDirectory: exportInfo.directory,
    publicDirectory: exportInfo.publicDirectory,
    records,
    documentIdsByFilename: documentImport.byFilename,
  });

  if (bundle.bylawAmendments.length === 0) {
    return {
      ok: true,
      corpNum,
      source: exportInfo.source,
      exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
      sessionId: null,
      candidateDocuments: 0,
      bylawAmendments: 0,
      visionQueue: 0,
      documents: {
        created: documentImport.created,
        reused: documentImport.reused,
        skipped: documentImport.skipped,
      },
      missing: [
        {
          reason: "no_bylaws_registry_rows",
          message: "No bylaws, constitution, Form 10, or special-resolution rows were found in the BC Registry export.",
        },
      ],
    };
  }

  const sessionId: any = await convexCall(client, mutation("importSessions.createFromBundle"), {
    societyId: input.societyId,
    name: `Bylaws history bot - BC Registry (${new Date().toISOString().slice(0, 10)})`,
    bundle,
  });

  return {
    ok: true,
    corpNum,
    source: exportInfo.source,
    exportDirectory: exportInfo.publicDirectory ?? path.relative(process.cwd(), exportInfo.directory),
    sessionId,
    candidateDocuments: bundle.sources.length,
    bylawAmendments: bundle.bylawAmendments.length,
    visionQueue: bundle.metadata.visionQueue,
    documents: {
      created: documentImport.created,
      reused: documentImport.reused,
      skipped: documentImport.skipped,
    },
  };
}

async function importBcRegistryPdfDocuments(
  client: ConvexHttpClient,
  input: {
    societyId: string;
    actingUserId?: string;
    exportDirectory: string;
    records: BcRegistryCsvRecord[];
  },
) {
  const existingDocuments: any[] = await convexCall(client, query("documents.list"), {
    societyId: input.societyId,
  });
  const byFilename = new Map<string, string>();
  for (const document of existingDocuments ?? []) {
    if (document?.fileName && document?._id) byFilename.set(document.fileName, document._id);
  }

  let created = 0;
  let reused = 0;
  let skipped = 0;
  const documentRows = uniqueBcRegistryDocumentRows(input.records);
  for (const row of documentRows) {
    const fileName = sanitizeFileName(path.basename(String(row.Filename ?? "")));
    if (!fileName) {
      skipped += 1;
      continue;
    }
    const sourcePath = path.join(input.exportDirectory, "pdfs", fileName);
    const eventId = row["Event ID"];
    const reportName = row["Report Name"];
    const tags = [
      "bc-registry",
      "browser-connector",
      "filing-evidence",
      ...(eventId ? [`bc-registry-event:${eventId}`] : []),
      ...(reportName ? [`bc-registry-report:${reportName}`] : []),
    ];
    const sourceExternalIds = [
      ...(eventId ? [`bc-registry:event:${eventId}`] : []),
      ...(eventId && reportName ? [`bc-registry:document:${eventId}:${reportName}`] : []),
      ...(fileName ? [`bc-registry:file:${fileName}`] : []),
    ];
    const existingId = byFilename.get(fileName);
    if (existingId) {
      const metadata = await readPdfMetadata(fileName, sourcePath).catch(() => null);
      await convexCall(client, mutation("documents.mergeConnectorDocumentMetadata"), dropUndefined({
        documentId: existingId,
        title: bcRegistryDocumentTitle(row),
        category: bcRegistryDocumentCategory(row),
        fileName,
        mimeType: "application/pdf",
        fileSizeBytes: metadata?.fileSizeBytes,
        sha256: metadata?.sha256,
        tags,
        sourceUrl: row.URL || undefined,
        sourceExternalIds,
        sourcePayloadJson: JSON.stringify(row),
        changeNote: "Imported from BC Registry filing-history export.",
      }));
      reused += 1;
      continue;
    }
    const copied = await copyPdfToDocumentStorage(fileName, sourcePath).catch(() => null);
    if (!copied) {
      skipped += 1;
      continue;
    }
    const result: any = await convexCall(client, mutation("documents.createLocalDocumentFromConnector"), dropUndefined({
      societyId: input.societyId,
      title: bcRegistryDocumentTitle(row),
      category: bcRegistryDocumentCategory(row),
      fileName,
      mimeType: "application/pdf",
      fileSizeBytes: copied.fileSizeBytes,
      storageKey: copied.storageKey,
      sha256: copied.sha256,
      tags,
      sourceUrl: row.URL || undefined,
      sourceExternalIds,
      sourcePayloadJson: JSON.stringify(row),
      changeNote: "Imported from BC Registry filing-history export.",
      actingUserId: input.actingUserId,
      skipDuplicateCheck: true,
    }));
    if (result?.documentId) {
      byFilename.set(fileName, result.documentId);
      if (result.reused) reused += 1;
      else created += 1;
    }
  }

  return { byFilename, created, reused, skipped };
}

async function buildBcRegistryBylawsHistoryBundle(input: {
  corpNum: string;
  exportDirectory: string;
  publicDirectory?: string;
  records: BcRegistryCsvRecord[];
  documentIdsByFilename: Map<string, string>;
}) {
  const groups = groupBcRegistryFilingRows(input.records.filter(isBcRegistryBylawsHistoryRow))
    .sort((a, b) => {
      const left = parseBcRegistryDate(a.rows[0]?.["Date Filed"]) ?? "";
      const right = parseBcRegistryDate(b.rows[0]?.["Date Filed"]) ?? "";
      return left.localeCompare(right) || a.key.localeCompare(b.key);
    });
  const sources: any[] = [];
  const bylawAmendments: any[] = [];
  let previousText = "";
  let visionQueue = 0;

  for (const group of groups) {
    for (const row of bcRegistryBylawsRowsToStage(group.rows)) {
      const eventId = firstNonEmpty(group.rows.map((item) => item["Event ID"]));
      const reportName = row["Report Name"];
      const rawFilename = String(row.Filename ?? "").trim();
      const fileName = rawFilename ? sanitizeFileName(path.basename(rawFilename)) : "";
      const sourcePath = fileName ? path.join(input.exportDirectory, "pdfs", fileName) : "";
      const filedAt = parseBcRegistryDate(row["Date Filed"]);
      const sourceExternalIds = uniqueStrings([
        eventId && reportName ? `bc-registry:document:${eventId}:${reportName}` : "",
        eventId ? `bc-registry:event:${eventId}` : "",
        eventId ? `bc-registry:event-id:${eventId}` : "",
        fileName ? `bc-registry:file:${fileName}` : "",
      ]);
      const primaryExternalId = sourceExternalIds[0] ?? `bc-registry:paper:${crypto.createHash("sha1").update(group.key).digest("hex").slice(0, 16)}`;
      const rawText = sourcePath ? await extractPdfTextWithPdftotext(sourcePath) : "";
      const fullBylaws = looksLikeFullBylawsText(rawText || `${row.Filing} ${row.Details} ${row["Document Name"]} ${row["Report Name"]}`);
      const fullBylawsVersion = isBcRegistryFullBylawsVersionRow(row) && fullBylaws;
      const needsVisionReview = cleanRegistryText(rawText).length < 300;
      if (needsVisionReview) visionQueue += 1;
      const proposedText = needsVisionReview
        ? registryVisionReviewMarkdown(row, fileName || undefined)
        : registryBylawsMarkdownFromText(rawText, bcRegistryBylawsSourceTitle(row));
      const status = fullBylawsVersion && !needsVisionReview ? "Filed" : "Draft";
      const confidence = fullBylawsVersion && !needsVisionReview ? "Medium" : "Review";
      const sourceDocumentId = fileName ? input.documentIdsByFilename.get(fileName) : undefined;
      const notes = [
        needsVisionReview
          ? "The registry PDF appears to be scanned or did not yield enough digital text. Run page-by-page vision transcription before approving."
          : "The registry PDF yielded digital text via pdftotext and was normalized into Markdown. Verify against the PDF before approval.",
        fullBylawsVersion
          ? "This looks like a complete filed bylaws version and can be compared against the previous full version."
          : "This is a supporting registry source, constitution, partial amendment, or paper-only filing reference. Keep it in review unless it is manually merged into a full bylaws version.",
        sourceDocumentId ? `Linked document: ${sourceDocumentId}.` : "No local source document was linked.",
      ].join(" ");

      sources.push({
        externalSystem: "bc-registry",
        externalId: primaryExternalId,
        title: bcRegistryBylawsSourceTitle(row),
        sourceDate: filedAt,
        category: "BC Registry Bylaws Source",
        confidence,
        notes,
        url: row.URL || undefined,
        localPath: sourcePath ? path.relative(process.cwd(), sourcePath) : undefined,
        fileName: fileName || undefined,
        tags: ["bc-registry", "bylaws", needsVisionReview ? "vision-review" : "pdf-text"],
      });

      bylawAmendments.push({
        title: `${status === "Filed" ? "Bylaws version" : "Bylaws source needing review"}: ${bcRegistryBylawsSourceTitle(row)}${filedAt ? ` (${filedAt})` : ""}`,
        status,
        baseText: fullBylawsVersion && !needsVisionReview ? previousText : "",
        proposedText,
        createdByName: "BC Registry bylaws history bot",
        createdAtISO: dateToStartIso(filedAt),
        updatedAtISO: dateToStartIso(filedAt),
        filedAtISO: status === "Filed" ? dateToStartIso(filedAt) : undefined,
        sourceDate: filedAt,
        sourceExternalIds,
        importedFrom: "BC Registry bylaws history bot",
        confidence,
        notes,
        sourceDocumentId,
        extractionPlan: needsVisionReview
          ? {
              mode: "page_by_page_vision",
              reason: "Digital PDF text extraction was sparse or unavailable.",
              reviewerInstruction: "Render each PDF page as an image, transcribe clauses in order, preserve numbering, and mark uncertain words with [[uncertain: ...]].",
            }
          : {
              mode: "pdftotext_markdown_normalization",
              reason: "Digital text was available from the registry PDF.",
            },
      });

      if (status === "Filed") previousText = proposedText;
    }
  }

  return {
    metadata: {
      name: "Bylaws history bot - BC Registry",
      createdFrom: "BC Registry filing-history export",
      corpNum: input.corpNum,
      exportDirectory: input.publicDirectory ?? path.relative(process.cwd(), input.exportDirectory),
      candidateDocuments: sources.length,
      bylawAmendments: bylawAmendments.length,
      visionQueue,
      note: "Registry PDFs were staged as review records. Digital PDFs are normalized to Markdown; scan-only PDFs are queued for page-by-page vision transcription.",
    },
    sources,
    bylawAmendments,
  };
}

function uniqueBcRegistryDocumentRows(records: BcRegistryCsvRecord[]) {
  const byFilename = new Map<string, BcRegistryCsvRecord>();
  for (const row of records) {
    if (row["Paper Only"] === "true" || !row.Filename) continue;
    if (!byFilename.has(row.Filename)) byFilename.set(row.Filename, row);
  }
  return [...byFilename.values()];
}

function isBcRegistryBylawsHistoryRow(row: BcRegistryCsvRecord) {
  const text = [
    row.Filing,
    row.Details,
    row["Document Name"],
    row["Report Name"],
    row.Filename,
  ].join(" ");
  if (!/\b(bylaws?|by-laws?|constitution|special resolution|copy of resolution|form\s*10|transition)\b/i.test(text)) {
    return false;
  }
  if (/\b(receipt|invoice|payment|annual report)\b/i.test(`${row["Document Name"]} ${row["Report Name"]}`) &&
    !/\b(bylaw|constitution|resolution)\b/i.test(text)) {
    return false;
  }
  return true;
}

function bestBcRegistryBylawsDocumentRow(rows: BcRegistryCsvRecord[]): BcRegistryCsvRecord {
  return rows.find((row) => /\bbylaws?|by-laws?\b/i.test(`${row["Document Name"]} ${row["Report Name"]}`) && row.Filename) ??
    rows.find((row) => /\bconstitution\b/i.test(`${row["Document Name"]} ${row["Report Name"]}`) && row.Filename) ??
    rows.find((row) => /\bspecial resolution|copy of resolution|form\s*10\b/i.test(`${row["Document Name"]} ${row["Report Name"]}`) && row.Filename) ??
    rows.find((row) => row.Filename) ??
    rows[0] ??
    {};
}

function bcRegistryBylawsRowsToStage(rows: BcRegistryCsvRecord[]) {
  const candidates = rows.filter((row) => {
    const descriptor = `${row["Document Name"] ?? ""} ${row["Report Name"] ?? ""}`;
    if (row.Filename) {
      return /\b(bylaws?|by-laws?|constitution|special resolution|copy of resolution|form\s*10|transition|bylawalteration)\b/i.test(descriptor);
    }
    return /\b(bylaws?|by-laws?|special resolution|registrar'?s order|copy of resolution|form\s*10)\b/i.test(`${row.Filing ?? ""} ${row.Details ?? ""}`);
  });
  const seen = new Set<string>();
  const unique = candidates.filter((row) => {
    const key = row.Filename || `${row.Filing}|${row["Date Filed"]}|${row.Details}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length ? unique : [bestBcRegistryBylawsDocumentRow(rows)].filter((row) => Object.keys(row).length);
}

function isBcRegistryFullBylawsVersionRow(row: BcRegistryCsvRecord) {
  return /\b(?:bylaws|by-laws)\b/i.test(`${row["Document Name"] ?? ""} ${row["Report Name"] ?? ""}`);
}

function bcRegistryBylawsSourceTitle(row: BcRegistryCsvRecord) {
  return row["Document Name"] || row["Report Name"] || compactBcRegistryFilingLabel(row.Filing ?? "") || "BC Registry bylaws source";
}

async function extractPdfTextWithPdftotext(sourcePath: string) {
  const exists = await stat(sourcePath).catch(() => null);
  if (!exists) return "";
  return await new Promise<string>((resolve) => {
    execFile(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", sourcePath, "-"],
      { timeout: 45_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) resolve("");
        else resolve(String(stdout ?? ""));
      },
    );
  });
}

function registryBylawsMarkdownFromText(raw: string, title: string) {
  const source = rebreakRegistryBylawsText(raw || title);
  const lines = source
    .split(/\n+/)
    .map((line) => normalizeRegistryBylawLine(line))
    .filter(Boolean);
  const out: string[] = [`# ${title}`];
  let previousWasHeading = true;

  for (const line of lines) {
    if (isRegistryPdfPageMarker(line)) continue;
    if (sameRegistryNormalizedText(line, title)) continue;

    if (/^(part|article)\s+[0-9ivxlcdm]+(\b|[:. -])/i.test(line)) {
      out.push("", `## ${line}`);
      previousWasHeading = true;
      continue;
    }
    if (/^(section|bylaw)\s+\d+(\b|[:. -])/i.test(line)) {
      out.push("", `### ${line}`);
      previousWasHeading = true;
      continue;
    }
    if (isLikelyRegistryStandaloneHeading(line)) {
      out.push("", `## ${line}`);
      previousWasHeading = true;
      continue;
    }
    if (/^\d+(?:\.\d+)*[.)]?\s+/.test(line) || /^\([a-z0-9ivxlcdm]+\)\s+/i.test(line)) {
      out.push(previousWasHeading ? line : `\n${line}`);
      previousWasHeading = false;
      continue;
    }

    out.push(line);
    previousWasHeading = false;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function registryVisionReviewMarkdown(row: BcRegistryCsvRecord, fileName?: string) {
  return [
    `# ${bcRegistryBylawsSourceTitle(row)}`,
    "",
    "## Vision transcription required",
    "",
    "The BC Registry PDF did not yield enough digital text to reconstruct this bylaws version safely.",
    "",
    "Reviewer checklist:",
    "",
    "1. Open the linked registry PDF.",
    "2. Render each page as an image and transcribe it in order.",
    "3. Preserve all headings, clause numbers, definitions, schedules, signatures, and handwritten annotations.",
    "4. Mark uncertain words as `[[uncertain: text]]` and missing/unreadable areas as `[[illegible: page N]]`.",
    "",
    `Filing: ${row.Filing || "BC Registry filing"}`,
    row["Date Filed"] ? `Date filed: ${row["Date Filed"]}` : "",
    fileName ? `File: ${fileName}` : "",
  ].filter(Boolean).join("\n");
}

function rebreakRegistryBylawsText(value: string) {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+(Part\s+[0-9IVXLCDM]+[:. -])/gi, "\n\n$1")
    .replace(/\s+((?:Article|Section|Bylaw)\s+\d+(?:\.\d+)*[:. -])/gi, "\n\n$1")
    .replace(/\s+(\d+(?:\.\d+)*[.)]\s+)/g, "\n$1")
    .replace(/\s+(\([a-z0-9ivxlcdm]+\)\s+)/gi, "\n$1")
    .trim();
}

function normalizeRegistryBylawLine(value: string) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function cleanRegistryText(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function looksLikeFullBylawsText(text: string) {
  const cleaned = cleanRegistryText(text);
  const score = [
    /\bbylaws?|by-laws?\b/i,
    /\bpart\s+\d+|article\s+\d+|section\s+\d+|\b\d+\.\s+[A-Z]/i,
    /\bmembers?\b/i,
    /\bdirectors?\b/i,
    /\bgeneral meetings?|annual general meeting|special general meeting\b/i,
    /\bquorum|vot(?:e|ing)|special resolution\b/i,
  ].reduce((sum, regex) => sum + (regex.test(cleaned) ? 1 : 0), 0);
  return score >= 4 && cleaned.length > 900;
}

function isRegistryPdfPageMarker(line: string) {
  return /^(page\s*)?\d+\s*(of\s+\d+)?$/i.test(line) ||
    /^-+\s*\d+\s*-+$/.test(line);
}

function sameRegistryNormalizedText(left: string, right: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalize(left) === normalize(right);
}

function isLikelyRegistryStandaloneHeading(line: string) {
  if (line.length < 4 || line.length > 90) return false;
  if (/[.!?]$/.test(line)) return false;
  if (/^(and|or|the|a|an|to|of|in|for)\b/i.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length > 10) return false;
  const capitalized = words.filter((word) => /^[A-Z0-9]/.test(word)).length;
  return capitalized >= Math.max(1, Math.ceil(words.length * 0.6));
}

function dateToStartIso(date: string | undefined) {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T00:00:00Z`;
  return new Date().toISOString();
}

function buildBcRegistryFilingImportRecords(input: {
  corpNum: string;
  exportDirectory: string;
  records: BcRegistryCsvRecord[];
  documentIdsByFilename: Map<string, string>;
}) {
  const groups = groupBcRegistryFilingRows(input.records);
  return groups.map((group) => {
    const row = group.rows[0];
    const eventId = firstNonEmpty(group.rows.map((item) => item["Event ID"]));
    const filedAt = parseBcRegistryDate(row["Date Filed"]);
    const dueDate = deriveBcRegistryDueDate(row) ?? filedAt ?? new Date().toISOString().slice(0, 10);
    const sourceDocumentIds = uniqueStrings(
      group.rows
        .map((item) => input.documentIdsByFilename.get(item.Filename))
        .filter((value): value is string => Boolean(value)),
    );
    const receiptDocumentId = group.rows
      .find((item) => /receipt/i.test(`${item["Report Name"]} ${item["Document Name"]}`))
      ?.Filename;
    const stagedPacketDocumentId = group.rows
      .find((item) => item.Filename && !/receipt/i.test(`${item["Report Name"]} ${item["Document Name"]}`))
      ?.Filename;
    const documentNames = group.rows
      .filter((item) => item.Filename)
      .map((item) => `${item["Document Name"] || item["Report Name"] || "Document"} (${item.Filename})`);
    const sourceKey = eventId
      ? `bc-registry:event:${eventId}`
      : `bc-registry:paper:${crypto.createHash("sha1").update(group.key).digest("hex").slice(0, 16)}`;
    return dropUndefined({
      kind: "RegistryRecord",
      periodLabel: deriveBcRegistryPeriodLabel(row),
      dueDate,
      filedAt,
      submissionMethod: "Online",
      status: "Filed",
      registryUrl: `https://www.bcregistry.ca/societies/${input.corpNum}/filingHistory`,
      receiptDocumentId: receiptDocumentId ? input.documentIdsByFilename.get(receiptDocumentId) : undefined,
      stagedPacketDocumentId: stagedPacketDocumentId ? input.documentIdsByFilename.get(stagedPacketDocumentId) : undefined,
      sourceDocumentIds,
      sourceExternalIds: uniqueStrings([
        sourceKey,
        ...(eventId ? [`bc-registry:event-id:${eventId}`] : []),
      ]),
      sourcePayloadJson: JSON.stringify({
        exportDirectory: path.relative(process.cwd(), input.exportDirectory),
        rows: group.rows,
      }),
      evidenceNotes: [
        "Imported from BC Registry filing history.",
        eventId ? `Event ID: ${eventId}.` : "Paper-only registry row.",
        `Filing: ${row.Filing}.`,
        row["Date Filed"] ? `Date filed: ${row["Date Filed"]}.` : "",
        documentNames.length ? `Documents: ${documentNames.join("; ")}.` : "Documents: Available on paper only.",
      ].filter(Boolean).join(" "),
      notes: row.Details || undefined,
    });
  });
}

function groupBcRegistryFilingRows(records: BcRegistryCsvRecord[]) {
  const groups = new Map<string, { key: string; rows: BcRegistryCsvRecord[] }>();
  for (const row of records) {
    const eventId = row["Event ID"];
    const key = eventId
      ? `event:${eventId}`
      : `paper:${row.Filing}|${row["Date Filed"]}|${row.Details}`;
    const group = groups.get(key) ?? { key, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function normalizeBcRegistryCorpNum(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase().replace(/-/g, "");
  if (!text) return "";
  if (!/^[A-Z0-9]+$/.test(text)) {
    throw httpError(400, "invalid_bc_registry_corp_number", "BC Registry incorporation number is invalid.");
  }
  return text;
}

async function resolveBcRegistryExport(corpNum: string, refresh: boolean) {
  const existing = refresh ? null : await latestBcRegistryExport(corpNum);
  if (existing) return { ...existing, source: "latest-export" as const };

  const exported = await runBcRegistryExportFromActiveSession(corpNum).catch(async (error) => {
    const fallback = await latestBcRegistryExport(corpNum);
    if (fallback) return { ...fallback, source: "latest-export" as const, warning: error?.message };
    throw error;
  });
  return exported;
}

function browserConnectorExportRoot() {
  return path.resolve(process.cwd(), "browser-connector-exports");
}

async function latestBcRegistryExport(corpNum: string) {
  const root = browserConnectorExportRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ directory: string; publicDirectory: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${corpNum}-`)) continue;
    const directory = path.join(root, entry.name);
    const csvPath = path.join(directory, `${corpNum}_filing_history.csv`);
    const [dirStat, csv] = await Promise.all([
      stat(directory).catch(() => null),
      readFile(csvPath).catch(() => null),
    ]);
    if (!dirStat || !csv) continue;
    candidates.push({
      directory,
      publicDirectory: path.posix.join("browser-connector-exports", entry.name),
      mtimeMs: dirStat.mtimeMs,
    });
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
}

async function runBcRegistryExportFromActiveSession(corpNum: string) {
  const sessionsPayload: any = await connectorRunnerRequest("GET", "/sessions");
  const sessions: any[] = Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [];
  const session =
    sessions.find((item) => item?.connectorId === "bc-registry" && String(item?.currentUrl ?? "").includes(`/societies/${corpNum}/`)) ??
    sessions.find((item) => item?.connectorId === "bc-registry");
  if (!session?.sessionId) {
    throw httpError(
      409,
      "bc_registry_login_required",
      "Open a BC Registry browser app session, sign in, and navigate to the filing history page.",
    );
  }

  const output: any = await connectorRunnerRequest(
    "POST",
    `/connectors/bc-registry/auth/sessions/${encodeURIComponent(session.sessionId)}/actions/filingHistoryExport`,
    { corpNum, includePdfProbe: true, downloadPdfs: true },
  );
  const publicDirectory =
    typeof output?.download?.exportPublicDirectory === "string"
      ? output.download.exportPublicDirectory
      : undefined;
  if (publicDirectory) {
    return {
      directory: path.resolve(process.cwd(), publicDirectory),
      publicDirectory,
      source: "active-session" as const,
      exportResult: {
        filingCount: output?.filingCount,
        documentCount: output?.documentCount,
        downloadedCount: output?.download?.downloadedCount,
        failedCount: output?.download?.failedCount,
      },
    };
  }

  const latest = await latestBcRegistryExport(corpNum);
  if (latest) return { ...latest, source: "active-session" as const };
  throw httpError(502, "bc_registry_export_missing", "BC Registry export completed without a local export directory.");
}

async function readBcRegistryFilingRecords(exportDirectory: string, corpNum: string): Promise<BcRegistryCsvRecord[]> {
  const csv = await readFile(path.join(exportDirectory, `${corpNum}_filing_history.csv`), "utf8").catch(() => null);
  if (!csv) throw httpError(404, "bc_registry_export_csv_missing", "BC Registry filing export CSV was not found.");
  const rows = parseCsv(csv);
  const [headers, ...data] = rows;
  if (!headers?.length) return [];
  return data.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function pickGovernanceImportCandidates(records: BcRegistryCsvRecord[], exportDirectory: string) {
  const docs = records.filter((row) => row["Paper Only"] !== "true" && row.Filename);
  const byReport = (pattern: RegExp) =>
    docs.find((row) => pattern.test(row["Report Name"] ?? "") || pattern.test(row["Document Name"] ?? ""));
  const bylaws = byReport(/^bylaws$/i) ?? byReport(/bylaw/i);
  const standaloneConstitution = byReport(/^constitution$/i);
  const constitution = standaloneConstitution ?? (bylaws ? { ...bylaws, __combinedConstitution: "true" } : undefined);
  const privacyPolicy =
    byReport(/\bpipa\b/i) ??
    byReport(/privacy/i) ??
    docs.find((row) => /personal information|privacy/i.test(`${row.Filing} ${row.Details}`));

  return {
    constitution: constitution
      ? candidateFromRegistryRow(
          constitution,
          exportDirectory,
          standaloneConstitution ? "constitution" : "constitutionAndBylaws",
          standaloneConstitution ? "Constitution" : "Bylaws",
          standaloneConstitution ? "Constitution - BC Registry" : "Constitution and Bylaws - BC Registry",
          !standaloneConstitution,
        )
      : undefined,
    bylaws: bylaws
      ? candidateFromRegistryRow(bylaws, exportDirectory, "bylaws", "Bylaws", "Bylaws - BC Registry")
      : undefined,
    privacyPolicy: privacyPolicy
      ? candidateFromRegistryRow(privacyPolicy, exportDirectory, "privacyPolicy", "Policy", "Privacy policy - BC Registry")
      : undefined,
  };
}

function candidateFromRegistryRow(
  row: BcRegistryCsvRecord,
  exportDirectory: string,
  kind: GovernanceImportCandidate["kind"],
  category: string,
  baseTitle: string,
  combined = false,
): GovernanceImportCandidate {
  const fileName = sanitizeFileName(path.basename(String(row.Filename ?? "")));
  const dateFiled = row["Date Filed"] || undefined;
  const title = `${baseTitle}${dateFiled ? ` (${dateFiled.replace(/\s+\d{1,2}:\d{2}\s*[AP]M$/i, "")})` : ""}`;
  return {
    kind,
    title,
    category,
    fileName,
    sourcePath: path.join(exportDirectory, "pdfs", fileName),
    sourceUrl: row.URL || undefined,
    filing: row.Filing || undefined,
    dateFiled,
    documentName: row["Document Name"] || undefined,
    reportName: row["Report Name"] || undefined,
    eventId: row["Event ID"] || undefined,
    combined,
  };
}

async function copyGovernanceCandidateToDocumentStorage(candidate: GovernanceImportCandidate) {
  return copyPdfToDocumentStorage(candidate.fileName, candidate.sourcePath);
}

async function readPdfMetadata(fileName: string, sourcePath: string) {
  const pdf = await readFile(sourcePath).catch(() => null);
  if (!pdf) {
    throw httpError(404, "bc_registry_export_pdf_missing", `${fileName} was not found in the BC Registry export.`);
  }
  if (pdf.byteLength === 0 || pdf.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw httpError(400, "bc_registry_export_pdf_invalid", `${fileName} is not a PDF file.`);
  }
  return {
    pdf,
    fileSizeBytes: pdf.byteLength,
    sha256: crypto.createHash("sha256").update(pdf).digest("hex"),
  };
}

async function copyPdfToDocumentStorage(fileName: string, sourcePath: string) {
  const metadata = await readPdfMetadata(fileName, sourcePath);
  const storageKey = `${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
  await mkdir(generatedWorkflowDocumentDir(), { recursive: true });
  await writeFile(path.join(generatedWorkflowDocumentDir(), storageKey), metadata.pdf);
  return {
    storageKey,
    fileSizeBytes: metadata.fileSizeBytes,
    sha256: metadata.sha256,
  };
}

function bcRegistryDocumentTitle(row: BcRegistryCsvRecord) {
  const name = row["Document Name"] || row["Report Name"] || "BC Registry document";
  const date = parseBcRegistryDate(row["Date Filed"]);
  return `${name} - BC Registry${date ? ` (${date})` : ""}`;
}

function bcRegistryDocumentCategory(row: BcRegistryCsvRecord) {
  const text = `${row["Report Name"]} ${row["Document Name"]}`;
  if (/receipt/i.test(text)) return "Receipt";
  if (/constitution/i.test(text)) return "Constitution";
  if (/bylaw/i.test(text)) return "Bylaws";
  return "Filing";
}

function parseBcRegistryDate(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})\b/);
  if (!match) return undefined;
  const month = monthNumber(match[1]);
  if (!month) return undefined;
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function monthNumber(value: string) {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.findIndex((month) => value.toLowerCase().startsWith(month));
  return index >= 0 ? String(index + 1).padStart(2, "0") : undefined;
}

function deriveBcRegistryDueDate(row: BcRegistryCsvRecord) {
  if (/annual report/i.test(row.Filing ?? "")) {
    const agmDate = parseBcRegistryDate(row.Filing.replace(/^.*\bAGM:\s*/i, ""));
    if (agmDate) return addDaysISO(agmDate, 30);
  }
  return parseBcRegistryDate(row["Date Filed"]);
}

function addDaysISO(dateISO: string, days: number) {
  const [year, month, day] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function deriveBcRegistryPeriodLabel(row: BcRegistryCsvRecord) {
  const filing = row.Filing ?? "";
  const annualYear = filing.match(/\b(\d{4})\s+BC\s+Annual\s+Report\b/i)?.[1];
  if (annualYear) return annualYear;
  const filedAt = parseBcRegistryDate(row["Date Filed"]);
  const year = filedAt?.slice(0, 4);
  const label = compactBcRegistryFilingLabel(filing);
  return year ? `${year} ${label}` : label;
}

function compactBcRegistryFilingLabel(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (/change of directors/i.test(text)) return "Change of Directors";
  if (/bylaw/i.test(text)) return "Bylaw Alteration";
  if (/transition/i.test(text)) return "Transition";
  if (/incorporat/i.test(text)) return "Incorporation";
  if (/special resolution|registrar/i.test(text)) return "Special Resolution";
  if (/annual report/i.test(text)) return "Annual Report";
  return text.replace(/\bApplication\b/gi, "").trim().slice(0, 80) || "Registry Record";
}

function firstNonEmpty(values: string[]) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim())));
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

export {
  importGovernanceDocumentsFromBcRegistry,
  importBcRegistryFilingHistory,
  importBylawsHistoryFromBcRegistry,
  importBcRegistryPdfDocuments,
  buildBcRegistryBylawsHistoryBundle,
  uniqueBcRegistryDocumentRows,
  isBcRegistryBylawsHistoryRow,
  bestBcRegistryBylawsDocumentRow,
  bcRegistryBylawsRowsToStage,
  isBcRegistryFullBylawsVersionRow,
  bcRegistryBylawsSourceTitle,
  extractPdfTextWithPdftotext,
  registryBylawsMarkdownFromText,
  registryVisionReviewMarkdown,
  rebreakRegistryBylawsText,
  normalizeRegistryBylawLine,
  cleanRegistryText,
  looksLikeFullBylawsText,
  isRegistryPdfPageMarker,
  sameRegistryNormalizedText,
  isLikelyRegistryStandaloneHeading,
  dateToStartIso,
  buildBcRegistryFilingImportRecords,
  groupBcRegistryFilingRows,
  normalizeBcRegistryCorpNum,
  resolveBcRegistryExport,
  browserConnectorExportRoot,
  latestBcRegistryExport,
  runBcRegistryExportFromActiveSession,
  readBcRegistryFilingRecords,
  pickGovernanceImportCandidates,
  candidateFromRegistryRow,
  copyGovernanceCandidateToDocumentStorage,
  readPdfMetadata,
  copyPdfToDocumentStorage,
  bcRegistryDocumentTitle,
  bcRegistryDocumentCategory,
  parseBcRegistryDate,
  monthNumber,
  deriveBcRegistryDueDate,
  addDaysISO,
  deriveBcRegistryPeriodLabel,
  compactBcRegistryFilingLabel,
  firstNonEmpty,
  uniqueStrings,
  parseCsv,
};
