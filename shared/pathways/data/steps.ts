// Mirror of ComplianceContextKind in src/lib/compliance/rulePackSchema.ts, inlined to keep
// shared/ self-contained (shared modules should not depend on src/). Keep these in sync.
type ComplianceContextKind = "home" | "extra_provincial" | "branch" | "business_name";

/**
 * The ordered "what do I do now?" sequence a corporation follows after incorporating.
 * It is the connective tissue between Corporations Canada / CRA / provincial obligations,
 * the document packets that produce the paperwork, and the recurring compliance engine.
 *
 * Federal-first and modular, like the compliance rule packs and jurisdiction modules:
 * CA-FED-CBCA is the base flow; provinces/territories are added as their own flows (or
 * extra-provincial steps) over time. See CONTRIBUTING.md → "Adding a jurisdiction or
 * entity type". Statutory citations are DRAFT and must be checked against the current Act.
 */

export type PostIncorporationStepCategory = "organize" | "registration" | "good_standing";

/** one_time = do once after incorporating · recurring = every cycle · event_driven = when a change happens */
export type PostIncorporationStepCadence = "one_time" | "recurring" | "event_driven";

export type PostIncorporationStepAuthority = {
  /** Who you deal with, e.g. "Corporations Canada", "Canada Revenue Agency". */
  body: string;
  /** Draft statutory/citation reference. Verify against the current Act. */
  citation: string;
  /** Exact official government page for this step. */
  officialUrl: string;
};

export type PostIncorporationStepApplicability = {
  entityTypes: string[];
  homeJurisdictionCodes?: string[];
  contextKinds?: ComplianceContextKind[];
};

export type PostIncorporationStepObligationLink = {
  /** Filing kind produced by the compliance engine (see jurisdiction filingKinds). */
  filingKind?: string;
  /** Or a compliance obligationKey/ruleId fragment the step satisfies. */
  obligationKey?: string;
};

export type PostIncorporationStep = {
  key: string;
  /** 1-based position within its flow. Unique and contiguous per flow. */
  order: number;
  title: string;
  category: PostIncorporationStepCategory;
  cadence: PostIncorporationStepCadence;
  /** What the corporation must do. */
  summary: string;
  /** Human-readable deadline / timing copy. */
  timing: string;
  authority: PostIncorporationStepAuthority;
  appliesTo: PostIncorporationStepApplicability;
  /** Links to a CORPORATION_DOCUMENT_PACKETS key (the paperwork to generate). */
  packetKey?: string;
  /** Links to the recurring/event compliance obligation this step maps to. */
  obligation?: PostIncorporationStepObligationLink;
  caveat?: string;
};

export type PostIncorporationFlow = {
  jurisdictionCode: string;
  entityTypes: string[];
  status: "draft" | "reviewed" | "accepted";
  title: string;
  /** Official "overview" page the flow was derived from. */
  sourceUrl: string;
  steps: PostIncorporationStep[];
};

const CBCA = "Canada Business Corporations Act (CBCA)";
const CORPORATIONS_CANADA = "Corporations Canada";
const ISED = "https://ised-isde.canada.ca/site/corporations-canada/en";
const DRAFT_CITATION_CAVEAT = "Draft statutory citation — verify against the current CBCA before relying on it.";

const FEDERAL_CBCA_FLOW: PostIncorporationFlow = {
  jurisdictionCode: "CA-FED-CBCA",
  entityTypes: ["corporation__business_"],
  status: "draft",
  title: "Next steps after incorporating a federal business corporation",
  sourceUrl: `${ISED}/business-corporations/next-steps-following-incorporation-your-business`,
  steps: [
    {
      key: "appoint-first-directors",
      order: 1,
      title: "Confirm your first directors",
      category: "organize",
      cadence: "one_time",
      summary:
        "The directors named on the incorporation application (Form 2) hold office from the date on the certificate of incorporation until the first meeting of shareholders.",
      timing: "Effective from the certificate of incorporation date.",
      authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} s.106(2)`, officialUrl: `${ISED}/business-corporations/directors-and-officers` },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "organize-corporation",
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "hold-organizational-meeting",
      order: 2,
      title: "Hold the organizational meeting",
      category: "organize",
      cadence: "one_time",
      summary:
        "An incorporator or director calls an organizational meeting to make by-laws, appoint officers, authorize the issue of shares, and adopt banking and other initial resolutions.",
      timing: "Send notice at least 5 days before the meeting.",
      authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} s.104`, officialUrl: `${ISED}/business-corporations/next-steps-following-incorporation-your-business` },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "organize-corporation",
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "make-bylaws",
      order: 3,
      title: "Make by-laws",
      category: "organize",
      cadence: "one_time",
      summary:
        "Adopt the by-laws that govern the corporation's internal operations (financial year-end, banking, officer duties, meetings, quorum). Shareholders confirm them at the first meeting.",
      timing: "Adopt at organization; confirm at the first shareholders' meeting.",
      authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} s.103`, officialUrl: `${ISED}/business-corporations/model-laws-business-corporations` },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "organize-corporation",
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "issue-shares",
      order: 4,
      title: "Issue shares",
      category: "organize",
      cadence: "one_time",
      summary:
        "Issue shares in each shareholder's name and record them. A share cannot be issued until the corporation receives full consideration (payment).",
      timing: "After the corporation receives full consideration.",
      authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} s.25`, officialUrl: `${ISED}/business-corporations/share-structure-and-shareholders` },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "issue-shares",
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "appoint-officers",
      order: 5,
      title: "Appoint officers",
      category: "organize",
      cadence: "one_time",
      summary:
        "The directors appoint officers (e.g. president, secretary) responsible for day-to-day operations and confirm any signing authority.",
      timing: "At the organizational meeting.",
      authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} s.121`, officialUrl: `${ISED}/business-corporations/directors-and-officers` },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "appoint-officer",
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "set-up-minute-book",
      order: 6,
      title: "Set up the minute book and registers",
      category: "organize",
      cadence: "one_time",
      summary:
        "Create and maintain the corporate records: directors register, officers register, securities/transfer registers, and the register of individuals with significant control (ISC).",
      timing: "Maintain on an ongoing basis from organization.",
      authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} s.20 and s.21.1 (ISC register)`, officialUrl: `${ISED}/business-corporations/next-steps-following-incorporation-your-business` },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "organize-corporation",
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "hold-first-shareholders-meeting",
      order: 7,
      title: "Hold the first shareholders' meeting",
      category: "organize",
      cadence: "one_time",
      summary:
        "Shareholders elect directors, confirm/modify/reject the by-laws, and appoint (or waive) an auditor.",
      timing: "Within 18 months of the incorporation date.",
      authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} s.133(1)(a)`, officialUrl: `${ISED}/business-corporations/next-steps-following-incorporation-your-business` },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "annual-resolutions",
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "get-business-number-cra-accounts",
      order: 8,
      title: "Verify BN and RC receipt; assess other CRA accounts",
      category: "registration",
      cadence: "one_time",
      summary:
        "Participating federal business incorporations receive a business number (BN) and corporation income tax (RC) account automatically. Verify the receipt and identifiers before requesting a new account. Assess GST/HST and payroll separately. The registry annual return and CRA tax return are separate filings.",
      timing: "Before you charge tax, remit payroll, or file your first T2.",
      authority: {
        body: "Canada Revenue Agency",
        citation: "CRA business number and program accounts",
        officialUrl:
          "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/registering-your-business/business-number.html",
      },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      caveat: "Which CRA accounts you need depends on your activities (employees, taxable supplies, etc.).",
    },
    {
      key: "register-extra-provincially",
      order: 9,
      title: "Register in each province or territory where you operate",
      category: "registration",
      cadence: "event_driven",
      summary:
        "Assess whether the corporation carries on business in each province or territory under that jurisdiction's law. Record business commencement separately from registration, and confirm any agent-for-service requirement.",
      timing: "Check the destination jurisdiction's trigger and deadline; BC company registration is due within two months of beginning to carry on business.",
      authority: {
        body: "Provincial and territorial registries",
        citation: "Provincial/territorial extra-provincial registration legislation",
        officialUrl: `${ISED}/register-federal-corporation-province-or-territory`,
      },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["extra_provincial"] },
      packetKey: "extra-provincial-registration-evidence",
      caveat: "Ontario, Nova Scotia, and Newfoundland & Labrador may register during incorporation — verify with the province.",
    },
    {
      key: "file-annual-return",
      order: 10,
      title: "File your annual return",
      category: "good_standing",
      cadence: "recurring",
      summary:
        "File the Corporations Canada annual return to keep the corporation in good standing. This is separate from your CRA corporate tax return.",
      timing: "Every year within 60 days of the anniversary date (not required in the incorporation year).",
      authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} s.263`, officialUrl: `${ISED}/keep-your-corporation-good-shape/annual-return` },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "annual-resolutions",
      obligation: { filingKind: "FederalAnnualReturn" },
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "file-isc-information",
      order: 11,
      title: "File your ISC information and keep it current",
      category: "good_standing",
      cadence: "recurring",
      summary:
        "File information on individuals with significant control with your annual return, and report changes to the ISC register to Corporations Canada within 15 days.",
      timing: "With the annual return; changes within 15 days.",
      authority: {
        body: CORPORATIONS_CANADA,
        citation: `${CBCA} s.21.1 and s.21.21`,
        officialUrl: `${ISED}/individuals-significant-control/individuals-significant-control-file-your-information`,
      },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "isc-register-update",
      obligation: { filingKind: "FederalIscUpdate" },
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "report-director-changes",
      order: 12,
      title: "Report changes to directors",
      category: "good_standing",
      cadence: "event_driven",
      summary:
        "Notify Corporations Canada when directors are elected or cease to hold office, or when a director's address changes.",
      timing: "Within 15 days of the change.",
      authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} s.113`, officialUrl: `${ISED}/business-corporations/directors-and-officers` },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      packetKey: "appoint-director",
      obligation: { filingKind: "FederalDirectorChange" },
      caveat: DRAFT_CITATION_CAVEAT,
    },
    {
      key: "report-registered-office-change",
      order: 13,
      title: "Report a change of registered office address",
      category: "good_standing",
      cadence: "event_driven",
      summary:
        "Notify Corporations Canada if the registered office moves within the same province/territory; amend the articles if it moves to another province/territory.",
      timing: "Within 15 days of the change.",
      authority: {
        body: CORPORATIONS_CANADA,
        citation: `${CBCA} s.19`,
        officialUrl: `${ISED}/business-corporations/changing-structure-or-nature-business-corporation`,
      },
      appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] },
      obligation: { filingKind: "FederalRegisteredOfficeChange" },
      caveat: DRAFT_CITATION_CAVEAT,
    },
  ],
};

const BC_SOCIETY_FLOW: PostIncorporationFlow = {
  jurisdictionCode: "CA-BC", entityTypes: ["society"], status: "draft",
  title: "BC society preparation and organization", sourceUrl: "https://www2.gov.bc.ca/gov/content/employment-business/business/not-for-profit-organizations/societies/incorporate",
  steps: [
    { key: "society-constitution-bylaws", title: "Confirm constitution, bylaws and society classification", summary: "Prepare a constitution with the name and lawful purposes, plus bylaws. A member-funded society needs the prescribed constitution statement and an eligibility assessment; charity status is separate.", timing: "Before submitting the incorporation application.", category: "organize", cadence: "one_time", citation: "Societies Act ss. 10–11; member-funded societies Part 12", packetKey: "society-incorporation-constitution" },
    { key: "society-prepare-bylaws", title: "Prepare and review society bylaws", summary: "Draft membership, meeting, director, financial and records rules for the intended society. This worksheet is original guidance; use official originals when choosing prescribed model wording.", timing: "Before incorporation submission and adoption of the complete bylaws.", category: "organize", cadence: "one_time", citation: "Societies Act ss. 11–12", packetKey: "society-incorporation-bylaws" },
    { key: "society-confirm-directors", title: "Confirm eligible directors and registered office", summary: "An ordinary society needs at least three directors, including at least one ordinarily resident in BC. A member-funded society needs at least one director and is exempt from that residency requirement. Confirm director eligibility and consent.", timing: "Before incorporation; maintain current information thereafter.", category: "organize", cadence: "one_time", citation: "Societies Act ss. 40–44 and Part 12", packetKey: "society-appoint-directors" },
    { key: "society-official-incorporation-evidence", title: "File through the official registry and retain evidence", summary: "Review the application and submit through Societies Online. Retain the registry certificate, certified constitution and bylaws, statement of directors and registered office, and confirmation. A prepared application is not accepted incorporation evidence.", timing: "On acceptance by the registrar.", category: "registration", cadence: "one_time", citation: "Societies Act incorporation provisions" },
    { key: "society-records", title: "Set up the society records and access controls", summary: "Keep constitution, bylaws, member and director registers, minutes, resolutions, financial records and registry evidence. Confirm the records location and appropriate access restrictions.", timing: "From incorporation, with ongoing updates.", category: "organize", cadence: "one_time", citation: "Societies Act ss. 20–24", packetKey: "society-directors-resolution" },
    { key: "society-tax-assessment", title: "Assess CRA accounts and charitable registration separately", summary: "Assess business number, GST/HST, payroll and any information or income-tax filing obligations for the society's activities. CRA charitable registration requires its own application and approval; incorporation does not establish it.", timing: "Before the relevant tax or payroll activity.", category: "registration", cadence: "one_time", citation: "CRA business registration and charities guidance" },
    { key: "society-agm-annual-report", title: "Hold the AGM and file the annual report", summary: "Track the AGM reporting year, any registrar-approved extension and its evidence. File the annual report within 30 days after the AGM; incorporation-year and extension rules need their own assessment.", timing: "AGM each calendar year after the incorporation year, subject to applicable extension; report within 30 days after AGM.", category: "good_standing", cadence: "recurring", citation: "Societies Act ss. 71 and 73", packetKey: "society-annual-general-meeting", filingKind: "BCSocietyAnnualReport" },
  ].map((step, index) => ({ ...step, order: index + 1, category: step.category as PostIncorporationStepCategory, cadence: step.cadence as PostIncorporationStepCadence, authority: { body: "BC Registries", citation: step.citation, officialUrl: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01" }, appliesTo: { entityTypes: ["society"], homeJurisdictionCodes: ["CA-BC"], contextKinds: ["home"] }, obligation: step.filingKind ? { filingKind: step.filingKind } : undefined })),
};
const BC_COMPANY_FLOW: PostIncorporationFlow = {
  jurisdictionCode: "CA-BC", entityTypes: ["corporation__business_"], status: "draft",
  title: "BC ordinary private company preparation and organization", sourceUrl: "https://www2.gov.bc.ca/gov/content/employment-business/business/managing-a-business/permits-licences/businesses-incorporated-companies/incorporated-companies",
  steps: [
    { key: "bc-incorporation-agreement-articles", title: "Prepare the incorporation agreement and articles", summary: "Each incorporator signs an incorporation agreement and takes at least one share. Prepare articles and the notice of articles, confirm the share structure and keep the signed agreement and articles in the records office. ULC, CCC and benefit companies require specialist review.", timing: "Before submitting the incorporation application.", category: "organize", cadence: "one_time", citation: "Business Corporations Act ss. 10–12", packetKey: "bc-incorporation-agreement" },
    { key: "bc-prepare-articles", title: "Draft and review articles and the notice of articles", summary: "Complete the share-rights schedule and governance clauses, reconcile them with the incorporation agreement and notice of articles, and resolve all drafting prompts before execution.", timing: "Before submitting the application.", category: "organize", cadence: "one_time", citation: "Business Corporations Act ss. 10–12", packetKey: "bc-articles-preparation" },
    { key: "bc-confirm-directors-offices", title: "Confirm eligible directors and BC offices", summary: "An ordinary private BC company needs at least one director; there is no general director residency requirement. Confirm eligibility, written consent, and registered and records office addresses in BC.", timing: "Before incorporation and whenever details change.", category: "organize", cadence: "one_time", citation: "Business Corporations Act ss. 34–35, 120–123", packetKey: "appoint-director" },
    { key: "bc-official-incorporation-evidence", title: "Submit the application and retain official incorporation evidence", summary: "Use the official BC registry workflow. Keep the certificate, certified notice of articles and filing confirmation. Drafts and signed internal documents do not establish registry acceptance.", timing: "Upon registrar acceptance.", category: "registration", cadence: "one_time", citation: "Business Corporations Act incorporation provisions" },
    { key: "bc-organize-records", title: "Organize directors, officers, share issues and records", summary: "Adopt initial resolutions, appoint officers, authorize share issues and record the consideration. Set up corporate registers, accounting records and the transparency register where applicable.", timing: "After incorporation; update records as events occur.", category: "organize", cadence: "one_time", citation: "Business Corporations Act ss. 42, 54 and Part 4.1", packetKey: "organize-corporation" },
    { key: "bc-confirm-cra-accounts", title: "Verify BN and RC receipt and assess GST/HST and payroll", summary: "Participating BC business incorporations receive BN and RC accounts automatically. Confirm receipt and record identifiers before seeking another account. Assess GST/HST and payroll registration independently.", timing: "After incorporation and before relevant business activity.", category: "registration", cadence: "one_time", citation: "CRA corporation income tax program account guidance" },
    { key: "bc-company-annual-report", title: "Track the annual report separately from the AGM", summary: "The company annual report uses the incorporation anniversary. AGM or unanimous-resolution obligations use the annual reference date and prior meeting history; the two dates are separate.", timing: "Annual report within two months after the incorporation anniversary; first AGM within 18 months, then assess annual reference date and 15-month limits.", category: "good_standing", cadence: "recurring", citation: "Business Corporations Act ss. 182 and 230", filingKind: "BCCompanyAnnualReport" },
  ].map((step, index) => ({ ...step, order: index + 1, category: step.category as PostIncorporationStepCategory, cadence: step.cadence as PostIncorporationStepCadence, authority: { body: "BC Registries", citation: step.citation, officialUrl: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00" }, appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-BC"], contextKinds: ["home"] }, obligation: step.filingKind ? { filingKind: step.filingKind } : undefined })),
};
FEDERAL_CBCA_FLOW.steps = [{
  key: "prepare-federal-articles", order: 1, title: "Prepare and review federal incorporation articles", category: "organize", cadence: "one_time",
  summary: "Complete the proposed name, office province, share classes and rights, transfer restrictions, director number and other provisions in an original worksheet. Review the articles and enter them into the official federal application; a worksheet does not establish incorporation.",
  timing: "Before submitting the incorporation application.", authority: { body: CORPORATIONS_CANADA, citation: `${CBCA} ss. 5–8`, officialUrl: `${ISED}/business-corporations/how-incorporate-business` },
  appliesTo: { entityTypes: ["corporation__business_"], homeJurisdictionCodes: ["CA-FED-CBCA"], contextKinds: ["home"] }, packetKey: "federal-articles-preparation",
}, ...FEDERAL_CBCA_FLOW.steps.map((step) => ({ ...step, order: step.order + 1 }))];
export const POST_INCORPORATION_FLOWS: PostIncorporationFlow[] = [FEDERAL_CBCA_FLOW, BC_SOCIETY_FLOW, BC_COMPANY_FLOW];
