type OptionSetName =
  | "entityTypes"
  | "entityJurisdictions"
  | "actsFormedUnder"
  | "addressTypes"
  | "addressStatuses"
  | "eventTypes"
  | "eventStatuses"
  | "documentTags"
  | "taxNumberTypes"
  | "companyKeyTypes"
  | "permissionLevels"
  | "signerStatuses"
  | "filingTypes"
  | "officerTitles"
  | "directorTerms"
  | "citizenshipResidencies"
  | "representativeTypes"
  | "requiredSigners"
  | "organizationStatuses"
  | "registrationStatuses"
  | "identifierStatuses"
  | "accessLevels"
  | "policyStatuses"
  | "workflowPackageStatuses"
  | "minuteBookRecordTypes"
  | "minuteBookStatuses"
  | "roleHolderStatuses"
  | "rightsClassTypes"
  | "rightsClassStatuses"
  | "rightsholdingTransferTypes"
  | "rightsholdingTransferStatuses"
  | "templateTypes"
  | "templateStatuses"
  | "precedentStatuses"
  | "precedentRunStatuses"
  | "generatedDocumentStatuses"
  | "formationStatuses"
  | "amendmentStatuses"
  | "annualMaintenanceStatuses"
  | "annualFinancialStatementOptions"
  | "currencies"
  | "logTypes"
  | "logSeverities"
  | "partTypes"
  | "documentTypes"
  | "suffixCompanyNames";

export const SOURCE_OPTION_VALUES: Record<OptionSetName, string[]> = {
  entityTypes: ["corporation__nfp_", "society"],
  entityJurisdictions: [
    "federal__canada_",
    "ontario",
    "british_columbia",
    "alberta",
    "saskatchewan",
    "newfoundland_and_labrador",
    "nova_scotia",
    "prince_edward_island",
    "new_brunswick",
    "quebec",
    "manitoba",
    "nunavut",
    "north_west_territories",
    "yukon",
    "foreign",
    "CA-BC",
  ],
  actsFormedUnder: [
    "canada_not_for_profit_corporations_act",
    "not_for_profit_corporations_act__2010__ontario_",
    "corporations_act__ontario_",
    "companies_act__new_brunswick_",
    "non_profit_corporations_act__saskatchewan_",
    "societies_act",
    "companies_act__alberta_",
    "the_corporations_act__manitoba_",
    "business_corporations_act__quebec_",
    "societies_act__nova_scotia_",
    "companies_act__prince_edward_island_",
    "corporations_act__newfoundland_",
    "societies_act__yukon_",
    "societies_act__northwest_territories_",
    "societies_act__nunavut_",
    "foreign",
    "companies_act__quebec_",
    "societies_act__alberta_",
  ],
  addressTypes: ["registered_office", "registered_mailing", "records_office", "records_mailing", "mailing", "physical", "other"],
  addressStatuses: ["current", "proposed", "past"],
  eventTypes: [
    "incorporation0",
    "extra_provincial_registration0",
    "annual_maintenance",
    "annual_filing",
    "change_director",
    "officer_change",
    "address_change",
    "transparency_register_change",
    "share_transfer__internal_only_",
    "share_issuance_additional",
    "dividend",
    "management_bonus",
    "organizing_post_incorporation",
    "clean_up__no_minute_book_",
    "digitize_minute_book",
    "custom",
    "custom.event",
  ],
  eventStatuses: ["initial", "step_1", "step_2", "2b", "step_3", "step_4", "5_", "6_", "7_", "8_", "9_", "step_5", "100_"],
  documentTags: [
    "0___corporate_summary_sheet",
    "1___incorporation_documents",
    "2___business_numbers",
    "charitable_status_documents",
    "3___by_laws",
    "members_meetings_and_resolutions0",
    "5___directors_meetings_and_resolutions",
    "sub_committee_records",
    "director_consents__resignations__and_indemnifications",
    "officer_consents__resignations__and_indemnifications",
    "members_register0",
    "9___transfer_register",
    "6___directors_register_and_consents",
    "7___officers_register_and_consents",
    "member_applications_and_resignations",
    "corporate_profile_reports",
    "12___shareholder_agreements",
    "13___annual_return_filings",
    "debt_obligations",
    "13___material_agreements",
    "extra_provincial_registrations",
    "tax_numbers",
    "16___electronic_signing_records",
    "other",
    "company_keys",
    "paper_minute_book_archive",
  ],
  taxNumberTypes: ["business_number", "income_tax", "sales_tax", "import___export", "payroll_tax", "charity_number", "registry_account", "gst", "payroll", "other"],
  companyKeyTypes: ["company_key", "password__bc_", "access_code"],
  permissionLevels: ["entity_administrator", "entity_editor", "entity_viewer"],
  signerStatuses: ["unsigned", "opened_package", "all_signed", "signed", "declined", "needs_review"],
  filingTypes: ["annual", "notice_of_change", "formation"],
  officerTitles: [
    "assistant_secretary",
    "assistant_treasurer",
    "authorized_signing_officer",
    "chair",
    "chairman",
    "chair_person",
    "chairwoman",
    "chief_administrative_officer",
    "chief_executive_officer",
    "chief_financial_officer",
    "chief_information_officer",
    "chief_manager",
    "chief_operating_officer",
    "comptroller",
    "executive_director",
    "general_manager",
    "managing_director",
    "other",
    "president",
    "secretary",
    "secretary_treasurer",
    "treasurer",
    "vice_chair",
    "vice_president",
  ],
  directorTerms: ["none_specified", "until_the_next_annual_general_meeting", "1_year", "2_years", "3_years", "4_years", "5_years", "other"],
  citizenshipResidencies: [
    "a_canadian_citizen_ordinarily_resident_in_canada",
    "a_permanent_resident_within_the_meaning_of_the_immigration_and_refugee_protection_act__canada__and_ordinarily_resides_in_canada",
    "not_a_canadian_citizen_and_not_a_permanent_resident_in_canada__as_defined_above_",
    "a_canadian_citizen_that_meets_the_test_in_schedule_a",
    "a_canadian_citizen_that_is_not_ordinarily_resident_in_canada_and_who_does_not_meet_the_qualifications_set_out_in_schedule_a",
  ],
  representativeTypes: [
    "officer",
    "director",
    "member",
    "shareholder_representative",
    "trustee",
    "incorporator",
    "attorney_for_service",
    "chief_officer___manager",
    "authorized_contact_person",
    "authorized_representative",
    "treasury",
  ],
  requiredSigners: [
    "all_voting_members",
    "all_members",
    "select_members",
    "member___exiting",
    "all_directors",
    "directors___exiting",
    "directors___entering",
    "officer___entering",
    "officer___exiting",
    "officer___president",
    "shareholder___entering",
    "transfer_participants",
  ],
  organizationStatuses: ["active", "archived", "removed", "needs_review"],
  registrationStatuses: ["active", "inactive", "pending", "needs_review"],
  identifierStatuses: ["active", "inactive", "needs_review"],
  accessLevels: ["internal", "restricted"],
  policyStatuses: ["Draft", "Active", "ReviewDue", "Superseded", "Ceased"],
  workflowPackageStatuses: ["draft", "collecting_signatures", "ready", "filed", "cancelled", "archived", "initial", "step_1", "step_2", "2b", "step_3", "step_4", "5_", "6_", "7_", "8_", "9_", "step_5", "100_"],
  minuteBookRecordTypes: [
    "constitution",
    "bylaws",
    "minutes",
    "resolution",
    "filing",
    "policy",
    "ledger",
    "document",
    "package",
    "financial_statement",
    "workflow_package_document",
    "paper_minute_book_archive",
    "minute_book_record",
    "imported_record",
    "other",
  ],
  minuteBookStatuses: ["Draft", "Current", "NeedsReview", "Archived", "Superseded"],
  roleHolderStatuses: ["current", "proposed", "former", "needs_review"],
  rightsClassTypes: ["membership", "voting", "non_voting", "unit", "share", "other"],
  rightsClassStatuses: ["active", "proposed", "inactive", "needs_review"],
  rightsholdingTransferTypes: ["issuance", "transfer", "redemption", "cancellation", "adjustment", "other"],
  rightsholdingTransferStatuses: ["draft", "posted", "void", "needs_review"],
  templateTypes: ["document", "policy", "filing", "search", "registration", "purpose", "vertical", "other"],
  templateStatuses: ["active", "draft", "archived", "needs_review"],
  precedentStatuses: ["active", "draft", "archived", "needs_review"],
  precedentRunStatuses: ["draft", "data_review", "generating", "signing", "complete", "cancelled", "needs_review"],
  generatedDocumentStatuses: ["draft", "out_for_signing", "signed", "final", "void", "needs_review"],
  formationStatuses: ["draft", "name_search", "filing", "organizing", "complete", "cancelled", "needs_review"],
  amendmentStatuses: ["draft", "approved", "filed", "needs_review"],
  annualMaintenanceStatuses: ["draft", "ready", "filed", "processed", "needs_review"],
  annualFinancialStatementOptions: [
    "audit",
    "review_engagement",
    "compilation",
    "internally_prepared",
    "waived",
    "not_required",
    "other",
  ],
  currencies: ["cad", "usd", "eur"],
  logTypes: [
    "checkout_started",
    "payment_received",
    "out_for_signing",
    "signed",
    "filing_submitted",
    "filing_completed",
    "closed",
    "logged_in",
    "logged_out",
    "help_request",
    "created_user",
    "deleted_user",
    "created_entity",
    "deleted_entity",
    "created_incorporation",
    "deleted_incorporation",
    "created_event",
    "deleted_event",
    "created_part",
    "deleted_part",
    "frontend_error",
    "backend_error",
    "edit",
  ],
  logSeverities: ["info", "warning", "error", "critical"],
  partTypes: ["filing", "search", "registration", "policy", "document", "event", "other"],
  documentTypes: ["docx", "pdf", "html", "draft", "signed", "processed", "other"],
  suffixCompanyNames: [
    "society",
    "association",
    "foundation",
    "club",
    "centre",
    "canada_inc",
    "inc",
    "corp",
    "ltd",
    "other",
  ],
};

export function isAllowedOption(setName: OptionSetName, value: unknown) {
  const text = cleanText(value);
  if (!text) return false;
  return SOURCE_OPTION_VALUES[setName].includes(text);
}

export function assertAllowedOption(setName: OptionSetName, value: unknown, label: string, optional = true) {
  const text = cleanText(value);
  if (!text && optional) return;
  if (text && isAllowedOption(setName, text)) return;
  throw new Error(`${label} must be one of the configured OrgHub/Societyer options.`);
}

export function invalidOptionIssue(setName: OptionSetName, value: unknown, label: string, optional = true) {
  const text = cleanText(value);
  if (!text && optional) return undefined;
  return text && isAllowedOption(setName, text) ? undefined : `${label} is not in the configured OrgHub/Societyer options.`;
}

export function invalidOptionListIssues(setName: OptionSetName, values: unknown, label: string) {
  const rows = Array.isArray(values) ? values : [];
  const invalid = rows.map(cleanText).filter(Boolean).filter((value) => !isAllowedOption(setName, value));
  return invalid.length ? [`${label} includes unsupported options: ${invalid.join(", ")}.`] : [];
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
