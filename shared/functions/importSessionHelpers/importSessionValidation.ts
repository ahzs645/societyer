// Import-session pre-promotion validation and issue collection.

import { invalidOptionIssue, invalidOptionListIssues } from "../../orgHubOptions";
import {
  cleanText,
  unique,
} from "./importSessionUtils";
import {
  normalizePayload,
} from "./importSessionNormalize";
import {
  confidenceFor,
} from "./importSessionRecordKinds";

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

export {
  importPromotionIssues,
  addressKey,
  compactKey,
  addIssue,
};
