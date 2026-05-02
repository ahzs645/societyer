export function gcosProjectSnapshotImportBundle(normalizedGrant: any, snapshot: any) {
  const sourceExternalIds = Array.isArray(normalizedGrant?.sourceExternalIds)
    ? normalizedGrant.sourceExternalIds
    : [];
  return {
    metadata: {
      createdFrom: "GCOS browser connector",
      sourceSystem: "gcos",
      importedFrom: "GCOS browser connector",
      stagedAtISO: new Date().toISOString(),
      projectId: snapshot?.projectId,
      programCode: snapshot?.programCode,
    },
    sources: [
      {
        externalSystem: "gcos",
        externalId: sourceExternalIds[0] ?? (snapshot?.projectId ? `gcos:project:${snapshot.projectId}` : undefined),
        title: normalizedGrant?.title ?? "GCOS project snapshot",
        category: "Grant records",
        url: snapshot?.currentUrl,
        notes: "Staged from a read-only GCOS browser connector snapshot.",
        tags: ["gcos", "browser-connector", "grant"],
      },
    ],
    grants: [
      {
        ...normalizedGrant,
        status: normalizedGrant?.status ?? "Submitted",
        sensitivity: normalizedGrant?.sensitivity ?? "contains-government-funding-records",
        riskFlags: [
          "Review imported GCOS data before relying on deadlines or amounts.",
          ...arrayOf(normalizedGrant?.riskFlags).map(String),
        ],
      },
    ],
  };
}

function arrayOf(value: any): any[] {
  return Array.isArray(value) ? value : [];
}
