// Import-session hydration, summarization, titling, and document type-guards.

import {
  HISTORY_SOURCE_TAG,
  HISTORY_TAG,
  RECORD_TAG,
  SECTION_RECORD_KINDS,
  SESSION_TAG,
} from "./importSessionConstants";
import {
  cleanText,
  unique,
} from "./importSessionUtils";
import {
  normalizeSourcePayload,
} from "./importSessionNormalize";
import {
  normalizeReviewStatus,
} from "./importSessionRecordKinds";

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

function recordSortKey(record: any) {
  const payload = record.payload ?? {};
  return [
    record.status === "Pending" ? "0" : record.status === "Approved" ? "1" : "2",
    record.recordKind,
    payload.eventDate ?? payload.meetingDate ?? payload.startDate ?? payload.sourceDate ?? "",
    record.title,
  ].join("::");
}

function sourceNoteFor(record: any, sourceDocumentIds: any[]) {
  const sourceExternalIds = unique([...(record.sourceExternalIds ?? []), ...(record.payload?.sourceExternalIds ?? [])]);
  const parts = [
    cleanText(record.payload?.notes),
    sourceExternalIds.length ? `Sources: ${sourceExternalIds.join(", ")}` : undefined,
    sourceDocumentIds.length ? `Linked source document ids: ${sourceDocumentIds.join(", ")}` : undefined,
    cleanText(record.payload?.confidence) ? `Confidence: ${record.payload.confidence}` : undefined,
    cleanText(record.payload?.sensitivity) ? `Sensitivity: ${record.payload.sensitivity}` : undefined,
  ].filter(Boolean);
  return parts.join("\n");
}

export {
  sourceExternalIdsFor,
  titleForRecord,
  descriptionForRecord,
  titleForHistoryItem,
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
  recordSortKey,
  sourceNoteFor,
};
