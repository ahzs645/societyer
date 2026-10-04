import { canonicalizeJurisdictionCode, homeJurisdictionCode, isSociety, type LegalEntityLike } from "./organizationDomain";

export const FORMATION_STATUS_OPTIONS = [
  { value: "", label: "Unverified legacy record — status not established" },
  { value: "preparing", label: "Preparing incorporation" },
  { value: "unverified_existing", label: "Existing incorporated entity — certificate evidence pending" },
  { value: "submitted", label: "Submitted — awaiting registry acceptance" },
  { value: "incorporated", label: "Incorporated — certificate evidence verified" },
];
export const LEGAL_SUBTYPE_OPTIONS = [
  { value: "ordinary_society", label: "BC ordinary society" },
  { value: "member_funded_society", label: "BC member-funded society" },
  { value: "ordinary_private_company", label: "BC ordinary private company" },
  { value: "unlimited_liability_company", label: "BC unlimited liability company — review required" },
  { value: "community_contribution_company", label: "BC community contribution company — review required" },
  { value: "benefit_company", label: "BC benefit company — review required" },
  { value: "federal_private_corporation", label: "Federal CBCA private business corporation" },
  { value: "other", label: "Other / classification needs review" },
];
export const TAX_STATUS_OPTIONS = [
  { value: "unknown", label: "Unknown / needs assessment" },
  { value: "not_required", label: "Assessed as not required" },
  { value: "pending", label: "Pending / awaiting receipt" },
  { value: "confirmed", label: "Confirmed — evidence received" },
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
  if (source.annualMeetingYear !== undefined && (!Number.isInteger(source.annualMeetingYear) || source.annualMeetingYear < 1900 || source.annualMeetingYear > 9999)) throw new Error("AGM reporting year must be a four-digit year.");
  for (const { value } of [...ENTITY_DATE_FIELDS, { value: "certificateDate" }]) {
    if (source[value] && (!/^\d{4}-\d{2}-\d{2}$/.test(source[value]) || Number.isNaN(Date.parse(source[value])) || new Date(source[value]).toISOString().slice(0, 10) !== source[value])) throw new Error(`${value} must be a valid YYYY-MM-DD date.`);
  }
  if ((source.legalSubtype === "member_funded_society" || source.isMemberFunded) && (source.isCharity || source.charityStatus === "registered")) throw new Error("A BC member-funded society cannot be a registered charity. Review the classification.");
}
export function entityPreparationDecision(organization?: (LegalEntityLike & Record<string, any>) | null) {
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  const subtype = organization?.legalSubtype;
  if (organization?.entityType === "corporation__nfp_" || String(organization?.actFormedUnder ?? "").includes("not_for_profit")) return { allowed: false, message: "Not-for-profit corporations need their own reviewed statutory route. Business corporation packets do not apply." };
  if (code === "CA-ON-OBCA") return { allowed: false, message: "Ontario preparation remains under review. Confirm the Ontario rules and document forms before using a packet." };
  if (["unlimited_liability_company", "community_contribution_company", "benefit_company", "other"].includes(subtype ?? "")) return { allowed: false, message: "This entity subtype needs a reviewed specialist route. Preserve source records and obtain subtype-specific review before preparing documents." };
  if (["ordinary_society", "member_funded_society"].includes(subtype ?? "") && (code !== "CA-BC" || !isSociety(organization))) return { allowed: false, message: "BC society classification does not match the recorded entity and jurisdiction. Review the organization profile." };
  if (subtype === "ordinary_private_company" && (code !== "CA-BC" || isSociety(organization))) return { allowed: false, message: "BC private company classification does not match the recorded entity and jurisdiction. Review the organization profile." };
  if (subtype === "federal_private_corporation" && (code !== "CA-FED-CBCA" || isSociety(organization))) return { allowed: false, message: "Federal CBCA classification does not match the recorded entity and jurisdiction. Review the organization profile." };
  if (code === "CA-FED-CBCA" && isSociety(organization)) return { allowed: false, message: "A society does not use the federal CBCA business corporation route. Review the entity and governing Act." };
  if (code === "CA-BC" && isSociety(organization)) return { allowed: true, message: organization?.isMemberFunded ? "BC member-funded society: verify eligibility and the required constitution statement. Incorporation and charity registration are separate." : "BC ordinary society: prepare constitution and bylaws, confirm directors, and retain the official incorporation evidence." };
  if (code === "CA-BC") return { allowed: true, message: "BC ordinary private company preparation. Confirm the articles, incorporation agreement and director eligibility; specialist company subtypes require review." };
  if (code === "CA-FED-CBCA") return { allowed: true, message: "Federal CBCA business corporation preparation. Registry acceptance, execution and CRA accounts require their own evidence." };
  return { allowed: false, message: "This jurisdiction has no reviewed preparation route. Retain the official source documents and arrange jurisdiction-specific review." };
}


/** The user verifies the official certificate; generated drafts and URL-only records are insufficient evidence. */
export function validateFormationEvidence(source: Record<string, any>, societyId?: string, document?: Record<string, any> | null, versions: Record<string, any>[] = []) {
  if (source.certificateEvidenceDocumentId && (!societyId || !document || String(document._id) !== String(source.certificateEvidenceDocumentId) || String(document.societyId) !== String(societyId))) throw new Error("Certificate documents not found in this organization.");
  if (source.formationStatus !== "incorporated") return;
  if (!source.certificateEvidenceDocumentId || !source.certificateReference?.trim() || !source.certificateDate) throw new Error("Verified incorporation requires an uploaded certificate document, official certificate reference and actual certificate date.");
  if (!societyId || !document || String(document._id) !== String(source.certificateEvidenceDocumentId) || String(document.societyId) !== String(societyId)) throw new Error("Certificate documents not found in this organization.");
  if (document.flaggedForDeletion || document.archivedAtISO || document.importRecordKind === "generated_legal_document" || (document.sourceExternalIds ?? []).some((marker: string) => marker.includes("packet-draft") || marker.includes("generated-legal-document"))) throw new Error("A generated draft or unavailable document cannot establish verified incorporation. Upload the official certificate.");
  let provenance: any;
  try { provenance = JSON.parse(document.sourcePayloadJson ?? "{}").templateProvenance; } catch { provenance = undefined; }
  if (provenance?.documentState === "draft") throw new Error("A generated draft cannot establish verified incorporation. Upload the official certificate.");
  const uploadedVersion = versions.some((version) => String(version.documentId) === String(document._id) && String(version.societyId) === String(societyId) && version.storageKey && version.fileName && !["generated-inline", "demo"].includes(version.storageProvider) && version.storageProvider && !String(version.storageKey).startsWith("demo://"));
  if (!document.storageId && !uploadedVersion) throw new Error("Certificate verification requires an uploaded file. A note, planned date or URL-only document is insufficient.");
}


/** Replace an implicitly copied planned anniversary when certificate evidence establishes the actual date. */
export function certificateAnniversaryDate(previous: Record<string, any>, formation: Record<string, any>): string | undefined {
  if (formation.formationStatus !== "incorporated") return formation.anniversaryDate ?? formation.incorporationDate;
  if (!formation.continuanceDate && !formation.amalgamationDate && (!formation.anniversaryDate || (previous.formationStatus !== "incorporated" && formation.anniversaryDate === previous.incorporationDate))) return formation.certificateDate;
  return formation.anniversaryDate ?? formation.certificateDate;
}
