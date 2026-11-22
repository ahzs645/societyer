import type { LegalEntityLike } from "./organizationDomain";
import { resolvePathway, PATHWAY_LEGAL_SUBTYPE_OPTIONS } from "./pathways/registry";

export const FORMATION_STATUS_OPTIONS = [
  { value: "", label: "Unverified legacy record — status not established" },
  { value: "preparing", label: "Preparing incorporation" },
  { value: "unverified_existing", label: "Existing incorporated entity — certificate evidence pending" },
  { value: "submitted", label: "Submitted — awaiting registry acceptance" },
  { value: "incorporated", label: "Incorporated — certificate evidence verified" },
];
export const LEGAL_SUBTYPE_OPTIONS = PATHWAY_LEGAL_SUBTYPE_OPTIONS;
export const TAX_STATUS_OPTIONS = [
  { value: "unknown", label: "Not checked yet" },
  { value: "not_required", label: "Not needed" },
  { value: "pending", label: "Applied, waiting" },
  { value: "confirmed", label: "Registered" },
];
export const CHARITY_STATUS_OPTIONS = [
  { value: "unknown", label: "Unknown / not assessed" },
  { value: "not_applied", label: "Not applied" },
  { value: "application_pending", label: "Application pending" },
  { value: "registered", label: "Registered — CRA approval received" },
  { value: "revoked", label: "Revoked / no longer registered" },
];
export const ENTITY_DATE_FIELDS = [
  { value: "anniversaryDate", label: "Registry anniversary date" },
  { value: "annualReferenceDate", label: "BC company annual reference date" },
  { value: "annualMeetingDate", label: "Last AGM / annual meeting date" },
  { value: "agmExtensionDate", label: "AGM extension deadline" },
  { value: "iscAwarenessDate", label: "ISC change awareness date" },
  { value: "iscRegisterEntryDate", label: "ISC register entry date" },
  { value: "transparencyAwarenessDate", label: "BC transparency change awareness date" },
  { value: "transparencyEntryDate", label: "BC transparency register entry date" },
  { value: "transparencyCessationEntryDate", label: "BC transparency cessation entry date" },
];
export const ENTITY_SETUP_STRING_FIELDS = ["formationStatus", "certificateReference", "certificateDate", "legalSubtype", "craBnStatus", "craRcStatus", "gstHstStatus", "payrollStatus", "charityStatus", "taxStatusEvidence", "annualReferenceDate", "annualMeetingDate", "agmExtensionDate", "agmExtensionEvidence", "iscAwarenessDate", "iscRegisterEntryDate", "transparencyAwarenessDate", "transparencyEntryDate", "transparencyCessationEntryDate"] as const;
export const ENTITY_SETUP_FIELDS = [...ENTITY_SETUP_STRING_FIELDS, "certificateEvidenceDocumentId", "annualMeetingYear"] as const;
export function entitySetupFields(source: Record<string, any>) {
  return Object.fromEntries(ENTITY_SETUP_FIELDS.map((key) => [key, source[key]]));
}

/** Legacy flags are claims, not registration evidence. Reject contradictory
 * claims on a new save while leaving old records readable for explicit review. */
export function charityStatusConflict(source: { isCharity?: unknown; charityStatus?: unknown }): string | undefined {
  if (source.charityStatus === "registered" && source.isCharity === false) {
    return "Charity status says registered, but the charity flag says no. Resolve both fields together; registration evidence is recorded separately.";
  }
  if (source.isCharity === true && ["not_applied", "application_pending", "revoked"].includes(String(source.charityStatus))) {
    return "The charity flag conflicts with the recorded charity status. Resolve both fields together; a pending application does not establish registration.";
  }
  return undefined;
}

export function validateEntitySetup(source: Record<string, any>) {
  const choices: Record<string, readonly { value: string }[]> = {
    formationStatus: FORMATION_STATUS_OPTIONS,
    legalSubtype: LEGAL_SUBTYPE_OPTIONS,
    craBnStatus: TAX_STATUS_OPTIONS, craRcStatus: TAX_STATUS_OPTIONS,
    gstHstStatus: TAX_STATUS_OPTIONS, payrollStatus: TAX_STATUS_OPTIONS,
    charityStatus: CHARITY_STATUS_OPTIONS,
  };
  for (const [key, options] of Object.entries(choices)) {
    if (source[key] && !options.some((option) => option.value === source[key])) throw new Error(`Invalid ${key} option.`);
  }
  // Fiscal year end is a month-day ("03-31"); an impossible value such as
  // "13-45" silently dropped computed obligations (G-20).
  if (source.fiscalYearEnd && !isValidFiscalYearEnd(source.fiscalYearEnd)) throw new Error("Fiscal year end must be a valid month and day (MM-DD), for example 03-31.");
  if (source.annualMeetingYear !== undefined && (!Number.isInteger(source.annualMeetingYear) || source.annualMeetingYear < 1900 || source.annualMeetingYear > 9999)) throw new Error("AGM reporting year must be a four-digit year.");
  for (const { value } of [...ENTITY_DATE_FIELDS, { value: "certificateDate" }]) {
    if (source[value] && (!/^\d{4}-\d{2}-\d{2}$/.test(source[value]) || Number.isNaN(Date.parse(source[value])) || new Date(source[value]).toISOString().slice(0, 10) !== source[value])) throw new Error(`${value} must be a valid YYYY-MM-DD date.`);
  }
  const charityConflict = charityStatusConflict(source);
  if (charityConflict) throw new Error(charityConflict);
  if ((source.legalSubtype === "member_funded_society" || source.isMemberFunded) && (source.isCharity || source.charityStatus === "registered")) throw new Error("A BC member-funded society cannot be a registered charity. Review the classification.");
}
export function entityPreparationDecision(organization?: (LegalEntityLike & Record<string, any>) | null) {
  const { allowed, message } = resolvePathway(organization);
  return { allowed, message };
}

/** A document Societyer generated (a packet draft or legal-document template), not one the registry issued. */
export function isGeneratedLegalDocument(document: { importRecordKind?: unknown; sourceExternalIds?: unknown }): boolean {
  const markers = Array.isArray(document.sourceExternalIds) ? document.sourceExternalIds.map(String) : [];
  return document.importRecordKind === "generated_legal_document" || markers.some((marker) => marker.includes("packet-draft") || marker.includes("generated-legal-document"));
}

/** A document whose template provenance says it is still a draft. */
export function hasDraftTemplateProvenance(document: { sourcePayloadJson?: unknown }): boolean {
  try {
    const payload: unknown = JSON.parse(typeof document.sourcePayloadJson === "string" ? document.sourcePayloadJson : "{}");
    const provenance = payload && typeof payload === "object" ? (payload as { templateProvenance?: { documentState?: unknown } }).templateProvenance : undefined;
    return provenance?.documentState === "draft";
  } catch {
    return false;
  }
}

/** True for a document that can't stand as an official registry copy: generated, a draft, archived or flagged for deletion. */
export function isUnofficialDocument(document: { importRecordKind?: unknown; sourceExternalIds?: unknown; sourcePayloadJson?: unknown; archivedAtISO?: unknown; flaggedForDeletion?: unknown }): boolean {
  return Boolean(document.flaggedForDeletion || document.archivedAtISO) || isGeneratedLegalDocument(document) || hasDraftTemplateProvenance(document);
}

/** The user verifies the official certificate; generated drafts and URL-only records are insufficient evidence. */
export function validateFormationEvidence(source: Record<string, any>, societyId?: string, document?: Record<string, any> | null, versions: Record<string, any>[] = []) {
  if (source.certificateEvidenceDocumentId && (!societyId || !document || String(document._id) !== String(source.certificateEvidenceDocumentId) || String(document.societyId) !== String(societyId))) throw new Error("Certificate documents not found in this organization.");
  if (source.formationStatus !== "incorporated") return;
  if (!source.certificateEvidenceDocumentId || !source.certificateReference?.trim() || !source.certificateDate) throw new Error("Verified incorporation requires an uploaded certificate document, official certificate reference and actual certificate date.");
  if (!societyId || !document || String(document._id) !== String(source.certificateEvidenceDocumentId) || String(document.societyId) !== String(societyId)) throw new Error("Certificate documents not found in this organization.");
  if (document.flaggedForDeletion || document.archivedAtISO || isGeneratedLegalDocument(document)) throw new Error("A generated draft or unavailable document cannot establish verified incorporation. Upload the official certificate.");
  if (hasDraftTemplateProvenance(document)) throw new Error("A generated draft cannot establish verified incorporation. Upload the official certificate.");
  const uploadedVersion = versions.some((version) => String(version.documentId) === String(document._id) && String(version.societyId) === String(societyId) && version.storageKey && version.fileName && !["generated-inline", "demo"].includes(version.storageProvider) && version.storageProvider && !String(version.storageKey).startsWith("demo://"));
  if (!document.storageId && !uploadedVersion) throw new Error("Certificate verification requires an uploaded file. A note, planned date or URL-only document is insufficient.");
}


/** Replace an implicitly copied planned anniversary when certificate evidence establishes the actual date. */
export function certificateAnniversaryDate(previous: Record<string, any>, formation: Record<string, any>): string | undefined {
  if (formation.formationStatus !== "incorporated") return formation.anniversaryDate ?? formation.incorporationDate;
  if (!formation.continuanceDate && !formation.amalgamationDate && (!formation.anniversaryDate || (previous.formationStatus !== "incorporated" && formation.anniversaryDate === previous.incorporationDate))) return formation.certificateDate;
  return formation.anniversaryDate ?? formation.certificateDate;
}

/**
 * The workspace status that follows a formation status. Preparing or submitted
 * work is pre-incorporation; a verified or existing incorporation makes a blank
 * or pre-incorporation workspace active. Any other status (archived, removed,
 * needs review) stays as it is.
 */
export function organizationStatusForFormation(formationStatus: string | undefined, current: string | undefined): string | undefined {
  if (formationStatus === "preparing" || formationStatus === "submitted") return "pre_incorporation";
  if ((formationStatus === "incorporated" || formationStatus === "unverified_existing") && (!current || current === "pre_incorporation")) return "active";
  return current;
}

/** Director limits from the filed articles: whole numbers of at least one, minimum no more than maximum. */
export function validateArticlesProvisions(source: { articlesMinDirectors?: unknown; articlesMaxDirectors?: unknown }) {
  const limits = [["articlesMinDirectors", "Minimum number of directors"], ["articlesMaxDirectors", "Maximum number of directors"]] as const;
  for (const [key, label] of limits) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1000) throw new Error(`${label} must be a whole number of at least 1.`);
  }
  const min = source.articlesMinDirectors;
  const max = source.articlesMaxDirectors;
  if (typeof min === "number" && typeof max === "number" && min > max) throw new Error("The minimum number of directors can't be more than the maximum.");
}

/** "MM-DD" (or a full YYYY-MM-DD) naming a real calendar day; Feb 29 is allowed. */
export function isValidFiscalYearEnd(value: unknown): boolean {
  const text = String(value ?? "").trim();
  const monthDay = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(5) : text;
  const match = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(2000, month, 0)).getUTCDate();
}
