import { recordsFromBundle } from "./functions/importSessionHelpers/importSessionRecordKinds";
import { excerptOf, infoTypeForBundlePath, type PreflightGapDraft } from "./gapCatalog";

/** Bundle names accepted by recordsFromBundle. Aliases in a group are exclusive. */
export const IMPORT_BUNDLE_COLLECTION_GROUPS: readonly (readonly string[])[] = [
  ["sources"], ["facts"], ["events"], ["boardTerms"], ["motions"], ["meetingMinutes"],
  ["budgets"], ["filings"], ["deadlines"], ["bylawAmendments"], ["publications"],
  ["insurancePolicies"], ["financialStatements"], ["financialStatementImports"], ["grants"],
  ["recordsLocations"], ["archiveAccessions"], ["boardRoleAssignments"], ["boardRoleChanges"],
  ["signingAuthorities"], ["meetingAttendance"], ["motionEvidence"], ["budgetSnapshots"],
  ["treasurerReports"], ["transactionCandidates"], ["organizationAddresses"],
  ["organizationRegistrations"], ["organizationIdentifiers"], ["taxRegistrations"], ["policies"],
  ["workflowPackages"], ["minuteBookItems"], ["roleHolders", "representatives"],
  ["rightsClasses", "shareClasses"], ["rightsholdingTransfers", "shareTransfers"],
  ["serviceProviders"], ["dividends"], ["nameHistory"], ["constatingEvents"],
  ["significantIndividualSteps"], ["assets"], ["shareCertificates"],
  ["legalTemplateDataFields", "dataFields"], ["legalTemplates", "templates"],
  ["legalPrecedents", "parts", "partPrecedents"], ["legalPrecedentRuns", "partRuns"],
  ["generatedLegalDocuments", "draftDocuments"], ["legalSigners", "signers"],
  ["formationRecords", "incorporations"], ["nameSearchItems", "nameSearches"],
  ["entityAmendments", "amendments"], ["annualMaintenanceRecords", "annualGeneralMeetings"],
  ["jurisdictionMetadata"], ["supportLogs", "logs"], ["sourceEvidence"], ["secretVaultItems"],
  ["pipaTrainings"], ["employees"], ["volunteers"],
  ["committees"], ["committeeMembers"], ["members"], ["directors"], ["tasks"], ["goals"],
  ["commitments"], ["fundingSources"], ["grantReports"], ["meetingMaterials"],
  ["organizationSeats"], ["conflicts"], ["proxies"], ["bylawRuleSets"], ["operatingBudgets"],
  ["documentMap"], ["representationGaps"],
];

const metadataKeys = new Set(["metadata", "name", "sourceExport", "specialistReports"]);
const collectionKeys = new Set(IMPORT_BUNDLE_COLLECTION_GROUPS.flat());
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A preflight loss with its location and the value that would be lost. */
type PreflightFinding = { message: string; location: string; kind: "unsupported_key" | "dropped" | "other"; value?: unknown };

/** Checks staging losses; it does not certify native-table promotion or source truth. */
export function importBundlePreflightIssues(bundle: unknown): string[] {
  return importBundlePreflightFindings(bundle).map((finding) => finding.message);
}

/**
 * Preflight losses as typed representation-gap rows (finding A14): every
 * unsupported bundle key and every field normalization would discard becomes
 * a `representationGaps` draft, so the loss can be counted and triaged rather
 * than only printed. Structural errors (wrong JSON shape) are not gaps.
 */
export function importBundlePreflightGaps(bundle: unknown): PreflightGapDraft[] {
  return importBundlePreflightFindings(bundle).flatMap((finding): PreflightGapDraft[] => {
    if (finding.kind === "other") return [];
    const mapped = infoTypeForBundlePath(finding.location);
    const sourceExternalId = sourceExternalIdAt(bundle, finding.location);
    return [{
      infoType: mapped.infoType,
      reason: finding.kind === "unsupported_key" ? "no_import_key" : "import_dropped",
      title: finding.kind === "unsupported_key"
        ? `Unsupported bundle key ${finding.location}`
        : `Import would drop ${finding.location}`,
      location: finding.location,
      excerpt: excerptOf(finding.value),
      proposedTargetTable: mapped.proposedTargetTable,
      proposedField: mapped.proposedField,
      proposedValue: finding.kind === "dropped" && (typeof finding.value !== "object" || finding.value === null) ? finding.value : undefined,
      ...(sourceExternalId ? { sourceExternalId } : {}),
    }];
  });
}

function sourceExternalIdAt(bundle: unknown, location: string): string | undefined {
  const match = location.match(/^([A-Za-z]+)\[(\d+)\]/);
  if (!match || !isObject(bundle)) return undefined;
  const row = (bundle as any)[match[1]]?.[Number(match[2])];
  const ids = row?.sourceExternalIds;
  if (Array.isArray(ids) && typeof ids[0] === "string") return ids[0];
  return typeof row?.externalId === "string" ? row.externalId : undefined;
}

function importBundlePreflightFindings(bundle: unknown): PreflightFinding[] {
  if (!isObject(bundle)) return [{ message: "bundle: expected a JSON object", location: "bundle", kind: "other" }];
  const findings: PreflightFinding[] = [];
  const issues = { push: (message: string, location = "bundle", kind: PreflightFinding["kind"] = "other", value?: unknown) => findings.push({ message, location, kind, value }) };
  for (const group of IMPORT_BUNDLE_COLLECTION_GROUPS) {
    const present = group.filter((key) => Object.hasOwn(bundle, key));
    if (present.length > 1) {
      issues.push(`${present.join(" / ")}: alias collision; merge into ${group[0]} because the importer only reads the first present alias`, group[0]);
    }
  }
  for (const [key, value] of Object.entries(bundle)) {
    if (metadataKeys.has(key)) continue;
    if (!collectionKeys.has(key)) {
      issues.push(`${key}: unsupported bundle key; preserve unsupported evidence in sourceEvidence or metadata instead`, key, "unsupported_key", value);
      continue;
    }
    if (!Array.isArray(value)) {
      issues.push(`${key}: expected an array; the importer would silently ignore this value`, key);
      continue;
    }
    value.forEach((payload, index) => {
      const location = `${key}[${index}]`;
      if (!isObject(payload)) {
        issues.push(`${location}: expected a record object`, location);
        return;
      }
      try {
        // Probe one record at a time to avoid deduplication masking field losses.
        const normalized = recordsFromBundle({ sources: bundle.sources, [key]: [payload] }).filter(record => key === "sources" || record.recordKind !== "source");
        if (normalized.length !== 1) {
          issues.push(`${location}: importer produced ${normalized.length} records; expected one`, location);
          return;
        }
        collectLosses(payload, normalized[0].payload, location, issues);
      } catch {
        issues.push(`${location}: importer could not normalize this record; check its field types`, location);
      }
    });
  }
  if (!findings.length && recordsFromBundle(bundle).length === 0) {
    issues.push("bundle: no supported records to stage");
  }
  return findings;
}

/** Accepted input aliases: the value survives under its canonical field name. */
const FIELD_ALIASES: Record<string, readonly string[]> = {
  number: ["itemNumber"], startTime: ["scheduledTimeText", "localStartText"], time: ["scheduledTimeText"],
  endTime: ["localEndText"], action: ["requestedAction"], responsibility: ["presenter"], body: ["bodyKey", "body"],
  bodyKey: ["body"], date: ["at"], adoptsMinutesDate: ["adoptsMinutes"], dissentBy: ["opposedBy"],
};

function aliasPreserved(key: string, value: unknown, after: Record<string, unknown>): boolean {
  return (FIELD_ALIASES[key] ?? []).some((alias) => {
    const kept = after[alias];
    if (kept === undefined || kept === null) return false;
    if (typeof value === "string" && typeof kept === "string") return kept.trim().toLowerCase() === value.trim().toLowerCase();
    if (typeof value === "string" && isObject(kept)) return Object.values(kept).some((entry) => typeof entry === "string" && entry.trim() === value.trim());
    return JSON.stringify(kept) === JSON.stringify(value);
  });
}

type FindingSink = { push: (message: string, location?: string, kind?: PreflightFinding["kind"], value?: unknown) => void };

function collectLosses(before: unknown, after: unknown, location: string, issues: FindingSink): void {
  if (before === undefined || before === null) return;
  if (after === undefined || after === null) {
    if (before === "" || (Array.isArray(before) && before.length === 0)) return;
    issues.push(`${location}: normalization would discard this field; use a supported field or preserve it as sourceEvidence`, location, "dropped", before);
    return;
  }
  if (Array.isArray(before)) {
    if (!Array.isArray(after) || before.length !== after.length) {
      issues.push(`${location}: normalization would discard or collapse array items; review the source rows`, location, "dropped", before);
      return;
    }
    before.forEach((item, index) => collectLosses(item, after[index], `${location}[${index}]`, issues));
  } else if (isObject(before)) {
    if (!isObject(after)) {
      issues.push(`${location}: normalization would replace a structured object; use the expected field type`, location, "dropped", before);
      return;
    }
    for (const [key, value] of Object.entries(before)) {
      if ((after[key] === undefined || after[key] === null) && value !== undefined && value !== null && aliasPreserved(key, value, after)) continue;
      collectLosses(value, after[key], `${location}.${key}`, issues);
    }
  } else if (Array.isArray(after) || isObject(after)) {
    // The native minutes contract explicitly accepts a string action item and
    // expands it to { text, done }; that transformation preserves the input.
    if (typeof before === "string" && /\.actionItems\[\d+\]$/.test(location)
      && isObject(after) && after.text === before.trim()) return;
    // Named people (abstainers, dissenters) expand "Name" to { name }.
    if (typeof before === "string" && /\.(?:abstainedBy|opposedBy|dissentBy)\[\d+\]$/.test(location)
      && isObject(after) && after.name === before.trim()) return;
    // A plain next-meeting date expands to { at } (or { dateText }).
    if (typeof before === "string" && /\.nextMeetings\[\d+\]$/.test(location)
      && isObject(after) && (after.at === before.trim() || after.dateText === before.trim())) return;
    issues.push(`${location}: expected structured data; normalization would replace this scalar`, location, "dropped", before);
  }
}

export function assertImportBundlePreflight(bundle: unknown): void {
  const issues = importBundlePreflightIssues(bundle);
  if (issues.length) throw new Error(`Import bundle preflight failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
}
