// Import-session helpers extracted from importSessions.ts: shared constants plus
// the pure + ctx-taking helper functions (normalization, hydration, evidence,
// summaries, payload parsing). The Convex query/mutation registrations that use
// them stay in importSessions.ts so all api.importSessions.* paths are unchanged.

import { invalidOptionIssue, invalidOptionListIssues } from "./lib/orgHubOptions";
import { transactionImportMappingCandidates } from "./providers/accounting";

import {
  SESSION_TAG,
  RECORD_TAG,
  SECTION_RECORD_KINDS,
  appendImportNote,
  recordsForSession,
} from "./importSessionHelpers.part1";
import {
  mergeInsurancePolicies,
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
  summarizeRecords,
  hydrateSession,
  hydrateRecord,
  isImportSession,
  isImportRecord,
} from "./importSessionHelpers.part3";
import {
  riskFlagsFor,
  confidenceFor,
  sourceSystem,
  firstSection,
  cleanDate,
  tagValue,
  cleanText,
  arrayOf,
  compactStrings,
  compactRecord,
  unique,
  numberOrUndefined,
  optionalBoolean,
  sourceSystemFromExternalId,
} from "./importSessionHelpers.part4";

async function patchRecordImportTarget(ctx: any, record: any, target: string, value: any) {
  await ctx.db.patch(record._id, {
    content: JSON.stringify({
      ...record,
      importedTargets: { ...(record.importedTargets ?? {}), [target]: value },
      updatedAtISO: new Date().toISOString(),
    }),
  });
}

async function patchRecordPromotionBlocked(ctx: any, record: any, issues: string[]) {
  const riskFlags = unique([
    ...(record.riskFlags ?? []),
    "validation",
    issues.some((issue) => issue.toLowerCase().includes("duplicate")) ? "duplicate" : "",
    issues.some((issue) => issue.toLowerCase().includes("confidence")) ? "confidence" : "",
  ]);
  await ctx.db.patch(record._id, {
    content: JSON.stringify({
      ...record,
      status: "Pending",
      reviewNotes: appendImportNote(
        record.reviewNotes,
        `Promotion blocked: ${issues.join("; ")}`,
      ),
      riskFlags,
      updatedAtISO: new Date().toISOString(),
    }),
    tags: [SESSION_TAG, RECORD_TAG, tagValue(record.recordKind), tagValue(record.targetModule), "promotion-blocked"].filter(Boolean),
  });
}

async function importPromotionIssues(ctx: any, societyId: string, record: any) {
  const kind = record.recordKind;
  if (![
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
  ].includes(kind)) {
    return [];
  }

  const payload = normalizePayload(kind, record.payload ?? {});
  const issues: string[] = [];
  if (confidenceFor(payload) === "Review" && !cleanText(record.reviewNotes)) {
    issues.push("Review-confidence records need reviewer notes before promotion.");
  }

  if (kind === "organizationAddress") {
    if (!cleanText(payload.street) && !cleanText(payload.address)) issues.push("Address street/address is required.");
    if (!cleanText(payload.city)) issues.push("Address city is required.");
    addIssue(issues, invalidOptionIssue("addressTypes", payload.type, "Address type", false));
    addIssue(issues, invalidOptionIssue("addressStatuses", payload.status, "Address status"));
    const rows = await ctx.db.query("organizationAddresses").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = addressKey({
      type: cleanText(payload.type) || "other",
      street: cleanText(payload.street) || cleanText(payload.address),
      city: cleanText(payload.city),
      provinceState: cleanText(payload.provinceState) || cleanText(payload.province),
      postalCode: cleanText(payload.postalCode),
      country: cleanText(payload.country) || "Canada",
    });
    if (key && rows.some((row: any) => addressKey(row) === key)) issues.push("Duplicate structured address already exists.");
  }

  if (kind === "organizationRegistration") {
    if (!cleanText(payload.jurisdiction)) issues.push("Registration jurisdiction is required.");
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdiction, "Registration jurisdiction", false));
    addIssue(issues, invalidOptionIssue("registrationStatuses", payload.status, "Registration status"));
    const rows = await ctx.db.query("organizationRegistrations").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.jurisdiction, payload.registrationNumber, payload.assumedName]);
    if (key && rows.some((row: any) => compactKey([row.jurisdiction, row.registrationNumber, row.assumedName]) === key)) {
      issues.push("Duplicate organization registration already exists.");
    }
  }

  if (kind === "organizationIdentifier") {
    if (!cleanText(payload.number)) issues.push("Identifier number is required.");
    if (!cleanText(payload.kind) && !cleanText(payload.type)) issues.push("Identifier kind is required.");
    addIssue(issues, invalidOptionIssue("taxNumberTypes", payload.kind ?? payload.type, "Identifier kind", false));
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdiction, "Identifier jurisdiction"));
    addIssue(issues, invalidOptionIssue("identifierStatuses", payload.status, "Identifier status"));
    addIssue(issues, invalidOptionIssue("accessLevels", payload.accessLevel, "Identifier access level"));
    const rows = await ctx.db.query("organizationIdentifiers").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.kind ?? payload.type, payload.number, payload.jurisdiction, payload.foreignJurisdiction]);
    if (key && rows.some((row: any) => compactKey([row.kind, row.number, row.jurisdiction, row.foreignJurisdiction]) === key)) {
      issues.push("Duplicate organization identifier already exists.");
    }
  }

  if (kind === "policy") {
    if (!cleanText(payload.policyName) && !cleanText(payload.name)) issues.push("Policy name is required.");
    addIssue(issues, invalidOptionIssue("policyStatuses", payload.status, "Policy status"));
    issues.push(...invalidOptionListIssues("requiredSigners", payload.requiredSigners, "Required signers"));
    issues.push(...invalidOptionListIssues("entityJurisdictions", payload.jurisdictions, "Jurisdictions"));
    issues.push(...invalidOptionListIssues("entityTypes", payload.entityTypes, "Entity types"));
    const rows = await ctx.db.query("policies").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.policyNumber || payload.policyName || payload.name]);
    if (key && rows.some((row: any) => compactKey([row.policyNumber || row.policyName]) === key)) issues.push("Duplicate policy already exists.");
  }

  if (kind === "workflowPackage") {
    if (!cleanText(payload.eventType)) issues.push("Workflow package event type is required.");
    if (!cleanText(payload.packageName) && !cleanText(payload.package)) issues.push("Workflow package name is required.");
    addIssue(issues, invalidOptionIssue("eventTypes", payload.eventType, "Workflow package event type", false));
    addIssue(issues, invalidOptionIssue("workflowPackageStatuses", payload.status, "Workflow package status"));
    const rows = await ctx.db.query("workflowPackages").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.eventType, payload.packageName ?? payload.package, payload.effectiveDate]);
    if (key && rows.some((row: any) => compactKey([row.eventType, row.packageName, row.effectiveDate]) === key)) {
      issues.push("Duplicate workflow package already exists.");
    }
  }

  if (kind === "minuteBookItem") {
    if (!cleanText(payload.title)) issues.push("Minute book title is required.");
    addIssue(issues, invalidOptionIssue("minuteBookRecordTypes", payload.recordType ?? payload.type, "Minute book record type"));
    addIssue(issues, invalidOptionIssue("minuteBookStatuses", payload.status, "Minute book status"));
    const rows = await ctx.db.query("minuteBookItems").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.title, payload.recordType ?? payload.type, payload.effectiveDate ?? payload.sourceDate]);
    if (key && rows.some((row: any) => compactKey([row.title, row.recordType, row.effectiveDate]) === key)) {
      issues.push("Duplicate minute book record already exists.");
    }
  }

  if (kind === "roleHolder") {
    if (!cleanText(payload.fullName) && !cleanText(payload.name) && !cleanText(payload.firstName) && !cleanText(payload.lastName)) {
      issues.push("Role holder name is required.");
    }
    addIssue(issues, invalidOptionIssue("representativeTypes", payload.roleType ?? payload.type ?? payload.role, "Role-holder type", false));
    addIssue(issues, invalidOptionIssue("roleHolderStatuses", payload.status, "Role-holder status"));
    addIssue(issues, invalidOptionIssue("officerTitles", payload.officerTitle ?? payload.title, "Officer title"));
    addIssue(issues, invalidOptionIssue("directorTerms", payload.directorTerm ?? payload.term, "Director term"));
    addIssue(issues, invalidOptionIssue("citizenshipResidencies", payload.citizenshipResidency, "Citizenship/residency"));
    const rows = await ctx.db.query("roleHolders").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.fullName ?? payload.name, payload.email, payload.roleType ?? payload.type ?? payload.role, payload.startDate]);
    if (key && rows.some((row: any) => compactKey([row.fullName, row.email, row.roleType, row.startDate]) === key)) {
      issues.push("Duplicate role holder already exists.");
    }
  }

  if (kind === "rightsClass") {
    if (!cleanText(payload.className) && !cleanText(payload.name) && !cleanText(payload.rightsClassName)) issues.push("Rights class name is required.");
    addIssue(issues, invalidOptionIssue("rightsClassTypes", payload.classType ?? payload.type, "Rights class type", false));
    addIssue(issues, invalidOptionIssue("rightsClassStatuses", payload.status, "Rights class status"));
    const rows = await ctx.db.query("rightsClasses").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.className ?? payload.name ?? payload.rightsClassName, payload.classType ?? payload.type]);
    if (key && rows.some((row: any) => compactKey([row.className, row.classType]) === key)) issues.push("Duplicate rights class already exists.");
  }

  if (kind === "rightsholdingTransfer") {
    addIssue(issues, invalidOptionIssue("rightsholdingTransferTypes", payload.transferType ?? payload.type, "Rights transfer type", false));
    addIssue(issues, invalidOptionIssue("rightsholdingTransferStatuses", payload.status, "Rights transfer status"));
    addIssue(issues, invalidOptionIssue("currencies", payload.priceToOrganizationCurrency ?? payload.priceToCorpCurrency, "Organization consideration currency"));
    addIssue(issues, invalidOptionIssue("currencies", payload.priceToVendorCurrency, "Vendor consideration currency"));
    const rows = await ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.transferDate ?? payload.date, payload.rightsClassId ?? payload.rightsClassName, payload.sourceHolderName, payload.destinationHolderName, payload.quantity]);
    if (key && rows.some((row: any) => compactKey([row.transferDate, row.rightsClassId, row.sourceHolderName, row.destinationHolderName, row.quantity]) === key)) {
      issues.push("Duplicate rightsholding transfer already exists.");
    }
  }

  if (kind === "legalTemplateDataField") {
    if (!cleanText(payload.name) && !cleanText(payload.fieldName)) issues.push("Template data field name is required.");
    const rows = await ctx.db.query("legalTemplateDataFields").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.name ?? payload.fieldName]);
    if (key && rows.some((row: any) => compactKey([row.name]) === key)) issues.push("Duplicate template data field already exists.");
  }

  if (kind === "legalTemplate") {
    if (!cleanText(payload.name) && !cleanText(payload.templateName)) issues.push("Template name is required.");
    addIssue(issues, invalidOptionIssue("templateTypes", payload.templateType ?? payload.type, "Template type", false));
    addIssue(issues, invalidOptionIssue("templateStatuses", payload.status, "Template status"));
    addIssue(issues, invalidOptionIssue("documentTags", payload.documentTag, "Document tag"));
    addIssue(issues, invalidOptionIssue("filingTypes", payload.filingType, "Filing type"));
    issues.push(...invalidOptionListIssues("requiredSigners", payload.requiredSigners, "Required signers"));
    issues.push(...invalidOptionListIssues("entityJurisdictions", payload.jurisdictions, "Jurisdictions"));
    issues.push(...invalidOptionListIssues("entityTypes", payload.entityTypes, "Entity types"));
    const rows = await ctx.db.query("legalTemplates").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.templateType ?? payload.type, payload.name ?? payload.templateName]);
    if (key && rows.some((row: any) => compactKey([row.templateType, row.name]) === key)) issues.push("Duplicate legal template already exists.");
  }

  if (kind === "legalPrecedent") {
    if (!cleanText(payload.packageName) && !cleanText(payload.name)) issues.push("Precedent package name is required.");
    addIssue(issues, invalidOptionIssue("precedentStatuses", payload.status, "Precedent status"));
    addIssue(issues, invalidOptionIssue("partTypes", payload.partType, "Part type"));
    const rows = await ctx.db.query("legalPrecedents").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.packageName ?? payload.name, payload.partType]);
    if (key && rows.some((row: any) => compactKey([row.packageName, row.partType]) === key)) issues.push("Duplicate legal precedent already exists.");
  }

  if (kind === "legalPrecedentRun") {
    if (!cleanText(payload.name) && !cleanText(payload.partName)) issues.push("Precedent run name is required.");
    addIssue(issues, invalidOptionIssue("precedentRunStatuses", payload.status, "Precedent run status"));
    const rows = await ctx.db.query("legalPrecedentRuns").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.name ?? payload.partName, payload.eventId ?? payload.relatedEventId, payload.dateTime]);
    if (key && rows.some((row: any) => compactKey([row.name, row.eventId, row.dateTime]) === key)) issues.push("Duplicate legal precedent run already exists.");
  }

  if (kind === "generatedLegalDocument") {
    if (!cleanText(payload.title) && !cleanText(payload.documentName)) issues.push("Generated document title is required.");
    addIssue(issues, invalidOptionIssue("generatedDocumentStatuses", payload.status, "Generated document status"));
    addIssue(issues, invalidOptionIssue("documentTags", payload.documentTag, "Generated document tag"));
    const rows = await ctx.db.query("generatedLegalDocuments").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.title ?? payload.documentName, payload.syngrafiiDocumentId, payload.effectiveDate]);
    if (key && rows.some((row: any) => compactKey([row.title, row.syngrafiiDocumentId, row.effectiveDate]) === key)) {
      issues.push("Duplicate generated legal document already exists.");
    }
  }

  if (kind === "legalSigner") {
    if (!cleanText(payload.fullName) && !cleanText(payload.name) && !cleanText(payload.email)) issues.push("Signer name or email is required.");
    addIssue(issues, invalidOptionIssue("signerStatuses", payload.status ?? payload.signerStatus, "Signer status"));
    const rows = await ctx.db.query("legalSigners").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.email, payload.signerId, payload.signerTag]);
    if (key && rows.some((row: any) => compactKey([row.email, row.signerId, row.signerTag]) === key)) issues.push("Duplicate legal signer already exists.");
  }

  if (kind === "formationRecord") {
    addIssue(issues, invalidOptionIssue("formationStatuses", payload.status, "Formation status"));
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdiction, "Formation jurisdiction"));
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.extraProvincialRegistrationJurisdiction, "Extra-provincial registration jurisdiction"));
    const rows = await ctx.db.query("formationRecords").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.nuansNumber, payload.jurisdiction, payload.relatedIncorporationEventId]);
    if (key && rows.some((row: any) => compactKey([row.nuansNumber, row.jurisdiction, row.relatedIncorporationEventId]) === key)) {
      issues.push("Duplicate formation record already exists.");
    }
  }

  if (kind === "nameSearchItem") {
    if (!cleanText(payload.name)) issues.push("Name search name is required.");
    addIssue(issues, invalidOptionIssue("suffixCompanyNames", payload.suffix, "Name suffix"));
    const rows = await ctx.db.query("nameSearchItems").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.name, payload.nuansReportNumber, payload.rank]);
    if (key && rows.some((row: any) => compactKey([row.name, row.nuansReportNumber, row.rank]) === key)) issues.push("Duplicate name search item already exists.");
  }

  if (kind === "entityAmendment") {
    addIssue(issues, invalidOptionIssue("amendmentStatuses", payload.status, "Amendment status"));
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdictionNew ?? payload.newJurisdiction, "New jurisdiction"));
    const rows = await ctx.db.query("entityAmendments").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.entityNameNew ?? payload.newEntityName, payload.effectiveDate, payload.jurisdictionNew ?? payload.newJurisdiction]);
    if (key && rows.some((row: any) => compactKey([row.entityNameNew, row.effectiveDate, row.jurisdictionNew]) === key)) issues.push("Duplicate entity amendment already exists.");
  }

  if (kind === "annualMaintenanceRecord") {
    addIssue(issues, invalidOptionIssue("annualMaintenanceStatuses", payload.status, "Annual maintenance status"));
    addIssue(issues, invalidOptionIssue("annualFinancialStatementOptions", payload.annualFinancialStatementOption, "Annual financial statement option"));
    const rows = await ctx.db.query("annualMaintenanceRecords").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.yearFilingFor ?? payload.filingYear, payload.filingDate, payload.lastAgmDate]);
    if (key && rows.some((row: any) => compactKey([row.yearFilingFor, row.filingDate, row.lastAgmDate]) === key)) {
      issues.push("Duplicate annual maintenance record already exists.");
    }
  }

  if (kind === "jurisdictionMetadata") {
    if (!cleanText(payload.jurisdiction) && !cleanText(payload.value)) issues.push("Jurisdiction value is required.");
    addIssue(issues, invalidOptionIssue("entityJurisdictions", payload.jurisdiction ?? payload.value, "Jurisdiction", false));
    addIssue(issues, invalidOptionIssue("actsFormedUnder", payload.actFormedUnder, "Act formed under"));
    const rows = await ctx.db.query("jurisdictionMetadata").collect();
    const key = compactKey([payload.jurisdiction ?? payload.value]);
    if (key && rows.some((row: any) => compactKey([row.jurisdiction]) === key)) issues.push("Duplicate jurisdiction metadata already exists.");
  }

  if (kind === "supportLog") {
    addIssue(issues, invalidOptionIssue("logTypes", payload.logType ?? payload.type, "Log type", false));
    addIssue(issues, invalidOptionIssue("logSeverities", payload.severity, "Log severity"));
    const rows = await ctx.db.query("supportLogs").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const key = compactKey([payload.createdAtISO, payload.logType ?? payload.type, payload.errorCode, payload.errorMessage, payload.pageLocationUrl ?? payload.url]);
    if (key && rows.some((row: any) => compactKey([row.createdAtISO, row.logType, row.errorCode, row.errorMessage, row.pageLocationUrl]) === key)) {
      issues.push("Duplicate support log already exists.");
    }
  }

  return unique(issues);
}

function addressKey(row: any) {
  return compactKey([row.type, row.street, row.city, row.provinceState, row.postalCode, row.country]);
}

function compactKey(values: unknown[]) {
  return values.map((value) => cleanText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean).join("|");
}

function addIssue(issues: string[], issue?: string) {
  if (issue) issues.push(issue);
}

async function patchSessionUpdatedAt(ctx: any, sessionId: string) {
  const doc = await ctx.db.get(sessionId);
  if (!isImportSession(doc)) return;
  const payload = hydrateSession(doc);
  const records = (await recordsForSession(ctx, sessionId))
    .filter(isImportRecord)
    .map(hydrateRecord)
    .filter((record) => record.sessionId === sessionId);
  const summary = summarizeRecords(records);
  await ctx.db.patch(sessionId, {
    content: JSON.stringify({ ...payload, summary, updatedAtISO: new Date().toISOString() }),
  });
  return summary;
}

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

async function transactionCandidateMappingNotes(ctx: any, societyId: any, payload: any, record: any) {
  const candidates = transactionImportMappingCandidates({
    sourceSystem: payload?.sourceSystem ?? payload?.externalSystem ?? sourceSystemFromExternalId(record?.sourceExternalIds?.[0]),
    accountName: cleanText(payload?.accountName),
    accountExternalId: cleanText(payload?.accountExternalId) ?? cleanText(payload?.accountId),
    accountCode: cleanText(payload?.accountCode),
    category: cleanText(payload?.category),
  });
  if (candidates.length === 0) return undefined;

  const providers = unique(candidates.map((candidate) => candidate.provider));
  const mappings = (
    await Promise.all(
      providers.map((provider) =>
        ctx.db
          .query("accountingAccountMappings")
          .withIndex("by_society_provider", (q: any) => q.eq("societyId", societyId).eq("provider", provider))
          .collect(),
      ),
    )
  ).flat().filter((mapping: any) => mapping.status === "active");

  const matches = candidates
    .map((candidate) => {
      const match = mappings.find((mapping: any) => mappingMatchesCandidate(mapping, candidate));
      if (!match) return undefined;
      return `${candidate.externalCategory ? "category" : "account"} ${candidate.externalAccountName ?? candidate.externalCategory ?? candidate.externalAccountId ?? candidate.externalAccountCode} -> ${match.financialAccountId}`;
    })
    .filter(Boolean);
  if (matches.length === 0) return undefined;
  return `Accounting mapping suggestions: ${unique(matches).join("; ")}`;
}

function mappingMatchesCandidate(mapping: any, candidate: any) {
  const equal = (a: unknown, b: unknown) => {
    const left = cleanText(a)?.toLowerCase();
    const right = cleanText(b)?.toLowerCase();
    return Boolean(left && right && left === right);
  };
  return (
    equal(mapping.externalAccountId, candidate.externalAccountId) ||
    equal(mapping.externalAccountCode, candidate.externalAccountCode) ||
    equal(mapping.externalAccountName, candidate.externalAccountName) ||
    equal(mapping.externalCategory, candidate.externalCategory)
  );
}

function normalizePayload(recordKind: string, payload: any) {
  if (recordKind === "source") return normalizeSourcePayload(payload);
  if (recordKind === "motion") return normalizeMotionPayload(payload);
  if (recordKind === "meetingMinutes") return normalizeMeetingMinutesPayload(payload);
  if (recordKind === "budget") return normalizeBudgetPayload(payload);
  if (SECTION_RECORD_KINDS.includes(recordKind as any)) return normalizeSectionPayload(payload);
  return { ...(payload ?? {}) };
}

function normalizeSourcePayload(source: any) {
  return {
    externalSystem: cleanText(source?.externalSystem) || "paperless",
    externalId: cleanText(source?.externalId),
    title: cleanText(source?.title),
    sourceDate: cleanText(source?.sourceDate),
    category: cleanText(source?.category) || "Other",
    confidence: confidenceFor(source),
    notes: cleanText(source?.notes),
    url: cleanText(source?.url),
    localPath: cleanText(source?.localPath),
    fileName: cleanText(source?.fileName),
    mimeType: cleanText(source?.mimeType),
    fileSizeBytes: numberOrUndefined(source?.fileSizeBytes),
    sha256: cleanText(source?.sha256),
    sensitivity: cleanText(source?.sensitivity),
    tags: arrayOf(source?.tags).map(String),
  };
}

function normalizeMotionPayload(motion: any) {
  return {
    meetingDate: cleanText(motion?.meetingDate),
    meetingTitle: cleanText(motion?.meetingTitle),
    motionText: cleanText(motion?.motionText),
    outcome: cleanText(motion?.outcome),
    movedByName: cleanText(motion?.movedByName),
    secondedByName: cleanText(motion?.secondedByName),
    votesFor: numberOrUndefined(motion?.votesFor),
    votesAgainst: numberOrUndefined(motion?.votesAgainst),
    abstentions: numberOrUndefined(motion?.abstentions),
    resolutionType: cleanText(motion?.resolutionType),
    voteSummary: cleanText(motion?.voteSummary),
    pageRef: cleanText(motion?.pageRef),
    evidenceText: cleanText(motion?.evidenceText),
    rawText: cleanText(motion?.rawText),
    category: cleanText(motion?.category) || "Governance",
    sourceExternalIds: arrayOf(motion?.sourceExternalIds).map(String),
    notes: cleanText(motion?.notes),
  };
}

function normalizeMeetingMinutesPayload(minutes: any) {
  return {
    meetingDate: cleanText(minutes?.meetingDate),
    meetingTitle: cleanText(minutes?.meetingTitle),
    chairName: cleanText(minutes?.chairName),
    secretaryName: cleanText(minutes?.secretaryName),
    recorderName: cleanText(minutes?.recorderName),
    calledToOrderAt: cleanText(minutes?.calledToOrderAt),
    adjournedAt: cleanText(minutes?.adjournedAt),
    remoteParticipation: normalizeRemoteParticipationPayload(minutes?.remoteParticipation),
    detailedAttendance: normalizeDetailedAttendancePayload(minutes?.detailedAttendance),
    attendees: compactStrings(arrayOf(minutes?.attendees)),
    absent: compactStrings(arrayOf(minutes?.absent)),
    quorumMet: Boolean(minutes?.quorumMet),
    agendaItems: compactStrings(arrayOf(minutes?.agendaItems)),
    discussion: cleanText(minutes?.discussion),
    sections: normalizeMinuteSectionsPayload(minutes?.sections),
    motions: arrayOf(minutes?.motions).map(normalizeMotionPayload),
    decisions: compactStrings(arrayOf(minutes?.decisions)),
    actionItems: arrayOf(minutes?.actionItems).map(normalizeMinutesActionItem).filter(Boolean),
    nextMeetingAt: cleanText(minutes?.nextMeetingAt),
    nextMeetingLocation: cleanText(minutes?.nextMeetingLocation),
    nextMeetingNotes: cleanText(minutes?.nextMeetingNotes),
    sessionSegments: normalizeSessionSegmentsPayload(minutes?.sessionSegments),
    appendices: normalizeAppendicesPayload(minutes?.appendices),
    agmDetails: normalizeAgmDetailsPayload(minutes?.agmDetails),
    sourceExternalIds: arrayOf(minutes?.sourceExternalIds).map(String),
    sourceDocumentTitle: cleanText(minutes?.sourceDocumentTitle),
    sourceDocumentId: minutes?.sourceDocumentId != null ? String(minutes.sourceDocumentId) : undefined,
    sectionIndex: numberOrUndefined(minutes?.sectionIndex),
    pageRef: cleanText(minutes?.pageRef),
    confidence: confidenceFor(minutes),
    notes: cleanText(minutes?.notes),
  };
}

function structuredMinutesPatchFromPayload(payload: any) {
  return compactRecord({
    chairName: cleanText(payload?.chairName),
    secretaryName: cleanText(payload?.secretaryName),
    recorderName: cleanText(payload?.recorderName),
    calledToOrderAt: cleanText(payload?.calledToOrderAt),
    adjournedAt: cleanText(payload?.adjournedAt),
    remoteParticipation: normalizeRemoteParticipationPayload(payload?.remoteParticipation),
    detailedAttendance: normalizeDetailedAttendancePayload(payload?.detailedAttendance),
    sections: normalizeMinuteSectionsPayload(payload?.sections),
    nextMeetingAt: cleanText(payload?.nextMeetingAt),
    nextMeetingLocation: cleanText(payload?.nextMeetingLocation),
    nextMeetingNotes: cleanText(payload?.nextMeetingNotes),
    sessionSegments: normalizeSessionSegmentsPayload(payload?.sessionSegments),
    appendices: normalizeAppendicesPayload(payload?.appendices),
    agmDetails: normalizeAgmDetailsPayload(payload?.agmDetails),
  }) ?? {};
}

function normalizeRemoteParticipationPayload(value: any) {
  if (!value || typeof value !== "object") return undefined;
  return compactRecord({
    url: cleanText(value.url),
    meetingId: cleanText(value.meetingId),
    passcode: cleanText(value.passcode),
    instructions: cleanText(value.instructions),
  });
}

function normalizeDetailedAttendancePayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      name: cleanText(row?.name),
      status: cleanText(row?.status) || "present",
      roleTitle: cleanText(row?.roleTitle),
      affiliation: cleanText(row?.affiliation),
      memberIdentifier: cleanText(row?.memberIdentifier),
      proxyFor: cleanText(row?.proxyFor),
      quorumCounted: optionalBoolean(row?.quorumCounted),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.name);
  return rows.length ? rows : undefined;
}

function normalizeMinuteSectionsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      title: cleanText(row?.title),
      type: cleanText(row?.type),
      presenter: cleanText(row?.presenter),
      discussion: cleanText(row?.discussion),
      reportSubmitted: optionalBoolean(row?.reportSubmitted),
      decisions: arrayOf(row?.decisions).map(String).map(cleanText).filter(Boolean),
      actionItems: normalizeActionItemsPayload(row?.actionItems),
    }))
    .filter((row: any) => row?.title);
  return rows.length ? rows : undefined;
}

function normalizeActionItemsPayload(value: any) {
  const rows = arrayOf(value)
    .map(normalizeMinutesActionItem)
    .filter((row: any) => row?.text);
  return rows.length ? rows : undefined;
}

function normalizeMinutesActionItem(row: any) {
  const text = typeof row === "string" ? cleanText(row) : cleanText(row?.text);
  if (!text) return null;
  return compactRecord({
    text,
    assignee: cleanText(row?.assignee),
    dueDate: cleanText(row?.dueDate),
    done: Boolean(row?.done),
  });
}

function normalizeSessionSegmentsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      type: cleanText(row?.type) || "other",
      title: cleanText(row?.title),
      startedAt: cleanText(row?.startedAt),
      endedAt: cleanText(row?.endedAt),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.type);
  return rows.length ? rows : undefined;
}

function normalizeAppendicesPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      title: cleanText(row?.title),
      type: cleanText(row?.type),
      reference: cleanText(row?.reference),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.title);
  return rows.length ? rows : undefined;
}

function normalizeAgmDetailsPayload(value: any) {
  if (!value || typeof value !== "object") return undefined;
  return compactRecord({
    financialStatementsPresented: optionalBoolean(value.financialStatementsPresented),
    financialStatementsNotes: cleanText(value.financialStatementsNotes),
    directorElectionNotes: cleanText(value.directorElectionNotes),
    directorAppointments: normalizeDirectorAppointmentsPayload(value.directorAppointments),
    specialResolutionExhibits: normalizeSpecialResolutionExhibitsPayload(value.specialResolutionExhibits),
  });
}

function normalizeDirectorAppointmentsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      name: cleanText(row?.name),
      roleTitle: cleanText(row?.roleTitle),
      affiliation: cleanText(row?.affiliation),
      term: cleanText(row?.term),
      consentRecorded: optionalBoolean(row?.consentRecorded),
      votesReceived: numberOrUndefined(row?.votesReceived),
      elected: optionalBoolean(row?.elected),
      status: cleanText(row?.status),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.name);
  return rows.length ? rows : undefined;
}

function normalizeSpecialResolutionExhibitsPayload(value: any) {
  const rows = arrayOf(value)
    .map((row: any) => compactRecord({
      title: cleanText(row?.title),
      reference: cleanText(row?.reference),
      notes: cleanText(row?.notes),
    }))
    .filter((row: any) => row?.title);
  return rows.length ? rows : undefined;
}

function normalizeBudgetPayload(budget: any) {
  return {
    ...(budget ?? {}),
    totalIncomeCents: numberOrUndefined(budget?.totalIncomeCents),
    totalExpenseCents: numberOrUndefined(budget?.totalExpenseCents),
    netCents: numberOrUndefined(budget?.netCents),
    endingBalanceCents: numberOrUndefined(budget?.endingBalanceCents),
    lines: arrayOf(budget?.lines),
    sourceExternalIds: arrayOf(budget?.sourceExternalIds).map(String),
  };
}

function normalizeSectionPayload(payload: any) {
  return {
    ...(payload ?? {}),
    sourceExternalIds: arrayOf(payload?.sourceExternalIds).map(String),
    highlights: arrayOf(payload?.highlights).map(String),
    concerns: arrayOf(payload?.concerns).map(String),
    sourceLines: arrayOf(payload?.sourceLines),
    lines: arrayOf(payload?.lines),
    submissionChecklist: arrayOf(payload?.submissionChecklist).map(String),
    interests: arrayOf(payload?.interests).map(String),
    riskFlags: arrayOf(payload?.riskFlags).map(String).map(cleanText).filter(Boolean),
    remunerationDisclosures: arrayOf(payload?.remunerationDisclosures),
    feePaidCents: numberOrUndefined(payload?.feePaidCents),
    coverageCents: numberOrUndefined(payload?.coverageCents),
    premiumCents: numberOrUndefined(payload?.premiumCents),
    deductibleCents: numberOrUndefined(payload?.deductibleCents),
    revenueCents: numberOrUndefined(payload?.revenueCents),
    expensesCents: numberOrUndefined(payload?.expensesCents),
    netAssetsCents: numberOrUndefined(payload?.netAssetsCents),
    restrictedFundsCents: numberOrUndefined(payload?.restrictedFundsCents),
    amountRequestedCents: numberOrUndefined(payload?.amountRequestedCents),
    amountAwardedCents: numberOrUndefined(payload?.amountAwardedCents),
    annualSalaryCents: numberOrUndefined(payload?.annualSalaryCents),
    hourlyWageCents: numberOrUndefined(payload?.hourlyWageCents),
    totalIncomeCents: numberOrUndefined(payload?.totalIncomeCents),
    totalExpenseCents: numberOrUndefined(payload?.totalExpenseCents),
    endingBalanceCents: numberOrUndefined(payload?.endingBalanceCents),
    cashBalanceCents: numberOrUndefined(payload?.cashBalanceCents),
    amountCents: numberOrUndefined(payload?.amountCents),
    policySeriesKey: cleanText(payload?.policySeriesKey),
    policyTermLabel: cleanText(payload?.policyTermLabel),
    versionType: cleanText(payload?.versionType),
    renewalOfPolicyNumber: cleanText(payload?.renewalOfPolicyNumber),
    additionalInsureds: arrayOf(payload?.additionalInsureds).map(String).map(cleanText).filter(Boolean),
    coveredParties: normalizeCoveredParties(payload?.coveredParties),
    coverageItems: normalizeCoverageItems(payload?.coverageItems),
    coveredLocations: normalizeCoveredLocations(payload?.coveredLocations),
    policyDefinitions: normalizePolicyDefinitions(payload?.policyDefinitions),
    declinedCoverages: normalizeDeclinedCoverages(payload?.declinedCoverages),
    certificatesOfInsurance: normalizeCertificatesOfInsurance(payload?.certificatesOfInsurance),
    insuranceRequirements: normalizeInsuranceRequirements(payload?.insuranceRequirements),
    claimsMadeTerms: normalizeClaimsMadeTerms(payload?.claimsMadeTerms),
    claimIncidents: normalizeClaimIncidents(payload?.claimIncidents),
    annualReviews: normalizeAnnualReviews(payload?.annualReviews),
    complianceChecks: normalizeComplianceChecks(payload?.complianceChecks),
  };
}

function dedupeInsurancePolicies(value: unknown[]) {
  const byKey = new Map<string, any>();
  for (const raw of value) {
    const policy = normalizeSectionPayload(raw);
    if (!isImportableInsurancePolicy(policy)) continue;
    const key = insurancePolicyDedupeKey(policy);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeInsurancePolicies(existing, policy) : policy);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    String(a.policySeriesKey ?? "").localeCompare(String(b.policySeriesKey ?? "")) ||
    String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")),
  );
}

function isImportableInsurancePolicy(policy: any) {
  const policyNumber = cleanText(policy?.policyNumber);
  const insurer = cleanText(policy?.insurer);
  const hasKnownPolicy = Boolean(policyNumber && policyNumber !== "Needs review");
  const hasKnownInsurer = Boolean(insurer && insurer !== "Needs review");
  const hasInsuranceEvidence = Boolean(
    policy?.coverageCents != null ||
    policy?.premiumCents != null ||
    policy?.coverageSummary ||
    arrayOf(policy?.coverageItems).length ||
    arrayOf(policy?.coveredParties).length ||
    arrayOf(policy?.sourceExternalIds).some((id) => /^local:|^paperless:/i.test(String(id))),
  );
  return (hasKnownPolicy || hasKnownInsurer) && hasInsuranceEvidence;
}

function insurancePolicyDedupeKey(policy: any) {
  return compactKey([
    cleanText(policy?.policySeriesKey) || insurancePolicySeriesKey(policy),
    cleanText(policy?.policyNumber),
    cleanDate(policy?.startDate),
    cleanDate(policy?.endDate),
    cleanText(policy?.kind),
  ]);
}

function insurancePolicySeriesKey(policy: any) {
  const kind = cleanText(policy?.kind) || "Other";
  const insurer = cleanText(policy?.insurer);
  const broker = cleanText(policy?.broker);
  const policyNumber = cleanText(policy?.policyNumber);
  if (kind === "GeneralLiability" && policyNumber && policyNumber !== "Needs review") {
    return compactKey(["cgl", insurer, broker, policyNumber]);
  }
  if (kind === "DirectorsOfficers") {
    return compactKey(["dno", insurer, broker, "management-liability"]);
  }
  return compactKey([kind, insurer, broker, policyNumber]);
}

function insurancePolicyTermLabel(policy: any) {
  const start = cleanDate(policy?.startDate);
  const end = cleanDate(policy?.endDate);
  if (start && end) return `${start.slice(0, 4)}-${end.slice(0, 4)}`;
  return start?.slice(0, 4) || cleanDate(policy?.renewalDate)?.slice(0, 4);
}


export {
  patchRecordImportTarget,
  patchRecordPromotionBlocked,
  importPromotionIssues,
  addressKey,
  compactKey,
  addIssue,
  patchSessionUpdatedAt,
  recordsFromBundle,
  makeRecord,
  transactionCandidateMappingNotes,
  mappingMatchesCandidate,
  normalizePayload,
  normalizeSourcePayload,
  normalizeMotionPayload,
  normalizeMeetingMinutesPayload,
  structuredMinutesPatchFromPayload,
  normalizeRemoteParticipationPayload,
  normalizeDetailedAttendancePayload,
  normalizeMinuteSectionsPayload,
  normalizeActionItemsPayload,
  normalizeMinutesActionItem,
  normalizeSessionSegmentsPayload,
  normalizeAppendicesPayload,
  normalizeAgmDetailsPayload,
  normalizeDirectorAppointmentsPayload,
  normalizeSpecialResolutionExhibitsPayload,
  normalizeBudgetPayload,
  normalizeSectionPayload,
  dedupeInsurancePolicies,
  isImportableInsurancePolicy,
  insurancePolicyDedupeKey,
  insurancePolicySeriesKey,
  insurancePolicyTermLabel,
};
