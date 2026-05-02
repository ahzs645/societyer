export type BcRegistryCsvRecord = Record<string, string>;

export type GovernanceImportCandidate = {
  kind: "constitution" | "bylaws" | "constitutionAndBylaws" | "privacyPolicy";
  title: string;
  category: string;
  fileName: string;
  sourcePath: string;
  sourceUrl?: string;
  filing?: string;
  dateFiled?: string;
  documentName?: string;
  reportName?: string;
  eventId?: string;
  combined?: boolean;
};

export function bcRegistryGovernanceDocumentsBundle(
  corpNum: string,
  candidates: GovernanceImportCandidate[],
  exportInfo: any,
) {
  return {
    metadata: {
      createdFrom: "BC Registry browser connector",
      sourceSystem: "bc-registry",
      importedFrom: "BC Registry browser connector",
      corpNum,
      stagedAtISO: new Date().toISOString(),
      exportDirectory: exportInfo.publicDirectory ?? exportInfo.directory,
    },
    sources: candidates.map((candidate) => ({
      externalSystem: "bc-registry",
      externalId: candidate.eventId ? `bc-registry:event:${candidate.eventId}` : `bc-registry:file:${candidate.fileName}`,
      title: candidate.title,
      sourceDate: candidate.dateFiled,
      category: candidate.category,
      url: candidate.sourceUrl,
      localPath: candidate.sourcePath,
      fileName: candidate.fileName,
      mimeType: "application/pdf",
      notes: `Candidate ${candidate.kind} document from BC Registry filing history.`,
      tags: ["bc-registry", "browser-connector", candidate.kind],
    })),
    documentMap: candidates.map((candidate) => ({
      title: candidate.title,
      category: candidate.category,
      externalSystem: "bc-registry",
      externalId: candidate.eventId ? `bc-registry:event:${candidate.eventId}` : `bc-registry:file:${candidate.fileName}`,
      url: candidate.sourceUrl,
      localPath: candidate.sourcePath,
      fileName: candidate.fileName,
      mimeType: "application/pdf",
      tags: ["bc-registry", "browser-connector", candidate.kind],
      notes: `Review before linking as ${candidate.kind}.`,
    })),
  };
}

export function bcRegistryFilingHistoryBundle(
  corpNum: string,
  filingRecords: any[],
  rawRecords: BcRegistryCsvRecord[],
  exportInfo: any,
) {
  return {
    metadata: {
      createdFrom: "BC Registry browser connector",
      sourceSystem: "bc-registry",
      importedFrom: "BC Registry browser connector",
      corpNum,
      stagedAtISO: new Date().toISOString(),
      exportDirectory: exportInfo.publicDirectory ?? exportInfo.directory,
    },
    sources: [
      {
        externalSystem: "bc-registry",
        externalId: `bc-registry:filing-history:${corpNum}`,
        title: `BC Registry filing history ${corpNum}`,
        category: "Filing records",
        notes: "Filing-history export staged from a user-authorized BC Registry browser connector run.",
        tags: ["bc-registry", "browser-connector", "filings"],
      },
    ],
    filings: filingRecords.map((record, index) => ({
      ...record,
      sourceExternalIds: [
        record.eventId ? `bc-registry:event:${record.eventId}` : undefined,
        record.confirmationNumber ? `bc-registry:confirmation:${record.confirmationNumber}` : undefined,
        `bc-registry:row:${corpNum}:${index + 1}`,
      ].filter(Boolean),
      evidenceNotes: record.evidenceNotes ?? "Staged from BC Registry filing-history export.",
      status: record.status ?? "NeedsReview",
    })),
    sourceEvidence: rawRecords.slice(0, 250).map((record, index) => ({
      sourceExternalIds: [
        record.EventId ? `bc-registry:event:${record.EventId}` : undefined,
        `bc-registry:raw-row:${corpNum}:${index + 1}`,
      ].filter(Boolean),
      title: compactBcRegistryFilingLabel(record.Filing ?? record["Document Name"] ?? `Registry row ${index + 1}`),
      sourceSystem: "bc-registry",
      sourceDate: record["Date Filed"],
      contentType: "registry-row",
      summary: compactStrings([
        record.Filing,
        record.Details,
        record["Document Name"],
        record["Report Name"],
        record.Filename,
      ]).join(" · "),
      confidence: "browser-connector",
      notes: "Raw BC Registry filing-history row preserved for review.",
    })),
  };
}

function compactBcRegistryFilingLabel(value: string) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[A-Z]{2,}-?\d{4,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim() || "BC Registry filing";
}

function compactStrings(values: unknown[]) {
  return values.map(stringValue).filter((value): value is string => Boolean(value));
}

function stringValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
