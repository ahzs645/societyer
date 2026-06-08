import {
  canonicalizeJurisdictionCode,
  homeJurisdictionCode,
  organizationEntityType,
  type LegalEntityLike,
} from "./organizationDomain";

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
      title: "Get a business number and CRA accounts",
      category: "registration",
      cadence: "one_time",
      summary:
        "Register for a business number (BN) and the CRA program accounts you need: corporate income tax, GST/HST, and payroll. The annual return is not your tax return — corporate tax is filed with the CRA.",
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
        "Provincial/territorial law requires a federal corporation to register extra-provincially in each jurisdiction where it carries on business (an address, phone, or offering products/services there). Most jurisdictions require an attorney/agent for service.",
      timing: "Before carrying on business in the province or territory.",
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

export const POST_INCORPORATION_FLOWS: PostIncorporationFlow[] = [FEDERAL_CBCA_FLOW];

/** Find the post-incorporation flow for a jurisdiction code (canonicalized). */
export function findPostIncorporationFlow(jurisdictionCode?: string | null): PostIncorporationFlow | undefined {
  const code = canonicalizeJurisdictionCode(jurisdictionCode);
  return POST_INCORPORATION_FLOWS.find((flow) => flow.jurisdictionCode === code);
}

/** The ordered steps for an organization, filtered by its entity type. Empty if unsupported. */
export function postIncorporationStepsForOrganization(organization?: LegalEntityLike | null): PostIncorporationStep[] {
  const flow = findPostIncorporationFlow(homeJurisdictionCode(organization));
  if (!flow) return [];
  const entityType = organizationEntityType(organization);
  return flow.steps
    .filter((step) => step.appliesTo.entityTypes.includes(entityType))
    .slice()
    .sort((left, right) => left.order - right.order);
}

/** Steps grouped by category, preserving order — handy for a sectioned checklist UI. */
export function postIncorporationStepsByCategory(
  organization?: LegalEntityLike | null,
): Record<PostIncorporationStepCategory, PostIncorporationStep[]> {
  const grouped: Record<PostIncorporationStepCategory, PostIncorporationStep[]> = {
    organize: [],
    registration: [],
    good_standing: [],
  };
  for (const step of postIncorporationStepsForOrganization(organization)) {
    grouped[step.category].push(step);
  }
  return grouped;
}
