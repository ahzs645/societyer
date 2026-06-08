// Import-session record-kind semantics: risk flags, inference, and record construction.

import {
  HISTORY_SOURCE_TAG,
  HISTORY_TAG,
  REVIEW_STATUSES,
} from "./importSessionConstants";
import {
  arrayOf,
  cleanDateTime,
  cleanText,
  tagValue,
} from "./importSessionUtils";
import {
  dedupeInsurancePolicies,
  normalizePayload,
} from "./importSessionNormalize";
import {
  descriptionForRecord,
  sourceExternalIdsFor,
  titleForRecord,
} from "./importSessionMetadata";

function recordsFromBundle(bundle: any) {
  const records: any[] = [];
  for (const source of arrayOf(bundle?.sources)) records.push(makeRecord("source", "Org history sources", source));
  for (const fact of arrayOf(bundle?.facts)) records.push(makeRecord("fact", "Org history", fact));
  for (const event of arrayOf(bundle?.events)) records.push(makeRecord("event", "Org history", event));
  for (const term of arrayOf(bundle?.boardTerms)) records.push(makeRecord("boardTerm", "Directors and roles", term));
  for (const motion of arrayOf(bundle?.motions)) records.push(makeRecord("motion", "Meetings and minutes", motion));
  for (const minutes of arrayOf(bundle?.meetingMinutes)) records.push(makeRecord("meetingMinutes", "Meetings and minutes", minutes));
  for (const budget of arrayOf(bundle?.budgets)) records.push(makeRecord("budget", "Budgets", budget));
  for (const filing of arrayOf(bundle?.filings)) records.push(makeRecord("filing", "filings", filing));
  for (const deadline of arrayOf(bundle?.deadlines)) records.push(makeRecord("deadline", "deadlines", deadline));
  for (const amendment of arrayOf(bundle?.bylawAmendments)) records.push(makeRecord("bylawAmendment", "bylawAmendments", amendment));
  for (const publication of arrayOf(bundle?.publications)) records.push(makeRecord("publication", "publications", publication));
  for (const policy of dedupeInsurancePolicies(arrayOf(bundle?.insurancePolicies))) records.push(makeRecord("insurancePolicy", "insurance", policy));
  for (const financial of arrayOf(bundle?.financialStatements)) records.push(makeRecord("financialStatement", "financials", financial));
  for (const financial of arrayOf(bundle?.financialStatementImports)) records.push(makeRecord("financialStatementImport", "financialStatementImports", financial));
  for (const grant of arrayOf(bundle?.grants)) records.push(makeRecord("grant", "grants", grant));
  for (const location of arrayOf(bundle?.recordsLocations)) records.push(makeRecord("recordsLocation", "recordsLocation", location));
  for (const accession of arrayOf(bundle?.archiveAccessions)) records.push(makeRecord("archiveAccession", "archiveAccessions", accession));
  for (const assignment of arrayOf(bundle?.boardRoleAssignments)) records.push(makeRecord("boardRoleAssignment", "boardRoleAssignments", assignment));
  for (const change of arrayOf(bundle?.boardRoleChanges)) records.push(makeRecord("boardRoleChange", "boardRoleChanges", change));
  for (const authority of arrayOf(bundle?.signingAuthorities)) records.push(makeRecord("signingAuthority", "signingAuthorities", authority));
  for (const attendance of arrayOf(bundle?.meetingAttendance)) records.push(makeRecord("meetingAttendance", "meetingAttendanceRecords", attendance));
  for (const evidence of arrayOf(bundle?.motionEvidence)) records.push(makeRecord("motionEvidence", "motionEvidence", evidence));
  for (const snapshot of arrayOf(bundle?.budgetSnapshots)) records.push(makeRecord("budgetSnapshot", "budgetSnapshots", snapshot));
  for (const report of arrayOf(bundle?.treasurerReports)) records.push(makeRecord("treasurerReport", "treasurerReports", report));
  for (const transaction of arrayOf(bundle?.transactionCandidates)) records.push(makeRecord("transactionCandidate", "transactionCandidates", transaction));
  for (const address of arrayOf(bundle?.organizationAddresses)) records.push(makeRecord("organizationAddress", "organizationAddresses", address));
  for (const registration of arrayOf(bundle?.organizationRegistrations)) records.push(makeRecord("organizationRegistration", "organizationRegistrations", registration));
  for (const identifier of arrayOf(bundle?.organizationIdentifiers)) records.push(makeRecord("organizationIdentifier", "organizationIdentifiers", identifier));
  for (const identifier of arrayOf(bundle?.taxRegistrations)) records.push(makeRecord("organizationIdentifier", "organizationIdentifiers", identifier));
  for (const policy of arrayOf(bundle?.policies)) records.push(makeRecord("policy", "policies", policy));
  for (const workflowPackage of arrayOf(bundle?.workflowPackages)) records.push(makeRecord("workflowPackage", "workflowPackages", workflowPackage));
  for (const item of arrayOf(bundle?.minuteBookItems)) records.push(makeRecord("minuteBookItem", "minuteBookItems", item));
  for (const holder of arrayOf(bundle?.roleHolders ?? bundle?.representatives)) records.push(makeRecord("roleHolder", "roleHolders", holder));
  for (const rightsClass of arrayOf(bundle?.rightsClasses ?? bundle?.shareClasses)) records.push(makeRecord("rightsClass", "rightsClasses", rightsClass));
  for (const transfer of arrayOf(bundle?.rightsholdingTransfers ?? bundle?.shareTransfers)) records.push(makeRecord("rightsholdingTransfer", "rightsholdingTransfers", transfer));
  for (const field of arrayOf(bundle?.legalTemplateDataFields ?? bundle?.dataFields)) records.push(makeRecord("legalTemplateDataField", "legalTemplateDataFields", field));
  for (const template of arrayOf(bundle?.legalTemplates ?? bundle?.templates)) records.push(makeRecord("legalTemplate", "legalTemplates", template));
  for (const precedent of arrayOf(bundle?.legalPrecedents ?? bundle?.parts ?? bundle?.partPrecedents)) records.push(makeRecord("legalPrecedent", "legalPrecedents", precedent));
  for (const run of arrayOf(bundle?.legalPrecedentRuns ?? bundle?.partRuns)) records.push(makeRecord("legalPrecedentRun", "legalPrecedentRuns", run));
  for (const doc of arrayOf(bundle?.generatedLegalDocuments ?? bundle?.draftDocuments)) records.push(makeRecord("generatedLegalDocument", "generatedLegalDocuments", doc));
  for (const signer of arrayOf(bundle?.legalSigners ?? bundle?.signers)) records.push(makeRecord("legalSigner", "legalSigners", signer));
  for (const formation of arrayOf(bundle?.formationRecords ?? bundle?.incorporations)) records.push(makeRecord("formationRecord", "formationRecords", formation));
  for (const search of arrayOf(bundle?.nameSearchItems ?? bundle?.nameSearches)) records.push(makeRecord("nameSearchItem", "nameSearchItems", search));
  for (const amendment of arrayOf(bundle?.entityAmendments ?? bundle?.amendments)) records.push(makeRecord("entityAmendment", "entityAmendments", amendment));
  for (const annual of arrayOf(bundle?.annualMaintenanceRecords ?? bundle?.annualGeneralMeetings)) records.push(makeRecord("annualMaintenanceRecord", "annualMaintenanceRecords", annual));
  for (const jurisdiction of arrayOf(bundle?.jurisdictionMetadata)) records.push(makeRecord("jurisdictionMetadata", "jurisdictionMetadata", jurisdiction));
  for (const log of arrayOf(bundle?.supportLogs ?? bundle?.logs)) records.push(makeRecord("supportLog", "supportLogs", log));
  for (const evidence of arrayOf(bundle?.sourceEvidence)) records.push(makeRecord("sourceEvidence", "sourceEvidence", evidence));
  for (const secret of arrayOf(bundle?.secretVaultItems)) records.push(makeRecord("secretVaultItem", "secrets", secret));
  for (const training of arrayOf(bundle?.pipaTrainings)) records.push(makeRecord("pipaTraining", "pipaTraining", training));
  for (const employee of arrayOf(bundle?.employees)) records.push(makeRecord("employee", "employees", employee));
  for (const volunteer of arrayOf(bundle?.volunteers)) records.push(makeRecord("volunteer", "volunteers", volunteer));
  for (const doc of arrayOf(bundle?.documentMap)) records.push(makeRecord("documentCandidate", firstSection(doc), doc));
  return records;
}

function makeRecord(recordKind: string, targetModule: string, rawPayload: any) {
  const payload = normalizePayload(recordKind, rawPayload);
  const sourceExternalIds = sourceExternalIdsFor(recordKind, payload);
  const confidence = confidenceFor(payload);
  return {
    recordKind,
    targetModule,
    title: titleForRecord(recordKind, payload),
    description: descriptionForRecord(recordKind, payload),
    payload,
    sourceExternalIds,
    confidence,
    riskFlags: riskFlagsFor(recordKind, targetModule, payload),
  };
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

function historySourceTags(source: any) {
  return [HISTORY_TAG, HISTORY_SOURCE_TAG, tagValue(source.category), tagValue(source.externalSystem)].filter(Boolean);
}

function riskFlagsFor(recordKind: string, targetModule: string, payload: any) {
  const flags = new Set<string>();
  const sections = Array.isArray(payload?.sections) ? payload.sections.join(" ") : "";
  const tags = Array.isArray(payload?.tags) ? payload.tags.join(" ") : "";
  const text = `${recordKind} ${targetModule} ${payload?.category ?? ""} ${payload?.notes ?? ""} ${payload?.title ?? ""} ${payload?.name ?? ""} ${payload?.service ?? ""} ${payload?.credentialType ?? ""} ${payload?.sensitivity ?? ""} ${sections} ${tags}`.toLowerCase();
  if (confidenceFor(payload) === "Review" || payload?.status === "NeedsReview") flags.add("needs review");
  if (payload?.sensitivity === "restricted") flags.add("restricted");
  if (/(finance|financial|treasurer|receipt|invoice|payroll|tax|bank|employee|member|student id|privacy|insurance|legal|sin|secret|credential|password|recovery key|registry key|api key)/.test(text)) flags.add("restricted");
  if (/(duplicate|ocr|bad date|manual review|placeholder)/.test(text)) flags.add("cleanup");
  for (const flag of staticValidationFlagsFor(recordKind, payload)) flags.add(flag);
  return Array.from(flags);
}

function staticValidationFlagsFor(recordKind: string, payload: any) {
  const flags: string[] = [];
  if ([
    "organizationAddress",
    "organizationRegistration",
    "organizationIdentifier",
    "policy",
    "workflowPackage",
    "minuteBookItem",
    "roleHolder",
    "rightsClass",
    "rightsholdingTransfer",
    "legalTemplateDataField",
    "legalTemplate",
    "legalPrecedent",
    "legalPrecedentRun",
    "generatedLegalDocument",
    "legalSigner",
    "formationRecord",
    "nameSearchItem",
    "entityAmendment",
    "annualMaintenanceRecord",
    "jurisdictionMetadata",
    "supportLog",
  ].includes(recordKind)) {
    if (confidenceFor(payload) === "Review") flags.push("confidence");
  }
  if (recordKind === "organizationAddress" && (!cleanText(payload?.street) && !cleanText(payload?.address))) flags.push("validation");
  if (recordKind === "organizationAddress" && !cleanText(payload?.city)) flags.push("validation");
  if (recordKind === "organizationRegistration" && !cleanText(payload?.jurisdiction)) flags.push("validation");
  if (recordKind === "organizationIdentifier" && (!cleanText(payload?.number) || (!cleanText(payload?.kind) && !cleanText(payload?.type)))) flags.push("validation");
  if (recordKind === "policy" && !cleanText(payload?.policyName) && !cleanText(payload?.name)) flags.push("validation");
  if (recordKind === "workflowPackage" && (!cleanText(payload?.eventType) || (!cleanText(payload?.packageName) && !cleanText(payload?.package)))) flags.push("validation");
  if (recordKind === "minuteBookItem" && !cleanText(payload?.title)) flags.push("validation");
  if (recordKind === "roleHolder" && !cleanText(payload?.fullName) && !cleanText(payload?.name) && !cleanText(payload?.firstName) && !cleanText(payload?.lastName)) flags.push("validation");
  if (recordKind === "rightsClass" && !cleanText(payload?.className) && !cleanText(payload?.name) && !cleanText(payload?.rightsClassName)) flags.push("validation");
  if (recordKind === "legalTemplateDataField" && !cleanText(payload?.name) && !cleanText(payload?.fieldName)) flags.push("validation");
  if (recordKind === "legalTemplate" && !cleanText(payload?.name) && !cleanText(payload?.templateName)) flags.push("validation");
  if (recordKind === "legalPrecedent" && !cleanText(payload?.packageName) && !cleanText(payload?.name)) flags.push("validation");
  if (recordKind === "legalPrecedentRun" && !cleanText(payload?.name) && !cleanText(payload?.partName)) flags.push("validation");
  if (recordKind === "generatedLegalDocument" && !cleanText(payload?.title) && !cleanText(payload?.documentName)) flags.push("validation");
  if (recordKind === "legalSigner" && !cleanText(payload?.fullName) && !cleanText(payload?.name) && !cleanText(payload?.email)) flags.push("validation");
  if (recordKind === "nameSearchItem" && !cleanText(payload?.name)) flags.push("validation");
  if (recordKind === "jurisdictionMetadata" && !cleanText(payload?.jurisdiction) && !cleanText(payload?.value)) flags.push("validation");
  return flags;
}

function confidenceFor(payload: any) {
  return payload?.confidence === "High" || payload?.confidence === "Medium" ? payload.confidence : "Review";
}

function normalizeReviewStatus(status: unknown) {
  const value = cleanText(status);
  return REVIEW_STATUSES.includes(value as any) ? value : "Pending";
}

function sessionName(bundle: any) {
  return cleanText(bundle?.metadata?.name) || cleanText(bundle?.name) || "Paperless import session";
}

function sourceSystem(bundle: any) {
  return cleanText(bundle?.metadata?.createdFrom) || cleanText(bundle?.sourceExport?.baseUrl) || "Paperless";
}

function firstSection(doc: any) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : Array.isArray(doc?.candidateSections) ? doc.candidateSections : [];
  return cleanText(sections[0]) || "Documents";
}

function importedLibrarySection(targetModule: unknown, sections: string[] = []) {
  const haystack = [targetModule, ...sections].map((value) => cleanText(value)?.toLowerCase()).filter(Boolean).join(" ");
  if (/\bmeeting|minutes|agenda|board\b/.test(haystack)) return "meeting_material";
  if (/\bfinancial|treasurer|budget|receipt|expense\b/.test(haystack)) return "finance";
  if (/\bpolicy|privacy|pipa\b/.test(haystack)) return "policy";
  if (/\bconstitution|bylaw|governance|filing|resolution|minute-book\b/.test(haystack)) return "governance";
  return "reference";
}

function inferMeetingType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("annual general") || lower.includes("agm")) return "AGM";
  if (lower.includes("committee")) return "Committee";
  if (lower.includes("special general") || lower.includes("sgm")) return "SGM";
  return "Board";
}

function toMeetingDateTime(date: unknown) {
  const value = cleanText(date) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00.000Z`;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01T12:00:00.000Z`;
  if (/^\d{4}$/.test(value)) return `${value}-01-01T12:00:00.000Z`;
  return new Date().toISOString();
}

function bylawImportHistory(payload: any, status: string, sourceExternalIds: string[]) {
  const now = new Date().toISOString();
  const actor = cleanText(payload.createdByName) || cleanText(payload.filedBy) || "Import review";
  const createdAt = cleanDateTime(payload.createdAtISO) || cleanDateTime(payload.sourceDate) || now;
  const history = [
    {
      atISO: createdAt,
      actor,
      action: "created",
      note: [
        "Created from approved import-session record.",
        sourceExternalIds.length ? `Sources: ${sourceExternalIds.join(", ")}` : undefined,
      ].filter(Boolean).join(" "),
    },
  ];
  const resolutionAt = cleanDateTime(payload.resolutionPassedAtISO) || cleanDateTime(payload.specialResolutionDate);
  if (resolutionAt) {
    history.push({
      atISO: resolutionAt,
      actor,
      action: "resolution_passed",
      note: "Resolution date imported from source document.",
    });
  }
  const filedAt = cleanDateTime(payload.filedAtISO) || cleanDateTime(payload.filedAt);
  if (status === "Filed" && filedAt) {
    history.push({
      atISO: filedAt,
      actor,
      action: "filed",
      note: "Filing date imported from source document.",
    });
  }
  return history;
}

export {
  recordsFromBundle,
  makeRecord,
  targetTableForRecordKind,
  historySourceTags,
  riskFlagsFor,
  staticValidationFlagsFor,
  confidenceFor,
  normalizeReviewStatus,
  sessionName,
  sourceSystem,
  firstSection,
  importedLibrarySection,
  inferMeetingType,
  toMeetingDateTime,
  bylawImportHistory,
};
