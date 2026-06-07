// Import-session helpers extracted from importSessions.ts: shared constants plus
// the pure + ctx-taking helper functions (normalization, hydration, evidence,
// summaries, payload parsing). The Convex query/mutation registrations that use
// them stay in importSessions.ts so all api.importSessions.* paths are unchanged.

import { invalidOptionIssue, invalidOptionListIssues } from "./lib/orgHubOptions";
import { transactionImportMappingCandidates } from "./providers/accounting";

import {
  SESSION_TAG,
  RECORD_TAG,
  HISTORY_TAG,
  HISTORY_SOURCE_TAG,
  SECTION_RECORD_KINDS,
} from "./importSessionHelpers.part1";
import {
  normalizeSourcePayload,
} from "./importSessionHelpers.part2";
import {
  normalizeReviewStatus,
  sourceNoteFor,
  cleanDate,
  cleanDateTime,
  cleanText,
  arrayOf,
  compactRecord,
  unique,
  numberOrUndefined,
  optionalBoolean,
  sourceSystemFromExternalId,
  sourceSystemLabel,
} from "./importSessionHelpers.part4";

function mergeInsurancePolicies(existing: any, incoming: any) {
  const merged: any = { ...existing };
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      merged[key] = mergeRecordArrays(merged[key], value);
      continue;
    }
    const current = merged[key];
    if (current == null || current === "" || current === "Needs review") {
      merged[key] = value;
    }
  }
  merged.sourceExternalIds = unique([...(existing.sourceExternalIds ?? []), ...(incoming.sourceExternalIds ?? [])]);
  merged.riskFlags = unique([...(existing.riskFlags ?? []), ...(incoming.riskFlags ?? [])]);
  merged.notes = [existing.notes, incoming.notes].map(cleanText).filter(Boolean).filter((note, index, arr) => arr.indexOf(note) === index).join("\n") || undefined;
  return merged;
}

function mergeRecordArrays(a: unknown, b: unknown) {
  const rows = [...arrayOf(a), ...arrayOf(b)];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function normalizeCoveredParties(value: unknown) {
  return arrayOf(value)
    .map((party: any) => compactRecord({
      name: cleanText(party?.name),
      partyType: cleanText(party?.partyType),
      coveredClass: cleanText(party?.coveredClass),
      sourceExternalIds: unique(arrayOf(party?.sourceExternalIds)),
      citationId: cleanText(party?.citationId),
      notes: cleanText(party?.notes),
    }))
    .filter((party): party is any => Boolean(party?.name));
}

function normalizeCoverageItems(value: unknown) {
  return arrayOf(value)
    .map((item: any) => compactRecord({
      label: cleanText(item?.label),
      coverageType: cleanText(item?.coverageType),
      coveredClass: cleanText(item?.coveredClass),
      limitCents: numberOrUndefined(item?.limitCents),
      deductibleCents: numberOrUndefined(item?.deductibleCents),
      summary: cleanText(item?.summary),
      sourceExternalIds: unique(arrayOf(item?.sourceExternalIds)),
      citationId: cleanText(item?.citationId),
    }))
    .filter((item): item is any => Boolean(item?.label));
}

function normalizeCoveredLocations(value: unknown) {
  return arrayOf(value)
    .map((location: any) => compactRecord({
      label: cleanText(location?.label),
      address: cleanText(location?.address),
      room: cleanText(location?.room),
      coverageCents: numberOrUndefined(location?.coverageCents),
      sourceExternalIds: unique(arrayOf(location?.sourceExternalIds)),
      citationId: cleanText(location?.citationId),
      notes: cleanText(location?.notes),
    }))
    .filter((location): location is any => Boolean(location?.label));
}

function normalizePolicyDefinitions(value: unknown) {
  return arrayOf(value)
    .map((definition: any) => compactRecord({
      term: cleanText(definition?.term),
      definition: cleanText(definition?.definition),
      sourceExternalIds: unique(arrayOf(definition?.sourceExternalIds)),
      citationId: cleanText(definition?.citationId),
    }))
    .filter((definition): definition is any => Boolean(definition?.term && definition?.definition));
}

function normalizeDeclinedCoverages(value: unknown) {
  return arrayOf(value)
    .map((declined: any) => compactRecord({
      label: cleanText(declined?.label),
      reason: cleanText(declined?.reason),
      offeredLimitCents: numberOrUndefined(declined?.offeredLimitCents),
      premiumCents: numberOrUndefined(declined?.premiumCents),
      declinedAt: cleanDate(declined?.declinedAt),
      sourceExternalIds: unique(arrayOf(declined?.sourceExternalIds)),
      citationId: cleanText(declined?.citationId),
      notes: cleanText(declined?.notes),
    }))
    .filter((declined): declined is any => Boolean(declined?.label));
}

function normalizeCertificatesOfInsurance(value: unknown) {
  return arrayOf(value)
    .map((certificate: any) => compactRecord({
      holderName: cleanText(certificate?.holderName),
      additionalInsuredLegalName: cleanText(certificate?.additionalInsuredLegalName),
      eventName: cleanText(certificate?.eventName),
      eventDate: cleanDate(certificate?.eventDate),
      requiredLimitCents: numberOrUndefined(certificate?.requiredLimitCents),
      issuedAt: cleanDate(certificate?.issuedAt),
      expiresAt: cleanDate(certificate?.expiresAt),
      status: cleanText(certificate?.status),
      sourceExternalIds: unique(arrayOf(certificate?.sourceExternalIds)),
      citationId: cleanText(certificate?.citationId),
      notes: cleanText(certificate?.notes),
    }))
    .filter((certificate): certificate is any => Boolean(certificate?.holderName));
}

function normalizeInsuranceRequirements(value: unknown) {
  return arrayOf(value)
    .map((requirement: any) => compactRecord({
      context: cleanText(requirement?.context),
      requirementType: cleanText(requirement?.requirementType),
      coverageSource: cleanText(requirement?.coverageSource),
      cglLimitRequiredCents: numberOrUndefined(requirement?.cglLimitRequiredCents),
      cglLimitConfirmedCents: numberOrUndefined(requirement?.cglLimitConfirmedCents),
      additionalInsuredRequired: optionalBoolean(requirement?.additionalInsuredRequired),
      additionalInsuredLegalName: cleanText(requirement?.additionalInsuredLegalName),
      coiStatus: cleanText(requirement?.coiStatus),
      coiDueDate: cleanDate(requirement?.coiDueDate),
      tenantLegalLiabilityLimitCents: numberOrUndefined(requirement?.tenantLegalLiabilityLimitCents),
      hostLiquorLiability: cleanText(requirement?.hostLiquorLiability),
      indemnityRequired: optionalBoolean(requirement?.indemnityRequired),
      waiverRequired: optionalBoolean(requirement?.waiverRequired),
      vendorCoiRequired: optionalBoolean(requirement?.vendorCoiRequired),
      studentEventChecklistRequired: optionalBoolean(requirement?.studentEventChecklistRequired),
      riskTriggers: unique(arrayOf(requirement?.riskTriggers)),
      sourceExternalIds: unique(arrayOf(requirement?.sourceExternalIds)),
      citationId: cleanText(requirement?.citationId),
      notes: cleanText(requirement?.notes),
    }))
    .filter((requirement): requirement is any => Boolean(requirement?.context));
}

function normalizeClaimsMadeTerms(value: unknown) {
  const terms = value && typeof value === "object" ? value as any : undefined;
  if (!terms) return undefined;
  return compactRecord({
    retroactiveDate: cleanDate(terms.retroactiveDate),
    continuityDate: cleanDate(terms.continuityDate),
    reportingDeadline: cleanDate(terms.reportingDeadline),
    extendedReportingPeriod: cleanText(terms.extendedReportingPeriod),
    defenseCostsInsideLimit: optionalBoolean(terms.defenseCostsInsideLimit),
    territory: cleanText(terms.territory),
    retentionCents: numberOrUndefined(terms.retentionCents),
    claimsNoticeContact: cleanText(terms.claimsNoticeContact),
    sourceExternalIds: unique(arrayOf(terms.sourceExternalIds)),
    citationId: cleanText(terms.citationId),
    notes: cleanText(terms.notes),
  });
}

function normalizeClaimIncidents(value: unknown) {
  return arrayOf(value)
    .map((incident: any) => compactRecord({
      incidentDate: cleanDate(incident?.incidentDate),
      claimNoticeDate: cleanDate(incident?.claimNoticeDate),
      status: cleanText(incident?.status),
      privacyFlag: optionalBoolean(incident?.privacyFlag),
      insurerNotifiedAt: cleanDateTime(incident?.insurerNotifiedAt),
      brokerNotifiedAt: cleanDateTime(incident?.brokerNotifiedAt),
      sourceExternalIds: unique(arrayOf(incident?.sourceExternalIds)),
      citationId: cleanText(incident?.citationId),
      notes: cleanText(incident?.notes),
    }))
    .filter((incident): incident is any => Boolean(incident?.incidentDate || incident?.claimNoticeDate || incident?.notes));
}

function normalizeAnnualReviews(value: unknown) {
  return arrayOf(value)
    .map((review: any) => compactRecord({
      reviewDate: cleanDate(review?.reviewDate),
      boardMeetingDate: cleanDate(review?.boardMeetingDate),
      reviewer: cleanText(review?.reviewer),
      outcome: cleanText(review?.outcome),
      nextReviewDate: cleanDate(review?.nextReviewDate),
      sourceExternalIds: unique(arrayOf(review?.sourceExternalIds)),
      citationId: cleanText(review?.citationId),
      notes: cleanText(review?.notes),
    }))
    .filter((review): review is any => Boolean(review?.reviewDate));
}

function normalizeComplianceChecks(value: unknown) {
  return arrayOf(value)
    .map((check: any) => compactRecord({
      label: cleanText(check?.label),
      status: cleanText(check?.status),
      dueDate: cleanDate(check?.dueDate),
      completedAt: cleanDate(check?.completedAt),
      sourceExternalIds: unique(arrayOf(check?.sourceExternalIds)),
      citationId: cleanText(check?.citationId),
      notes: cleanText(check?.notes),
    }))
    .filter((check): check is any => Boolean(check?.label));
}

function sourceExternalIdsFor(recordKind: string, payload: any) {
  if (recordKind === "source" && payload.externalId) return [payload.externalId];
  if (Array.isArray(payload.sourceExternalIds)) return payload.sourceExternalIds.map(String);
  if (payload.externalId) return [String(payload.externalId)];
  if (typeof payload.id === "number") return [`paperless:${payload.id}`];
  return [];
}

function titleForRecord(recordKind: string, payload: any) {
  if (recordKind === "source") return cleanText(payload?.title) || cleanText(payload?.externalId) || "Source";
  if (recordKind === "fact") return cleanText(payload?.label) || "Profile fact";
  if (recordKind === "event") return cleanText(payload?.title) || "Timeline event";
  if (recordKind === "boardTerm") return cleanText(payload?.personName) || "Board or role service";
  if (recordKind === "motion") return cleanText(payload?.motionText) || cleanText(payload?.meetingTitle) || "Meeting motion";
  if (recordKind === "meetingMinutes") return cleanText(payload?.meetingTitle) || cleanText(payload?.sourceDocumentTitle) || "Meeting minutes";
  if (recordKind === "budget") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Budget snapshot";
  if (recordKind === "filing") return cleanText(payload?.title) || cleanText(payload?.kind) || "Filing";
  if (recordKind === "deadline") return cleanText(payload?.title) || "Deadline";
  if (recordKind === "bylawAmendment") return cleanText(payload?.title) || cleanText(payload?.filedAtISO) || "Bylaw amendment";
  if (recordKind === "publication") return cleanText(payload?.title) || "Publication";
  if (recordKind === "insurancePolicy") return cleanText(payload?.title) || cleanText(payload?.policyNumber) || "Insurance policy";
  if (recordKind === "financialStatement") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Financial statement";
  if (recordKind === "grant") return cleanText(payload?.title) || cleanText(payload?.program) || "Grant";
  if (recordKind === "recordsLocation") return cleanText(payload?.title) || cleanText(payload?.address) || "Records location";
  if (recordKind === "archiveAccession") return cleanText(payload?.title) || cleanText(payload?.accessionNumber) || "Archive accession";
  if (recordKind === "boardRoleAssignment") return cleanText(payload?.personName) || cleanText(payload?.name) || "Board role assignment";
  if (recordKind === "boardRoleChange") return cleanText(payload?.roleTitle) || cleanText(payload?.changeType) || "Board role change";
  if (recordKind === "signingAuthority") return cleanText(payload?.personName) || cleanText(payload?.institutionName) || "Signing authority";
  if (recordKind === "meetingAttendance") return cleanText(payload?.personName) || cleanText(payload?.meetingTitle) || "Meeting attendance";
  if (recordKind === "motionEvidence") return cleanText(payload?.motionText) || cleanText(payload?.meetingTitle) || "Motion evidence";
  if (recordKind === "budgetSnapshot") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Budget snapshot";
  if (recordKind === "financialStatementImport") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Financial statement import";
  if (recordKind === "treasurerReport") return cleanText(payload?.title) || cleanText(payload?.reportDate) || "Treasurer report";
  if (recordKind === "transactionCandidate") return cleanText(payload?.description) || cleanText(payload?.title) || "Transaction candidate";
  if (recordKind === "organizationAddress") return cleanText(payload?.title) || cleanText(payload?.type) || cleanText(payload?.address) || "Organization address";
  if (recordKind === "organizationRegistration") return cleanText(payload?.jurisdiction) || cleanText(payload?.registrationNumber) || "Organization registration";
  if (recordKind === "organizationIdentifier") return cleanText(payload?.kind) || cleanText(payload?.type) || "Organization identifier";
  if (recordKind === "policy") return cleanText(payload?.policyName) || cleanText(payload?.name) || "Policy";
  if (recordKind === "workflowPackage") return cleanText(payload?.packageName) || cleanText(payload?.eventType) || "Workflow package";
  if (recordKind === "minuteBookItem") return cleanText(payload?.title) || cleanText(payload?.recordType) || "Minute book record";
  if (recordKind === "roleHolder") return cleanText(payload?.fullName) || cleanText(payload?.name) || [payload?.firstName, payload?.lastName].map(cleanText).filter(Boolean).join(" ") || "Role holder";
  if (recordKind === "rightsClass") return cleanText(payload?.className) || cleanText(payload?.rightsClassName) || cleanText(payload?.name) || "Rights class";
  if (recordKind === "rightsholdingTransfer") return cleanText(payload?.title) || cleanText(payload?.transferType) || "Rightsholding transfer";
  if (recordKind === "legalTemplateDataField") return cleanText(payload?.name) || cleanText(payload?.fieldName) || "Template data field";
  if (recordKind === "legalTemplate") return cleanText(payload?.name) || cleanText(payload?.templateName) || "Legal template";
  if (recordKind === "legalPrecedent") return cleanText(payload?.packageName) || cleanText(payload?.name) || "Legal precedent";
  if (recordKind === "legalPrecedentRun") return cleanText(payload?.name) || cleanText(payload?.partName) || "Legal package run";
  if (recordKind === "generatedLegalDocument") return cleanText(payload?.title) || cleanText(payload?.documentName) || "Generated legal document";
  if (recordKind === "legalSigner") return cleanText(payload?.fullName) || cleanText(payload?.name) || cleanText(payload?.email) || "Legal signer";
  if (recordKind === "formationRecord") return cleanText(payload?.nuansNumber) || cleanText(payload?.jurisdiction) || "Formation record";
  if (recordKind === "nameSearchItem") return cleanText(payload?.name) || cleanText(payload?.nuansReportNumber) || "Name search";
  if (recordKind === "entityAmendment") return cleanText(payload?.entityNameNew) || cleanText(payload?.newEntityName) || "Entity amendment";
  if (recordKind === "annualMaintenanceRecord") return cleanText(payload?.yearFilingFor) || cleanText(payload?.filingYear) || "Annual maintenance";
  if (recordKind === "jurisdictionMetadata") return cleanText(payload?.label) || cleanText(payload?.jurisdiction) || cleanText(payload?.value) || "Jurisdiction metadata";
  if (recordKind === "supportLog") return cleanText(payload?.detailsHeading) || cleanText(payload?.logType) || cleanText(payload?.type) || "Support log";
  if (recordKind === "sourceEvidence") return cleanText(payload?.sourceTitle) || cleanText(payload?.title) || "Source evidence";
  if (recordKind === "secretVaultItem") return cleanText(payload?.name) || cleanText(payload?.title) || cleanText(payload?.service) || "Access custody reference";
  if (recordKind === "pipaTraining") return cleanText(payload?.participantName) || cleanText(payload?.title) || "PIPA training";
  if (recordKind === "employee") return cleanText(payload?.name) || [payload?.firstName, payload?.lastName].map(cleanText).filter(Boolean).join(" ") || "Employee";
  if (recordKind === "volunteer") return cleanText(payload?.name) || [payload?.firstName, payload?.lastName].map(cleanText).filter(Boolean).join(" ") || "Volunteer";
  return cleanText(payload?.title) || cleanText(payload?.id) || "Document candidate";
}

function descriptionForRecord(recordKind: string, payload: any) {
  if (recordKind === "fact") return cleanText(payload?.value);
  if (recordKind === "event") return cleanText(payload?.summary);
  if (recordKind === "boardTerm") return [payload?.position, payload?.committeeName, payload?.startDate].map(cleanText).filter(Boolean).join(" · ");
  if (recordKind === "motion") return cleanText(payload?.motionText);
  if (recordKind === "meetingMinutes") return [payload?.meetingDate, `${payload?.motions?.length ?? 0} motions`, payload?.notes].map(cleanText).filter(Boolean).join(" · ");
  if (recordKind === "budget") return [payload?.fiscalYear, payload?.currency, payload?.notes].map(cleanText).filter(Boolean).join(" · ");
  if (recordKind === "source") return [payload?.category, payload?.sourceDate, payload?.notes].map(cleanText).filter(Boolean).join(" · ");
  if (SECTION_RECORD_KINDS.includes(recordKind as any)) {
    return [
      payload?.sourceDate,
      payload?.dueDate,
      payload?.filedAt,
      payload?.filedAtISO,
      payload?.status,
      payload?.category,
      payload?.notes,
    ].map(cleanText).filter(Boolean).join(" · ");
  }
  return [payload?.created, payload?.tags?.join?.(", "), payload?.snippet].map(cleanText).filter(Boolean).join(" · ");
}

function titleForHistoryItem(kind: string, payload: any) {
  if (kind === "fact") return cleanText(payload?.label) || "Profile fact";
  if (kind === "event") return cleanText(payload?.title) || "History event";
  if (kind === "boardTerm") return cleanText(payload?.personName) || "Board term";
  if (kind === "motion") return cleanText(payload?.motionText) || cleanText(payload?.meetingTitle) || "Motion";
  if (kind === "budget") return cleanText(payload?.title) || cleanText(payload?.fiscalYear) || "Budget";
  return "History item";
}

async function insertSourceEvidenceForAppliedRecord(
  ctx: any,
  societyId: string,
  record: any,
  targetId: any,
  sourceDocumentIds: any[],
) {
  const payload = record.payload ?? {};
  const sourceExternalIds = unique([...(record.sourceExternalIds ?? []), ...(payload.sourceExternalIds ?? [])]);
  const restricted = payload.sensitivity === "restricted" || (record.riskFlags ?? []).includes("restricted");
  const firstSourceDocumentId = sourceDocumentIds[0];
  const externalSystem = cleanText(payload.externalSystem) || sourceSystemFromExternalId(sourceExternalIds[0]);
  await ctx.db.insert("sourceEvidence", {
    societyId,
    sourceDocumentId: firstSourceDocumentId,
    externalSystem,
    externalId: sourceExternalIds[0],
    sourceTitle: cleanText(payload.sourceTitle) || cleanText(payload.title) || record.title || `${sourceSystemLabel(externalSystem)} source`,
    sourceDate: cleanDate(payload.sourceDate),
    evidenceKind: restricted ? "restricted" : "import_support",
    targetTable: targetTableForRecordKind(record.recordKind),
    targetId: String(targetId),
    sensitivity: restricted ? "restricted" : "standard",
    accessLevel: restricted ? "restricted" : "internal",
    summary: sourceNoteFor(record, sourceDocumentIds) || "Source evidence created from an approved import-session record.",
    excerpt: restricted ? undefined : cleanText(payload.excerpt),
    status: "Linked",
    notes: "Created automatically when the approved import record was applied.",
    createdAtISO: new Date().toISOString(),
  });
}

function targetTableForRecordKind(kind: string) {
  return ({
    filing: "filings",
    deadline: "deadlines",
    bylawAmendment: "bylawAmendments",
    publication: "publications",
    insurancePolicy: "insurancePolicies",
    financialStatement: "financials",
    financialStatementImport: "financialStatementImports",
    grant: "grants",
    recordsLocation: "recordsLocation",
    archiveAccession: "archiveAccessions",
    boardRoleAssignment: "boardRoleAssignments",
    boardRoleChange: "boardRoleChanges",
    signingAuthority: "signingAuthorities",
    meetingAttendance: "meetingAttendanceRecords",
    motionEvidence: "motionEvidence",
    budgetSnapshot: "budgetSnapshots",
    treasurerReport: "treasurerReports",
    transactionCandidate: "transactionCandidates",
    organizationAddress: "organizationAddresses",
    organizationRegistration: "organizationRegistrations",
    organizationIdentifier: "organizationIdentifiers",
    policy: "policies",
    workflowPackage: "workflowPackages",
    minuteBookItem: "minuteBookItems",
    roleHolder: "roleHolders",
    rightsClass: "rightsClasses",
    rightsholdingTransfer: "rightsholdingTransfers",
    legalTemplateDataField: "legalTemplateDataFields",
    legalTemplate: "legalTemplates",
    legalPrecedent: "legalPrecedents",
    legalPrecedentRun: "legalPrecedentRuns",
    generatedLegalDocument: "generatedLegalDocuments",
    legalSigner: "legalSigners",
    formationRecord: "formationRecords",
    nameSearchItem: "nameSearchItems",
    entityAmendment: "entityAmendments",
    annualMaintenanceRecord: "annualMaintenanceRecords",
    jurisdictionMetadata: "jurisdictionMetadata",
    supportLog: "supportLogs",
    secretVaultItem: "secretVaultItems",
    pipaTraining: "pipaTrainings",
    employee: "employees",
    volunteer: "volunteers",
  } as Record<string, string>)[kind] ?? kind;
}

function summarizeRecords(records: any[]) {
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byTarget: Record<string, number> = {};
  let riskCount = 0;
  let orgHistoryApplied = 0;
  let meetingsApplied = 0;
  let documentsApplied = 0;
  let sectionsApplied = 0;
  for (const record of records) {
    byKind[record.recordKind] = (byKind[record.recordKind] ?? 0) + 1;
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    byTarget[record.targetModule] = (byTarget[record.targetModule] ?? 0) + 1;
    if ((record.riskFlags ?? []).length > 0) riskCount += 1;
    if (record.importedTargets?.orgHistory) orgHistoryApplied += 1;
    if (record.importedTargets?.meetings) meetingsApplied += 1;
    if (record.importedTargets?.documents) documentsApplied += 1;
    if (record.importedTargets?.sections) sectionsApplied += 1;
  }
  return {
    total: records.length,
    byKind,
    byStatus,
    byTarget,
    riskCount,
    orgHistoryApplied,
    meetingsApplied,
    documentsApplied,
    sectionsApplied,
  };
}

function summaryForSession(session: any) {
  const summary = session?.summary;
  if (summary && typeof summary === "object" && Number.isFinite(Number(summary.total))) {
    return {
      total: Number(summary.total) || 0,
      byKind: isPlainObject(summary.byKind) ? summary.byKind : {},
      byStatus: isPlainObject(summary.byStatus) ? summary.byStatus : {},
      byTarget: isPlainObject(summary.byTarget) ? summary.byTarget : {},
      riskCount: Number(summary.riskCount) || 0,
      orgHistoryApplied: Number(summary.orgHistoryApplied) || 0,
      meetingsApplied: Number(summary.meetingsApplied) || 0,
      documentsApplied: Number(summary.documentsApplied) || 0,
      sectionsApplied: Number(summary.sectionsApplied) || 0,
    };
  }
  return summarizeFromSessionMetadata(session);
}

function isPlainObject(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function summarizeFromSessionMetadata(session: any) {
  const metadata = session?.bundleMetadata ?? {};
  const counts = { ...(metadata.recordCounts ?? {}) };
  if (metadata.generatedMeetingRecords || metadata.candidateDocuments) {
    if (metadata.generatedMeetingRecords) counts.meetingMinutes = metadata.generatedMeetingRecords;
    if (metadata.candidateDocuments) {
      counts.source = Math.max(Number(counts.source ?? 0), Number(metadata.candidateDocuments) || 0);
      counts.documentCandidates = Math.max(Number(counts.documentCandidates ?? 0), Number(metadata.candidateDocuments) || 0);
    }
  }
  if (session?.qualitySummary?.sourceDocumentRows && Object.keys(counts).length === 0) {
    counts.documentCandidates = Number(session.qualitySummary.sourceDocumentRows) || 0;
  }
  const byKind: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    if (key === "sources") byKind.source = Number(value) || 0;
    else if (key === "source") byKind.source = Number(value) || 0;
    else if (key === "meetingMinutes") byKind.meetingMinutes = Number(value) || 0;
    else {
      const singular = String(key).replace(/ies$/, "y").replace(/s$/, "");
      byKind[singular] = Number(value) || 0;
    }
  }
  const total = Object.values(byKind).reduce((sum, value) => sum + value, 0);
  return {
    total,
    byKind,
    byStatus: total ? { Pending: total } : {},
    byTarget: {},
    riskCount: 0,
    orgHistoryApplied: 0,
    meetingsApplied: 0,
    documentsApplied: 0,
    sectionsApplied: 0,
  };
}

function hydrateSession(doc: any): any {
  const payload = parseJson(doc?.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    name: payload.name ?? doc.title,
    createdAtISO: payload.createdAtISO ?? doc.createdAtISO,
  };
}

function hydrateRecord(doc: any): any {
  const payload = parseJson(doc?.content);
  return {
    ...payload,
    _id: doc._id,
    _creationTime: doc._creationTime,
    title: payload.title ?? doc.title,
    status: normalizeReviewStatus(payload.status),
    sourceExternalIds: Array.isArray(payload.sourceExternalIds) ? payload.sourceExternalIds : [],
    riskFlags: Array.isArray(payload.riskFlags) ? payload.riskFlags : [],
    importedTargets: payload.importedTargets ?? {},
  };
}

function hydrateHistorySource(doc: any) {
  const payload = parseJson(doc?.content);
  return { ...payload, _id: doc._id };
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown) {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function externalIdFromTags(tags: unknown) {
  if (!Array.isArray(tags)) return undefined;
  const tag = tags.map(String).find((value) => /^(paperless:\d+|local:sha256:[a-f0-9]{16,}|file:|onedrive:)/i.test(value));
  return tag || undefined;
}

function sourceCatalogForRecords(records: any[]) {
  const catalog = new Map<string, any>();
  for (const record of records) {
    if (record.recordKind === "source") {
      const source = normalizeSourcePayload(record.payload);
      if (source.externalId && !catalog.has(source.externalId)) {
        catalog.set(source.externalId, source);
      }
      continue;
    }

    if (record.recordKind === "documentCandidate" && record.importedTargets?.documents) {
      const payload = record.payload ?? {};
      const externalIds = unique([
        ...(record.sourceExternalIds ?? []),
        ...(payload.sourceExternalIds ?? []),
        payload.externalId,
        payload.id != null ? `paperless:${payload.id}` : undefined,
      ]);
      for (const externalId of externalIds) {
        const existing = catalog.get(externalId) ?? {};
        catalog.set(externalId, { ...existing, documentId: record.importedTargets.documents });
      }
    }
  }
  return catalog;
}

function isImportSession(doc: any): doc is Record<string, any> {
  return Boolean(doc?.tags?.includes(SESSION_TAG) && !doc?.tags?.includes(RECORD_TAG));
}

function isImportRecord(doc: any): doc is Record<string, any> {
  return Boolean(doc?.tags?.includes(SESSION_TAG) && doc?.tags?.includes(RECORD_TAG));
}

function isHistorySource(doc: any) {
  return Boolean(doc?.tags?.includes(HISTORY_TAG) && doc?.tags?.includes(HISTORY_SOURCE_TAG));
}


export {
  mergeInsurancePolicies,
  mergeRecordArrays,
  normalizeCoveredParties,
  normalizeCoverageItems,
  normalizeCoveredLocations,
  normalizePolicyDefinitions,
  normalizeDeclinedCoverages,
  normalizeCertificatesOfInsurance,
  normalizeInsuranceRequirements,
  normalizeClaimsMadeTerms,
  normalizeClaimIncidents,
  normalizeAnnualReviews,
  normalizeComplianceChecks,
  sourceExternalIdsFor,
  titleForRecord,
  descriptionForRecord,
  titleForHistoryItem,
  insertSourceEvidenceForAppliedRecord,
  targetTableForRecordKind,
  summarizeRecords,
  summaryForSession,
  isPlainObject,
  summarizeFromSessionMetadata,
  hydrateSession,
  hydrateRecord,
  hydrateHistorySource,
  parseJson,
  parseJsonArray,
  externalIdFromTags,
  sourceCatalogForRecords,
  isImportSession,
  isImportRecord,
  isHistorySource,
};
