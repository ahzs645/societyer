/** Stage 9–11 output: a validated import bundle (current accepted collections)
 * plus `representationGaps` (schema.md §5a shape) and a native-coverage report.
 * The bundle stages everything as Pending review; nothing is promoted here. */
import { importBundlePreflightIssues, IMPORT_BUNDLE_COLLECTION_GROUPS } from "../importBundlePreflight";
import { recordsFromBundle } from "../functions/importSessionHelpers/importSessionRecordKinds";
import type { ClassificationPrior } from "./classify";
import type { IntakeCluster } from "./cluster";
import type { Disposition } from "./junk";
import { redact, type ProcessingLogEntry, type Sensitivity } from "./privacy";
import { PROVIDER_EXCLUDED_CLASSES } from "./classify";
import type { ActionChain, RecordGap, ReconcileLink, ReconciledMeeting } from "./reconcile";
import type { ExtractionEnvelope, FieldValue, Locator, UnsupportedDetail } from "./schemas/common";
import { isFieldValue, type VerificationSummary } from "./verify";
import { AFFECTED_TABLE, classBundleRecords } from "./bundleClasses";
import { markEvidenceVerified } from "./evidenceRule";

export type IntakeFileRecord = {
  fileKey: string;
  name: string;
  path: string;
  driveId?: string;
  revision?: string;
  md5?: string;
  sha256?: string;
  mimeType?: string;
  sizeBytes?: number;
  modifiedTime?: string;
  url?: string;
  localPath?: string;
  acquisitionStatus: "listed" | "downloaded" | "local" | "failed" | "skipped";
  disposition: Disposition;
  dispositionReason?: string;
  classification?: ClassificationPrior;
  sensitivity?: Sensitivity;
  clusterKey?: string;
  extractMethod?: string;
  textLength?: number;
};
export type IntakeExtractionResult = ExtractionEnvelope & {
  verification?: VerificationSummary;
  fileKey: string;
  /** Derived records (minutes embedded in a package) point at the file they were found in. */
  parentFileKey?: string;
};
export type IntakeRunResult = {
  runId: string;
  name: string;
  sourceKind: "local_folder" | "drive_inventory" | "upload";
  sourceRoot: string;
  startedAtISO: string;
  completedAtISO?: string;
  engine: { minutes: string; llm?: { provider: string; model: string } };
  files: IntakeFileRecord[];
  clusters: IntakeCluster[];
  extractions: IntakeExtractionResult[];
  reconciliation: {
    meetings: ReconciledMeeting[];
    links: ReconcileLink[];
    gaps: RecordGap[];
    actionChains: ActionChain[];
    /** WP-L: meetings shown by an agenda/package/AGM material with no minutes ("held, minutes missing"). */
    evidencedMeetings?: Array<{ meetingKey: string; bodyKey: string; date: string; fileId: string; kind: string }>;
    /** WP-L: policy/bylaw versions linked to the motion that adopted them. */
    policyAdoptions?: Array<ReconcileLink & { meetingDate: string; bodyKey: string; motionIndex: number }>;
    /** WP-L: detected change of fiscal year end across annual statements. */
    fiscalYearEndChanges?: Array<{ fileKey: string; from: string; to: string; firstYear: number }>;
  };
  /** WP-L: the organization the records belong to (most frequent society name in the corpus). */
  organizationName?: string;
  processingLog: ProcessingLogEntry[];
  /** Stage 7: people seen across the run, with spelling variants folded together. */
  people?: Array<{ id: string; fullName: string; aliases: string[]; occurrences: number }>;
  /** Full extracted text per file key (kept out of the bundle for restricted files). */
  texts?: Record<string, string>;
};

const val = <T,>(field: FieldValue<T> | undefined): T | undefined => (field && (field.status === "stated" || field.status === "inferred" || field.status === "conflicting") ? field.value : undefined);
const personName = (field: FieldValue<{ nameAsWritten: string; resolvedName?: string }> | undefined) => {
  const value = val(field);
  return value ? value.resolvedName ?? value.nameAsWritten : undefined;
};
function locatorRef(locators: Locator[] | undefined): string | undefined {
  const locator = locators?.[0];
  if (!locator) return undefined;
  return [locator.page ? `p.${locator.page}` : "", locator.blockIndex !== undefined ? `block ${locator.blockIndex}` : "", locator.cell ? `cell ${locator.cell}` : "", locator.sheet ? `sheet ${locator.sheet}` : ""].filter(Boolean).join(", ") || locator.kind;
}

const MEETING_TYPE: Record<string, string> = { board: "Board", executive: "Committee", operations: "Committee", committee: "Committee", agm: "AGM", sgm: "SGM", joint: "AGM", members: "AGM" };
const OUTCOME_LABEL: Record<string, string> = { carried: "Carried", defeated: "Defeated", tabled: "Tabled", withdrawn: "Withdrawn", deferred: "Deferred", no_quorum: "NoQuorum", unknown: "NeedsReview" };
const ATTENDANCE_STATUS: Record<string, string> = { present: "present", regrets: "regrets", absent: "absent", staff: "staff", guest: "guest", proxy: "proxy", unlabelled: "present" };

/** One meetingMinutes bundle payload from a minutes extraction. */
export function minutesPayloadFromExtraction(extraction: IntakeExtractionResult, sourceExternalIds: string[], extra: { meeting?: ReconciledMeeting; versions?: Array<{ fileKey: string; name: string; recordStatus: string }>; adoption?: { date: string; evidence: string } } = {}): Record<string, unknown> | null {
  const record = extraction.record as any;
  const date = val<any>(record.date);
  if (!date || date.precision !== "day") return null;
  const body = String(val(record.body) ?? "board");
  const title = val<string>(record.title) ?? `${val<string>(record.bodyLabel) ?? "Meeting"} ${date.iso}`;
  const attendance = (record.attendance ?? []).map((entry: any) => ({
    name: val(entry.nameAsWritten),
    status: ATTENDANCE_STATUS[String(val(entry.category) ?? "present")] ?? "present",
    ...(val(entry.role) ? { roleTitle: val(entry.role) } : {}),
    ...(val(entry.affiliation) ? { affiliation: val(entry.affiliation) } : {}),
    ...(val(entry.proxyFor) ? { proxyFor: val(entry.proxyFor) } : {}),
  })).filter((entry: any) => entry.name);
  const quorum = val<string>(record.quorum?.stated);
  const motions = (record.motions ?? []).map((motion: any) => {
    const outcome = String(val(motion.outcome) ?? "unknown");
    const votes = val<any>(motion.votes);
    return {
      meetingDate: date.iso,
      meetingTitle: title,
      motionText: val(motion.text),
      outcome: OUTCOME_LABEL[outcome] ?? "NeedsReview",
      ...(personName(motion.movedBy) ? { movedByName: personName(motion.movedBy) } : {}),
      ...(personName(motion.secondedBy) ? { secondedByName: personName(motion.secondedBy) } : {}),
      ...(votes?.for !== undefined ? { votesFor: votes.for } : {}),
      ...(votes?.against !== undefined ? { votesAgainst: votes.against } : {}),
      ...(votes?.abstain !== undefined ? { abstentions: votes.abstain } : {}),
      ...(val(motion.resolutionType) && val(motion.resolutionType) !== "unknown" ? { resolutionType: val(motion.resolutionType) } : {}),
      evidenceText: motion.text?.locators?.[0]?.quote,
      pageRef: locatorRef(motion.text?.locators),
      sourceExternalIds,
    };
  });
  const actionItems = (record.actionItems ?? []).map((item: any) => {
    const due = val<any>(item.due);
    return { text: val(item.text), ...(val(item.assigneeAsWritten) ? { assignee: val(item.assigneeAsWritten) } : {}), ...(due?.iso ? { dueDate: due.iso } : {}), done: false };
  }).filter((item: any) => item.text);
  const actionObservations = (record.actionItems ?? []).map((item: any, index: number) => {
    const text = val<string>(item.text);
    if (!text) return null;
    const due = val<any>(item.due);
    return {
      entryId: `${extraction.fileKey}#action${index}`,
      actionKey: `${extraction.fileKey}#action${index}`,
      text,
      ...(val(item.assigneeAsWritten) ? { assignee: val(item.assigneeAsWritten) } : {}),
      dateAssigned: date.iso,
      ...(due?.iso && /^\d{4}-\d{2}-\d{2}$/.test(due.iso) ? { dueDate: due.iso } : {}),
      status: "unknown",
      ...(val(item.statusAsWritten) ? { sourceStatus: val(item.statusAsWritten) } : due?.text && !due.iso ? { sourceStatus: due.text } : {}),
      sourceExternalIds: [extraction.fileKey],
      ...(locatorRef(item.text?.locators) ? { sourceLocator: locatorRef(item.text?.locators) } : {}),
      ...(item.text?.locators?.[0]?.quote ? { evidence: item.text.locators[0].quote.slice(0, 400) } : {}),
    };
  }).filter(Boolean);
  const next = val<any>(record.nextMeeting);
  const versions = (extra.versions ?? []).map((version, index) => ({
    versionId: `${version.fileKey}`,
    label: version.name,
    status: version.recordStatus === "draft" ? "draft" : extra.adoption ? "adopted" : "unknown",
    sourceExternalIds: [version.fileKey],
    ...(extra.adoption && version.recordStatus !== "draft" ? { adoptedAt: extra.adoption.date, adoptionEvidence: extra.adoption.evidence } : {}),
    ...(index > 0 ? { supersedesVersionId: extra.versions![index - 1].fileKey } : {}),
  }));
  const sections = (record.sections ?? []).map((section: any) => ({ title: val(section.title), ...(personName(section.presenter) ? { presenter: personName(section.presenter) } : {}) })).filter((section: any) => section.title);
  return {
    meetingDate: date.iso,
    meetingTitle: title,
    meetingType: MEETING_TYPE[body] ?? "Board",
    ...(val(record.location) ? { location: val(record.location) } : {}),
    ...(val(record.electronic) !== undefined ? { electronic: val(record.electronic) } : {}),
    ...(personName(record.chair) ? { chairName: personName(record.chair) } : {}),
    ...(personName(record.recorder) ? { recorderName: personName(record.recorder) } : {}),
    ...(val(record.calledToOrderAt) ? { calledToOrderAt: val(record.calledToOrderAt) } : {}),
    ...(val(record.adjournedAt) ? { adjournedAt: val(record.adjournedAt) } : {}),
    detailedAttendance: attendance,
    attendees: attendance.filter((entry: any) => !["regrets", "absent"].includes(entry.status)).map((entry: any) => entry.name),
    absent: attendance.filter((entry: any) => ["regrets", "absent"].includes(entry.status)).map((entry: any) => entry.name),
    quorumStatus: quorum === "met" ? "confirmed" : quorum === "not_met" ? "not_met" : "not_recorded",
    ...(sections.length ? { sections } : {}),
    motions,
    decisions: (record.decisions ?? []).map((decision: any) => val(decision)).filter(Boolean),
    actionItems,
    ...(actionObservations.length ? { actionObservations } : {}),
    ...(versions.length ? { importedSourceVersions: versions } : {}),
    ...(next?.date ? { nextMeetingAt: next.time ? `${next.date}T${next.time}` : next.date } : {}),
    ...(next?.location ? { nextMeetingLocation: next.location } : {}),
    ...(next?.text ? { nextMeetingNotes: next.text } : {}),
    ...((record.sessionSegments ?? []).length ? { sessionSegments: record.sessionSegments.map((segment: any) => ({ type: val<any>(segment)?.type ?? "other", title: val<any>(segment)?.title })) } : {}),
    sourceExternalIds,
    sourceDocumentTitle: extraction.fileKey,
    pageRef: locatorRef(record.date?.locators),
    confidence: "Review",
    notes: [
      `Extracted by ${extraction.engine} engine (${extraction.model ?? "unknown"}); every field carries a source locator in the intake run.`,
      extraction.verification ? `Span verification: ${extraction.verification.verified + extraction.verification.fuzzy}/${extraction.verification.quoted} quotes re-found.` : "",
      ...(extraction.warnings ?? []),
    ].filter(Boolean).join("\n"),
  };
}

const GAP_REASON: Record<UnsupportedDetail["category"], string> = { no_field: "no_schema_field", no_table: "no_schema_field", no_relationship: "no_import_key", no_ui_edit: "no_ui_input", lossy_normalization: "import_dropped" };

/** representationGaps rows (schema.md §5a). */
export function representationGapRow(detail: UnsupportedDetail, fileKey: string, observedDate: string | undefined, sha256?: string, affectedTable = "meetings"): Record<string, unknown> {
  const locator = detail.locators[0];
  const [table, field] = detail.suggestedTarget.split(".");
  return {
    infoType: detail.infoType ?? detail.suggestedTarget,
    reason: GAP_REASON[detail.category] ?? "no_schema_field",
    sourceExternalId: fileKey,
    locator: {
      ...(locator?.page ? { page: String(locator.page) } : {}),
      ...(locator?.blockIndex !== undefined ? { section: `block ${locator.blockIndex}` } : {}),
      ...(locator?.sheet ? { sheet: locator.sheet } : {}),
      ...(locator?.cell ? { cellRange: locator.cell } : {}),
      ...(locator?.charStart !== undefined && locator?.charEnd !== undefined ? { lineRange: `chars ${locator.charStart}-${locator.charEnd}` } : {}),
      ...(sha256 ? { sha256 } : {}),
    },
    excerpt: (locator?.quote ?? detail.description).slice(0, 400),
    ...(observedDate ? { observedDate } : {}),
    affectedTable,
    ...(table ? { proposedTargetTable: table.replace(/=.*/, "").replace(/\s.*$/, "") } : {}),
    ...(field ? { proposedField: field } : {}),
    status: "open",
    reviewHistory: [],
    notes: detail.description,
  };
}

/** Document category and register section per intake class (also used by promotion). */
export const CATEGORY: Partial<Record<string, string>> = { meetingMinutes: "Minutes", agenda: "Minutes", meetingPackage: "Minutes", agmMaterial: "Minutes", bylaws: "Bylaws", policy: "Policy", financialStatement: "FinancialStatement", budget: "FinancialStatement", insurance: "Insurance", agreement: "Agreement", grant: "Grant", registryFiling: "Filing", invoice: "Receipt", correspondence: "Correspondence", directorConsent: "governance", proxy: "governance", roster: "governance" };
export const SECTION: Partial<Record<string, string>> = { meetingMinutes: "meetings", agenda: "meetings", meetingPackage: "meetings", agmMaterial: "meetings", bylaws: "policies", policy: "policies", financialStatement: "financials", budget: "financials", insurance: "insurance", directorConsent: "directors", proxy: "directors", roster: "directors", agreement: "archiveAccessions", grant: "grants", registryFiling: "filings", invoice: "financials", correspondence: "archiveAccessions" };

export type BundleBuild = { bundle: Record<string, unknown>; issues: string[]; stagedRecords: number; meetingsBundled: number; minutesSkipped: Array<{ fileKey: string; reason: string }>; /** Files with at least one native (non-documentMap) record. */ transposedFiles?: string[]; /** Records per bundle collection. */ collectionCounts?: Record<string, number> };

export function buildImportBundle(run: IntakeRunResult): BundleBuild {
  const byKey = new Map(run.files.map((file) => [file.fileKey, file]));
  const sources: Record<string, unknown>[] = [];
  const documentMap: Record<string, unknown>[] = [];
  for (const file of run.files) {
    if (file.disposition === "junk" || file.disposition === "excluded") continue;
    const docClass = file.classification?.docClass ?? "unclassified";
    const restricted = file.sensitivity === "restricted";
    const source = {
      externalSystem: file.driveId ? "google-drive" : "local-folder",
      externalId: file.fileKey,
      title: file.name,
      fileName: file.name,
      category: CATEGORY[docClass] ?? "Other",
      ...(file.url ? { url: file.url } : {}),
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      ...(file.sizeBytes !== undefined ? { fileSizeBytes: file.sizeBytes } : {}),
      ...(file.sha256 ? { sha256: file.sha256 } : {}),
      confidence: "Review",
      sensitivity: restricted ? "restricted" : file.sensitivity === "personal" ? "restricted" : "standard",
      tags: ["intake", docClass, ...(file.clusterKey ? ["clustered"] : [])],
      notes: [`Original path: ${file.path}`, file.dispositionReason ?? "", file.classification ? `Classified ${docClass} (${file.classification.confidence}) from ${file.classification.rationale.slice(0, 3).join("; ")}` : ""].filter(Boolean).join("\n"),
    };
    sources.push(source);
    const rawText = run.texts?.[file.fileKey];
    // Personal data (contact rosters, consents, e-mails, invoices): contact details are masked, length-preserving.
    const text = rawText && (file.sensitivity === "personal" || PROVIDER_EXCLUDED_CLASSES.has(docClass as any)) ? redact(rawText).text : rawText;
    documentMap.push({
      externalId: file.fileKey, externalSystem: source.externalSystem, sourceExternalIds: [file.fileKey], title: file.name, fileName: file.name,
      category: source.category, ...(file.sha256 ? { sha256: file.sha256 } : {}), ...(file.sizeBytes !== undefined ? { fileSizeBytes: file.sizeBytes } : {}),
      sections: [SECTION[docClass] ?? "archiveAccessions"], confidence: "Review", sensitivity: source.sensitivity,
      ...(text && !restricted ? { extractedText: text.slice(0, 180000), extractionMethod: file.extractMethod ?? "intake-extract" } : {}),
      notes: file.disposition === "catalogue" ? "Catalogued only." : restricted ? "Restricted: text withheld from the bundle; review the original." : "",
      why: `Intake class ${docClass}${file.classification?.bodyLabel ? ` · ${file.classification.bodyLabel}` : ""}`,
    });
  }
  // Minutes: one payload per reconciled meeting (canonical copy), carrying all copies' source IDs.
  const extractionByFile = new Map(run.extractions.map((extraction) => [extraction.fileKey, extraction]));
  const meetingMinutes: Record<string, unknown>[] = [];
  const minutesSkipped: BundleBuild["minutesSkipped"] = [];
  const bundledFiles = new Set<string>();
  for (const meeting of run.reconciliation.meetings) {
    const extraction = extractionByFile.get(meeting.canonicalFileId);
    if (!extraction || extraction.docClass !== "meetingMinutes") continue;
    const clusterIds = run.clusters.filter((cluster) => cluster.members.some((member) => meeting.files.some((file) => file.fileId === member.fileId))).flatMap((cluster) => cluster.members.map((member) => member.fileId));
    const parentOf = (fileId: string) => run.extractions.find((candidate) => candidate.fileKey === fileId)?.parentFileKey ?? fileId;
    const ids = [...new Set([meeting.canonicalFileId, ...meeting.files.map((file) => file.fileId), ...clusterIds].map(parentOf))];
    const adoptingMeeting = meeting.approvedBy ? run.reconciliation.meetings.find((candidate) => candidate.meetingKey === meeting.approvedBy!.meetingKey) : undefined;
    const payload = minutesPayloadFromExtraction(extraction, ids, {
      meeting,
      versions: meeting.files.length > 1 || meeting.approvedBy ? meeting.files.map((file) => ({ fileKey: file.fileId, name: byKey.get(file.fileId)?.name ?? file.fileId, recordStatus: file.recordStatus })).sort((a) => (a.recordStatus === "draft" ? -1 : 1)) : undefined,
      adoption: adoptingMeeting ? { date: adoptingMeeting.date, evidence: meeting.approvedBy!.motionIndex >= 0 ? `Adopted by motion #${meeting.approvedBy!.motionIndex + 1} at the ${adoptingMeeting.date} meeting (${meeting.approvedBy!.fileId}).` : `Recorded as approved (no formal motion) at the ${adoptingMeeting.date} meeting (${meeting.approvedBy!.fileId}).` } : undefined,
    });
    if (!payload) continue;
    meetingMinutes.push(payload);
    for (const id of [...ids, meeting.canonicalFileId, ...meeting.files.map((file) => file.fileId)]) bundledFiles.add(id);
  }
  // Every other class: agendas/packages (incl. meetings held with minutes missing), policies,
  // rule sets, directors and seats, statements, insurance, grants, filings, evidence, transactions.
  const classes = classBundleRecords(run, { minutesPayloads: meetingMinutes });
  meetingMinutes.push(...(classes.collections.meetingMinutes ?? []));
  for (const extraction of run.extractions) {
    if (extraction.docClass !== "meetingMinutes" || bundledFiles.has(extraction.fileKey) || extraction.parentFileKey) continue;
    const date = val<any>((extraction.record as any).date);
    minutesSkipped.push({ fileKey: extraction.fileKey, reason: !date ? "No meeting date found" : date.precision !== "day" ? `Meeting date known only to ${date.precision} precision` : "Not selected as the canonical copy of a meeting" });
  }
  // Representation gaps: unsupported details plus minutes that cannot be promoted.
  const representationGaps: Record<string, unknown>[] = [];
  for (const extraction of run.extractions) {
    const record = extraction.record as any;
    const observed = (val<any>(record.date) ?? val<any>(record.meetingDate) ?? val<any>(record.periodEnd) ?? val<any>(record.effectiveDate) ?? val<any>(record.filedDate))?.iso;
    const sourceKey = extraction.parentFileKey ?? extraction.fileKey;
    const sha = byKey.get(sourceKey)?.sha256;
    // Agreements are native now (A5): the legacy whole-record `agreement.contract` gap of older extractions is not a gap.
    for (const detail of extraction.unsupported) if (detail.infoType !== "agreement.contract") representationGaps.push(representationGapRow(detail, sourceKey, typeof observed === "string" && /^\d{4}(?:-\d{2}){0,2}$/.test(observed) ? observed : undefined, sha, AFFECTED_TABLE[extraction.docClass] ?? "meetings"));
  }
  representationGaps.push(...classes.gaps);
  for (const skipped of minutesSkipped.filter((item) => !/canonical/.test(item.reason))) {
    representationGaps.push({ infoType: "meeting.date_precision", reason: "identity_unresolved", sourceExternalId: skipped.fileKey, locator: {}, excerpt: skipped.reason, affectedTable: "meetings", proposedTargetTable: "meetings", proposedField: "scheduledAt", status: "open", reviewHistory: [], notes: "Minutes cannot become a meeting until an exact date is confirmed." });
  }
  const bundle: Record<string, unknown> = {
    metadata: {
      name: `Intake ${run.name}`,
      createdFrom: "intake-pipeline",
      intakeRunId: run.runId,
      sourceSystem: run.sourceKind === "drive_inventory" ? "google-drive" : "local-folder",
      reviewOnly: true,
      note: "All records stage as Pending. Every value was extracted with a source locator and re-verified; see the intake run for field-level provenance.",
      recordGaps: run.reconciliation.gaps.length,
    },
    sources,
    documentMap,
    meetingMinutes,
    ...Object.fromEntries(Object.entries(classes.collections).filter(([key, rows]) => key !== "meetingMinutes" && rows.length)),
    representationGaps,
  };
  // Class records whose source facts meet the bulk-accept rule are staged as evidence-verified (confidence High).
  markEvidenceVerified(bundle, run.extractions as any);
  const transposedFiles = new Set<string>(classes.transposed);
  for (const minutes of meetingMinutes) for (const id of (minutes as any).sourceExternalIds ?? []) transposedFiles.add(String(id));
  const collectionCounts = Object.fromEntries(Object.entries(bundle).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).length]));
  return { bundle, ...validateIntakeBundle(bundle), meetingsBundled: meetingMinutes.length, minutesSkipped, transposedFiles: [...transposedFiles], collectionCounts };
}

/** Preflight against the current import contract. `representationGaps` is being added
 * to the contract by another work package; until then its "unsupported key" issue is expected. */
export function validateIntakeBundle(bundle: Record<string, unknown>): { issues: string[]; stagedRecords: number } {
  const supportsGaps = IMPORT_BUNDLE_COLLECTION_GROUPS.some((group) => group.includes("representationGaps"));
  const keep = (issue: string) => supportsGaps || !issue.startsWith("representationGaps");
  const { representationGaps: _gaps, ...current } = bundle;
  const stagedRecords = recordsFromBundle(supportsGaps ? bundle : current).length;
  const sources = Array.isArray(bundle.sources) ? (bundle.sources as Array<Record<string, unknown>>) : [];
  const total = Object.values(bundle).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  if (total <= 1500) return { issues: importBundlePreflightIssues(bundle).filter(keep), stagedRecords };
  // The preflight probes each record with the whole source catalogue (quadratic); for large
  // runs probe in chunks with only the sources each chunk cites. Same checks, linear time.
  const byId = new Map(sources.map((source) => [String(source.externalId), source]));
  const issues: string[] = [];
  const metadata = Object.fromEntries(Object.entries(bundle).filter(([, value]) => !Array.isArray(value)));
  for (const [key, value] of Object.entries(bundle)) {
    if (!Array.isArray(value)) continue;
    for (let offset = 0; offset < value.length; offset += 250) {
      const chunk = value.slice(offset, offset + 250);
      const cited = key === "sources" ? [] : [...new Set(chunk.flatMap((row: any) => [...(row?.sourceExternalIds ?? []), row?.sourceExternalId, row?.externalId].filter(Boolean).map(String)))].map((id) => byId.get(id)).filter(Boolean);
      const probe = { ...metadata, ...(key === "sources" ? {} : { sources: cited }), [key]: chunk };
      for (const issue of importBundlePreflightIssues(probe)) {
        if (/^bundle: no supported records/.test(issue) || (key !== "sources" && issue.startsWith("sources"))) continue;
        issues.push(issue.replace(new RegExp(`^${key}\[(\d+)\]`), (_match, index) => `${key}[${Number(index) + offset}]`));
      }
    }
  }
  return { issues: issues.filter(keep), stagedRecords };
}

// ---------------------------------------------------------------- coverage
export type CoverageCell = { files: number; extracted: number; transposed: number; nativeFacts: number; gapFacts: number; unresolvedFacts: number; coverage: number };
export type CoverageReport = {
  headline: CoverageCell;
  byClass: Record<string, CoverageCell>;
  byBody: Record<string, CoverageCell>;
  byYear: Record<string, CoverageCell>;
  dispositions: Record<string, number>;
  recordGaps: RecordGap[];
  hallucinationRate: number;
  /** Share of attendance rows linked to a run-level person record (stage 7 bootstrap directory;
   * promotion links these to peopleDirectory through personOccurrences). */
  attendancePersonLinked: number;
  /** Share of chair/recorder/mover/seconder/presenter references resolved to a person (e.g. "Avery", "T. Marsh"). */
  personRefsResolved: number;
  notes: string[];
};

function knownFields(record: unknown): { total: number; mismatched: number } {
  let total = 0, mismatched = 0;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (isFieldValue(node)) {
      if ((node.status === "stated" || node.status === "inferred" || node.status === "conflicting") && node.value !== undefined && node.value !== null && node.value !== "unknown") {
        total++;
        if (node.verification === "span_mismatch" || node.verification === "invalid") mismatched++;
      }
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(record);
  return { total, mismatched };
}

const empty = (): CoverageCell => ({ files: 0, extracted: 0, transposed: 0, nativeFacts: 0, gapFacts: 0, unresolvedFacts: 0, coverage: 0 });

/** Native coverage = native facts ÷ (native + system-gap + unresolved facts), per class, body and year. */
export function coverageReport(run: IntakeRunResult, build: BundleBuild): CoverageReport {
  const headline = empty();
  const byClass: Record<string, CoverageCell> = {}, byBody: Record<string, CoverageCell> = {}, byYear: Record<string, CoverageCell> = {};
  const dispositions: Record<string, number> = {};
  const transposed = new Set<string>(build.transposedFiles ?? []);
  for (const minutes of build.bundle.meetingMinutes as any[]) for (const id of minutes.sourceExternalIds ?? []) transposed.add(id);
  const canonical = new Set(run.reconciliation.meetings.map((meeting) => meeting.canonicalFileId));
  // Non-minutes classes have no reconciled "canonical copy": a file in a native collection is canonical.
  for (const extraction of run.extractions) if (extraction.docClass !== "meetingMinutes" && transposed.has(extraction.fileKey)) canonical.add(extraction.fileKey);
  // Minutes embedded in a package count toward the package file.
  for (const meeting of run.reconciliation.meetings) {
    const parent = run.extractions.find((extraction) => extraction.fileKey === meeting.canonicalFileId)?.parentFileKey;
    if (parent) canonical.add(parent);
  }
  const extractionByFile = new Map(run.extractions.filter((extraction) => !extraction.parentFileKey).map((extraction) => [extraction.fileKey, extraction]));
  const derivedByParent = new Map<string, IntakeExtractionResult[]>();
  for (const extraction of run.extractions) if (extraction.parentFileKey) derivedByParent.set(extraction.parentFileKey, [...(derivedByParent.get(extraction.parentFileKey) ?? []), extraction]);
  const reconciledCanonical = new Set(run.reconciliation.meetings.map((meeting) => meeting.canonicalFileId));
  let quoted = 0, bad = 0;
  for (const file of run.files) {
    dispositions[file.disposition] = (dispositions[file.disposition] ?? 0) + 1;
    if (file.disposition === "junk" || file.disposition === "excluded" || file.disposition === "duplicate") continue;
    const docClass = file.classification?.docClass ?? "unclassified";
    const extraction = extractionByFile.get(file.fileKey);
    const body = String((extraction?.record as any)?.bodyLabel?.value ?? file.classification?.bodyLabel ?? "unknown");
    const year = String((extraction?.record as any)?.date?.value?.iso ?? file.classification?.date?.iso ?? "unknown").slice(0, 4);
    const cells = [headline, byClass[docClass] ??= empty(), byBody[body] ??= empty(), byYear[year] ??= empty()];
    let native = 0, gap = 0, unresolved = 0;
    if (extraction) {
      quoted += extraction.verification?.quoted ?? 0;
      bad += (extraction.verification?.mismatched ?? 0) + (extraction.verification?.invalid ?? 0);
      const { total, mismatched } = knownFields(extraction.record);
      gap = extraction.unsupported.length;
      const isBundled = transposed.has(file.fileKey) && canonical.has(file.fileKey);
      const isCopy = transposed.has(file.fileKey) && !canonical.has(file.fileKey);
      const agreementGap = extraction.unsupported.some((detail) => detail.infoType === "agreement.contract");
      if (isBundled) {
        native = Math.max(0, total - mismatched - gap);
        unresolved = mismatched;
      } else if (agreementGap) {
        // No agreements table yet: the whole record is carried as a representation gap (system gap).
        gap = Math.max(gap, total - mismatched);
        unresolved = mismatched;
      } else if (!isCopy) unresolved = total;
      // Minutes embedded in this package that became the record of a meeting.
      for (const derived of derivedByParent.get(file.fileKey) ?? []) {
        quoted += derived.verification?.quoted ?? 0;
        bad += (derived.verification?.mismatched ?? 0) + (derived.verification?.invalid ?? 0);
        const counts = knownFields(derived.record);
        if (reconciledCanonical.has(derived.fileKey)) native += Math.max(0, counts.total - counts.mismatched - derived.unsupported.length);
      }
    }
    for (const cell of cells) {
      cell.files++;
      if (extraction) cell.extracted++;
      if (transposed.has(file.fileKey)) cell.transposed++;
      cell.nativeFacts += native;
      cell.gapFacts += gap;
      cell.unresolvedFacts += unresolved;
    }
  }
  for (const cell of [headline, ...Object.values(byClass), ...Object.values(byBody), ...Object.values(byYear)]) {
    const denominator = cell.nativeFacts + cell.gapFacts + cell.unresolvedFacts;
    cell.coverage = denominator ? Number((cell.nativeFacts / denominator).toFixed(4)) : 0;
  }
  const notesOut = [
    "Facts are FieldValues with a stated/inferred value. Native = landed in a bundle collection with a verified locator; gap = an unsupported detail (representationGaps); unresolved = extracted but not promotable (no exact date, duplicate-free span mismatch).",
    "Every governance class has a deterministic extractor (WP-L); reports, plans, outreach, images and audio are catalogued in documentMap and count as files, not facts. Facts of a file whose extraction landed in no native collection count as unresolved.",
  ];
  const attendanceRows = run.extractions.filter((extraction) => extraction.docClass === "meetingMinutes").flatMap((extraction) => (extraction.record as any).attendance ?? []);
  const attendancePersonLinked = attendanceRows.length ? attendanceRows.filter((row: any) => row.personKey).length / attendanceRows.length : 0;
  const refs = run.extractions.filter((extraction) => extraction.docClass === "meetingMinutes").flatMap((extraction) => {
    const record = extraction.record as any;
    return [record.chair, record.recorder, ...(record.motions ?? []).flatMap((motion: any) => [motion.movedBy, motion.secondedBy]), ...(record.sections ?? []).map((section: any) => section.presenter)].filter((field) => field?.value);
  });
  const personRefsResolved = refs.length ? refs.filter((field: any) => field.value.personKey).length / refs.length : 0;
  return { headline, byClass, byBody, byYear, dispositions, recordGaps: run.reconciliation.gaps, hallucinationRate: quoted ? bad / quoted : 0, attendancePersonLinked: Number(attendancePersonLinked.toFixed(4)), personRefsResolved: Number(personRefsResolved.toFixed(4)), notes: notesOut };
}
