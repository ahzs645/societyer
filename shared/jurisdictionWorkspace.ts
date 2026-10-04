import { canonicalizeJurisdictionCode, homeJurisdictionCode, isCorporation, type LegalEntityLike } from "./organizationDomain";

/**
 * The jurisdiction assumed when a workspace or legacy snapshot does not specify one.
 * Societyer began as a BC Societies Act tool, so historical/demo data defaults here.
 * Change this in one place to move the product's default (e.g. to federal CBCA).
 */
export const DEFAULT_HOME_JURISDICTION_CODE = "CA-BC";

export type JurisdictionWorkspaceDefaults = {
  entityType?: string;
  actFormedUnder?: string;
  isMemberFunded?: boolean;
};

export type RegistryOnboardingCopy = {
  label: string;
  nodeDescription: string;
  taskTitle: string;
  taskDescription: string;
};

export type FilingKindDefinition = {
  kind: string;
  label: string;
  registryUrl: string;
  checklist: string[];
  botSupported?: boolean;
};

export type JurisdictionModuleContract = {
  registryPortalKey: string;
  registryPortalLabel: string;
  registryImportSupported: boolean;
  compliancePackIds: string[];
  filingKinds: FilingKindDefinition[];
  bylawBaselineLabel: string;
  enabledModuleHints: string[];
  /**
   * Whether this jurisdiction hosts obligations for entities that are extra-provincially
   * registered here (e.g. a federal corporation registered in this province). When true,
   * the module's compliance packs must cover BOTH the `home` and `extra_provincial`
   * contexts — enforced by `npm run test:jurisdiction-modules`. An extra-provincial
   * registration generally carries the same registry-maintenance obligations as a direct
   * incorporation, so one province module is meant to serve both paths.
   */
  supportsExtraProvincialRegistration: boolean;
};

export type JurisdictionWorkspaceConfig = {
  code: string;
  defaults: JurisdictionWorkspaceDefaults;
  registry: RegistryOnboardingCopy;
  module: JurisdictionModuleContract;
  display: {
    entityLabel: string;
    goodStandingTitle: string;
    filingsSubtitle: string;
    directorResidencyLabel: string;
    directorResidencySubtext: string;
    directorChangeSubtext: string;
    registeredOfficeHint: string;
    privacyOfficerLabel: string;
    privacyPolicyLabel: string;
  };
};

const GENERIC_REGISTRY_COPY: RegistryOnboardingCopy = {
  label: "Registry verification",
  nodeDescription:
    "Optional check for registry status, filing history, key custody, authorized filers, and source-document evidence.",
  taskTitle: "Optional: verify registry access",
  taskDescription:
    "Confirm registry status, filing history, key custody, authorized filers, and source-document evidence for this jurisdiction.",
};

const GENERIC_FILING_PORTAL =
  "https://www.canada.ca/en/revenue-agency/services/e-services/e-services-businesses/business-account.html";

const GENERIC_FILING_CHECKLIST = [
  "Review the filing packet and supporting documents.",
  "Open the correct external portal or form.",
  "Submit using the official government workflow.",
  "Capture confirmation number, fee, and evidence.",
];

const BC_REGISTRY_URL = "https://www.bcregistry.gov.bc.ca/societies/";
const CORPORATIONS_CANADA_URL =
  "https://ised-isde.canada.ca/site/corporations-canada/en/online-filing-centre";
const ONTARIO_BUSINESS_REGISTRY_URL = "https://www.ontario.ca/page/ontario-business-registry";

const BC_FILING_KINDS: FilingKindDefinition[] = [
  {
    kind: "BCSocietyAnnualReport",
    label: "BC society annual report",
    registryUrl: BC_REGISTRY_URL,
    checklist: [
      "Confirm AGM date and the directors elected or continuing in office.",
      "Verify registered and records office addresses.",
      "Prepare the annual report filing packet.",
      "Complete the filing in BC Registries/Societies Online and capture the confirmation number.",
      "Attach receipt or submission evidence before marking filed.",
    ],
    botSupported: true,
  },
  {
    kind: "BCExtraProvincialAnnualReport",
    label: "BC extra-provincial annual report",
    registryUrl: BC_REGISTRY_URL,
    checklist: [
      "Review the BC extra-provincial registration profile.",
      "Confirm attorney/agent, registered office or mailing details, and corporation status.",
      "Prepare the annual report or maintenance filing packet.",
      "Complete the filing in BC Registries or the approved service path.",
      "Attach confirmation, receipt, and profile-report evidence.",
    ],
    botSupported: false,
  },
  {
    kind: "BCCompanyAnnualReport",
    label: "BC company annual report",
    registryUrl: BC_REGISTRY_URL,
    checklist: [
      "Review the BC company registry profile as of the anniversary date.",
      "Confirm directors, registered office, records office, and company status.",
      "Prepare the annual report filing packet.",
      "Complete the filing in BC Registries or the approved service path.",
      "Attach confirmation, receipt, and profile-report evidence.",
    ],
    botSupported: false,
  },
  {
    kind: "RegistryRecord",
    label: "Registry record",
    registryUrl: BC_REGISTRY_URL,
    checklist: GENERIC_FILING_CHECKLIST,
    botSupported: false,
  },
  {
    kind: "AnnualReport",
    label: "Annual report",
    registryUrl: BC_REGISTRY_URL,
    checklist: [
      "Confirm AGM date and the directors elected or continuing in office.",
      "Verify registered and records office addresses.",
      "Open the pre-fill packet and confirm the society number and meeting date.",
      "Complete the filing in the portal and capture the confirmation number.",
      "Attach receipt or submission evidence before marking filed.",
    ],
    botSupported: true,
  },
  {
    kind: "ChangeOfDirectors",
    label: "Change of directors",
    registryUrl: BC_REGISTRY_URL,
    checklist: GENERIC_FILING_CHECKLIST,
    botSupported: true,
  },
  {
    kind: "ChangeOfAddress",
    label: "Change of address",
    registryUrl: BC_REGISTRY_URL,
    checklist: GENERIC_FILING_CHECKLIST,
    botSupported: false,
  },
  {
    kind: "BylawAmendment",
    label: "Bylaw amendment",
    registryUrl: BC_REGISTRY_URL,
    checklist: [
      "Confirm the special resolution passed and the text filed matches the approved bylaw wording.",
      "Attach the signed resolution or meeting minutes.",
      "Open the pre-fill packet and verify filing fee details.",
      "Complete the registry filing and capture the confirmation number.",
      "Attach receipt or acknowledgement before marking filed.",
    ],
    botSupported: true,
  },
  {
    kind: "ConstitutionAlteration",
    label: "Constitution alteration",
    registryUrl: BC_REGISTRY_URL,
    checklist: GENERIC_FILING_CHECKLIST,
    botSupported: false,
  },
];

const FEDERAL_CBCA_FILING_KINDS: FilingKindDefinition[] = [
  {
    kind: "FederalAnnualReturn",
    label: "Federal annual return",
    registryUrl: CORPORATIONS_CANADA_URL,
    checklist: [
      "Verify corporation number, anniversary date, registered office, directors, and key custody.",
      "Prepare the annual return filing packet.",
      "File through Corporations Canada or the approved service path.",
      "Capture confirmation number, receipt, and any profile-report evidence.",
    ],
  },
  {
    kind: "FederalIscUpdate",
    label: "ISC register update",
    registryUrl: CORPORATIONS_CANADA_URL,
    checklist: [
      "Review individuals with significant control and nature of control.",
      "Confirm source documents for any ownership or control change.",
      "Update the ISC register and any required registry filing.",
      "Archive confirmation, signed register update, or review memo.",
    ],
  },
  {
    kind: "FederalDirectorChange",
    label: "Federal director change",
    registryUrl: CORPORATIONS_CANADA_URL,
    checklist: GENERIC_FILING_CHECKLIST,
  },
  {
    kind: "FederalRegisteredOfficeChange",
    label: "Federal registered office change",
    registryUrl: CORPORATIONS_CANADA_URL,
    checklist: GENERIC_FILING_CHECKLIST,
  },
];

const ONTARIO_OBCA_FILING_KINDS: FilingKindDefinition[] = [
  {
    kind: "OntarioInitialReturn",
    label: "Ontario initial return",
    registryUrl: ONTARIO_BUSINESS_REGISTRY_URL,
    checklist: [
      "Verify corporation number, registered/head office, directors, officers, and company key custody.",
      "Prepare the initial return filing packet.",
      "File through the Ontario Business Registry or approved service path.",
      "Capture confirmation number, receipt, and profile-report evidence.",
    ],
  },
  {
    kind: "OntarioAnnualReturn",
    label: "Ontario annual return",
    registryUrl: ONTARIO_BUSINESS_REGISTRY_URL,
    checklist: GENERIC_FILING_CHECKLIST,
  },
  {
    kind: "OntarioNoticeOfChange",
    label: "Ontario notice of change",
    registryUrl: ONTARIO_BUSINESS_REGISTRY_URL,
    checklist: GENERIC_FILING_CHECKLIST,
  },
];

export const JURISDICTION_WORKSPACE_CONFIGS: JurisdictionWorkspaceConfig[] = [
  {
    code: "CA-BC",
    defaults: {
      entityType: "society",
      actFormedUnder: "societies_act",
    },
    registry: {
      label: "BC Registry verification",
      nodeDescription:
        "Optional check for registry status, last annual report, filing history, key custody, authorized filers, and BC Registry connector setup.",
      taskTitle: "Optional: verify BC Registry access",
      taskDescription:
        "Confirm registry status, last annual report, filing history, registry key custody, authorized filers, and whether to connect the BC Registry browser workspace.",
    },
    module: {
      registryPortalKey: "bc_registry_societies",
      registryPortalLabel: "BC Registry",
      registryImportSupported: true,
      compliancePackIds: [
        "compliance-ca-bc-societies",
        "compliance-ca-bc-company",
        "compliance-ca-bc-extra-provincial-company",
      ],
      filingKinds: BC_FILING_KINDS,
      bylawBaselineLabel: "BC Model Bylaw baseline",
      enabledModuleHints: ["members", "voting", "recordsInspection", "pipaTraining"],
      supportsExtraProvincialRegistration: true,
    },
    display: {
      entityLabel: "society",
      goodStandingTitle: "Keep your BC society in good standing.",
      filingsSubtitle: "BC Societies Online filings, CRA returns, payroll & GST/HST.",
      directorResidencyLabel: "BC residents",
      directorResidencySubtext: "At least one BC resident required.",
      directorChangeSubtext: "File within 30 days via Societies Online.",
      registeredOfficeHint: "Must be in BC. Records are kept here unless a notice says otherwise.",
      privacyOfficerLabel: "Privacy officer (PIPA)",
      privacyPolicyLabel: "PIPA policy",
    },
  },
  {
    code: "CA-FED-CBCA",
    defaults: {
      entityType: "corporation__business_",
      actFormedUnder: "canada_business_corporations_act",
      isMemberFunded: false,
    },
    registry: {
      label: "Corporations Canada verification",
      nodeDescription:
        "Optional check for federal corporation status, annual-return history, anniversary date, corporation key custody, authorized filers, and Corporations Canada source documents.",
      taskTitle: "Optional: verify Corporations Canada access",
      taskDescription:
        "Confirm federal corporation status, anniversary date, annual-return history, corporation key custody, authorized filers, and whether source documents should be archived.",
    },
    module: {
      registryPortalKey: "corporations_canada",
      registryPortalLabel: "Corporations Canada",
      registryImportSupported: false,
      compliancePackIds: ["compliance-ca-fed-cbca"],
      filingKinds: FEDERAL_CBCA_FILING_KINDS,
      bylawBaselineLabel: "CBCA by-law and articles baseline",
      enabledModuleHints: ["filingPrefill", "secrets", "attestations"],
      // Federal is the home jurisdiction; extra-provincial registration is hosted by the
      // province a federal corporation registers into, not by the federal module.
      supportsExtraProvincialRegistration: false,
    },
    display: {
      entityLabel: "corporation",
      goodStandingTitle: "Keep your federal corporation in good standing.",
      filingsSubtitle: "Corporations Canada filings, CRA returns, payroll & GST/HST.",
      directorResidencyLabel: "Director residency",
      directorResidencySubtext: "Review CBCA director qualification and by-law requirements.",
      directorChangeSubtext: "Track director changes and Corporations Canada notices.",
      registeredOfficeHint: "Record the registered office and any separate records location.",
      privacyOfficerLabel: "Privacy officer",
      privacyPolicyLabel: "Privacy policy",
    },
  },
  {
    code: "CA-ON-OBCA",
    defaults: {
      entityType: "corporation__business_",
      actFormedUnder: "business_corporations_act__ontario_",
      isMemberFunded: false,
    },
    registry: {
      label: "Ontario Business Registry verification",
      nodeDescription:
        "Optional check for Ontario registry status, initial return, annual returns, notices of change, company key custody, authorized filers, and profile-report evidence.",
      taskTitle: "Optional: verify Ontario Business Registry access",
      taskDescription:
        "Confirm Ontario registry status, initial return, annual returns, notices of change, company key custody, authorized filers, and whether profile-report evidence should be archived.",
    },
    module: {
      registryPortalKey: "ontario_business_registry",
      registryPortalLabel: "Ontario Business Registry",
      registryImportSupported: false,
      compliancePackIds: ["compliance-ca-on-obca"],
      filingKinds: ONTARIO_OBCA_FILING_KINDS,
      bylawBaselineLabel: "OBCA by-law and articles baseline",
      enabledModuleHints: ["filingPrefill", "secrets", "attestations"],
      // TODO(jurisdiction): Ontario can host extra-provincial registrations of federal
      // corporations. Flip to true once an OBCA extra-provincial compliance pack exists;
      // test:jurisdiction-modules will then require both-paths coverage.
      supportsExtraProvincialRegistration: false,
    },
    display: {
      entityLabel: "corporation",
      goodStandingTitle: "Keep your Ontario corporation in good standing.",
      filingsSubtitle: "Ontario Business Registry filings, CRA returns, payroll & GST/HST.",
      directorResidencyLabel: "Director register",
      directorResidencySubtext: "Review OBCA director qualification and by-law requirements.",
      directorChangeSubtext: "Track director changes and Ontario Business Registry notices.",
      registeredOfficeHint: "Record the registered/head office and any separate records location.",
      privacyOfficerLabel: "Privacy officer",
      privacyPolicyLabel: "Privacy policy",
    },
  },
];

/** Setup tracks are entity + statute choices; a federal corporation is not a province. */
export const WORKSPACE_SETUP_TRACKS = [
  { id: "bc_society", label: "BC society (nonprofit)", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act", hint: "British Columbia Societies Act; member governance." },
  { id: "bc_company", label: "BC business corporation (provincial)", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_", hint: "British Columbia Business Corporations Act; shareholder governance." },
  { id: "federal_cbca", label: "Federal business corporation (CBCA)", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act", hint: "Corporations Canada; provincial registration may also be needed where you operate." },
  { id: "ontario_obca", label: "Ontario business corporation (OBCA)", jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__ontario_", hint: "Existing Ontario guide track; other provinces need their own reviewed guidance." },
] as const;
export type WorkspaceSetupTrackId = (typeof WORKSPACE_SETUP_TRACKS)[number]["id"];

export function workspaceSetupTrack(organization?: LegalEntityLike | null) {
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  if (code === "CA-BC") return WORKSPACE_SETUP_TRACKS.find((track) => track.id === (isCorporation(organization) ? "bc_company" : "bc_society"));
  return WORKSPACE_SETUP_TRACKS.find((track) => track.jurisdictionCode === code);
}

const BC_COMPANY_CONFIG: JurisdictionWorkspaceConfig = {
  code: "CA-BC",
  defaults: { entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_", isMemberFunded: false },
  registry: {
    label: "BC company registry verification",
    nodeDescription: "Review the BC company profile, anniversary date, annual reports, authorized filers, and Corporate Online source documents.",
    taskTitle: "Optional: verify BC company registry access",
    taskDescription: "Confirm BC company status, anniversary date, annual-report history, authorized filers, and Corporate Online access. Archive company source documents.",
  },
  module: {
    registryPortalKey: "bc_registry_companies",
    registryPortalLabel: "BC Corporate Online",
    registryImportSupported: false,
    compliancePackIds: ["compliance-ca-bc-company", "compliance-ca-bc-extra-provincial-company"],
    filingKinds: BC_FILING_KINDS.filter((definition) => ["BCCompanyAnnualReport", "BCExtraProvincialAnnualReport", "RegistryRecord"].includes(definition.kind)).map((definition) => ({ ...definition, registryUrl: "https://www.corporateonline.gov.bc.ca/", botSupported: false })),
    bylawBaselineLabel: "BC company articles baseline",
    enabledModuleHints: ["filingPrefill", "secrets", "attestations"],
    supportsExtraProvincialRegistration: true,
  },
  display: {
    entityLabel: "corporation",
    goodStandingTitle: "Keep your BC corporation in good standing.",
    filingsSubtitle: "BC company registry filings, CRA returns, payroll & GST/HST.",
    directorResidencyLabel: "Director qualifications",
    directorResidencySubtext: "Review the Business Corporations Act and company articles.",
    directorChangeSubtext: "Track company director changes and BC registry notices.",
    registeredOfficeHint: "Record the BC registered office and records office under the company articles.",
    privacyOfficerLabel: "Privacy officer (PIPA)",
    privacyPolicyLabel: "PIPA policy",
  },
};

type WorkspaceJurisdiction = string | LegalEntityLike | null | undefined;
function workspaceConfig(value: WorkspaceJurisdiction) {
  if (typeof value === "object" && value) {
    const code = canonicalizeJurisdictionCode(homeJurisdictionCode(value));
    if (code === "CA-BC" && isCorporation(value)) return BC_COMPANY_CONFIG;
    return findJurisdictionWorkspaceConfig(code);
  }
  return findJurisdictionWorkspaceConfig(value as string | null | undefined);
}

export function workspaceGovernanceCopy(organization?: LegalEntityLike | null) {
  const corporation = isCorporation(organization);
  const bcCompany = corporation && canonicalizeJurisdictionCode(homeJurisdictionCode(organization)) === "CA-BC";
  return {
    formationDocumentLabel: corporation ? "Articles" : "Constitution",
    purposesLabel: corporation ? "Business activities / article restrictions" : "Purposes (from constitution)",
    documentsDescription: corporation
      ? `Start with ${bcCompany ? "articles, notice of articles, signed incorporation agreement" : "articles of incorporation, by-laws"}, certificate of incorporation, director consents, registered-office evidence, and securities register.`
      : "Start with constitution, bylaws, certificate or registry summary, statement of directors/registered office, and latest annual report if available.",
    registerLabel: corporation ? "Shareholders and securities register" : "Member register",
    peopleDescription: corporation
      ? "Add directors, officers, shareholders, signing authorities, and workspace users. Record share issuances and the applicable ownership/control register."
      : "Add directors, known officers, the privacy officer, and workspace users. Signing authorities and members can be added now if known.",
  };
}

export function defaultsForJurisdiction(jurisdictionCode?: string | null): JurisdictionWorkspaceDefaults {
  return findJurisdictionWorkspaceConfig(jurisdictionCode)?.defaults ?? {};
}

export function registryOnboardingCopy(jurisdictionCode?: WorkspaceJurisdiction): RegistryOnboardingCopy {
  return workspaceConfig(jurisdictionCode)?.registry ?? GENERIC_REGISTRY_COPY;
}

export function jurisdictionDisplayCopy(jurisdictionCode?: WorkspaceJurisdiction) {
  return (
    workspaceConfig(jurisdictionCode)?.display ?? {
      entityLabel: "organization",
      goodStandingTitle: "Keep your organization in good standing.",
      filingsSubtitle: "Registry filings, tax returns, payroll & GST/HST.",
      directorResidencyLabel: "Directors",
      directorResidencySubtext: "Review director qualification and governing document requirements.",
      directorChangeSubtext: "Track director changes and registry notices.",
      registeredOfficeHint: "Record the registered office and any separate records location.",
      privacyOfficerLabel: "Privacy officer",
      privacyPolicyLabel: "Privacy policy",
    }
  );
}

export function jurisdictionModuleContract(jurisdictionCode?: WorkspaceJurisdiction): JurisdictionModuleContract {
  return (
    workspaceConfig(jurisdictionCode)?.module ?? {
      registryPortalKey: "generic_registry",
      registryPortalLabel: "Registry",
      registryImportSupported: false,
      compliancePackIds: [],
      filingKinds: [],
      bylawBaselineLabel: "Governing-document baseline",
      enabledModuleHints: [],
      supportsExtraProvincialRegistration: false,
    }
  );
}

export function filingKindDefinitions(jurisdictionCode?: WorkspaceJurisdiction): FilingKindDefinition[] {
  return jurisdictionModuleContract(jurisdictionCode).filingKinds;
}

export function filingKindDefinition(
  kind: string,
  jurisdictionCode?: WorkspaceJurisdiction,
): FilingKindDefinition {
  const code = typeof jurisdictionCode === "object" && jurisdictionCode ? canonicalizeJurisdictionCode(homeJurisdictionCode(jurisdictionCode)) : jurisdictionCode;
  const definitions = code === "CA-BC" && ["BCCompanyAnnualReport", "BCExtraProvincialAnnualReport"].includes(kind) ? BC_COMPANY_CONFIG.module.filingKinds : filingKindDefinitions(jurisdictionCode);
  return (
    definitions.find((definition) => definition.kind === kind) ?? {
      kind,
      label: kind,
      registryUrl: GENERIC_FILING_PORTAL,
      checklist: GENERIC_FILING_CHECKLIST,
      botSupported: false,
    }
  );
}

export function findJurisdictionWorkspaceConfig(jurisdictionCode?: string | null) {
  return JURISDICTION_WORKSPACE_CONFIGS.find((config) => config.code === jurisdictionCode);
}

/**
 * The node graph shown for the workspace-onboarding workflow that
 * `society.createWorkspace` creates.
 *
 * Lives here — not in `convex/` — because every runtime creates this workflow:
 * hosted Convex, the browser-local workspace behind the PWA, and Electron. When
 * the definition was Convex-only, the local mirror wrote a differently shaped
 * row and the onboarding workflow rendered as an unnamed, empty canvas.
 */
export function buildWorkspaceOnboardingNodes(args: any = {}) {
  const organization = { ...args, jurisdictionCode: args?.jurisdictionCode ?? DEFAULT_HOME_JURISDICTION_CODE };
  const registry = registryOnboardingCopy(organization);
  const governance = workspaceGovernanceCopy(organization);
  return [
    {
      key: "profile",
      type: "form",
      label: "Organization profile",
      description: "Legal name, incorporation number/date, fiscal year end, jurisdiction, governing act, key status flags, and official email.",
      status: "ready",
    },
    {
      key: "registry_optional",
      type: "form",
      label: registry.label,
      description: registry.nodeDescription,
      status: "draft",
    },
    {
      key: "locations",
      type: "form",
      label: "Registered locations",
      description: "Registered office, mailing address, and records location only when records are kept somewhere else.",
      status: "ready",
    },
    {
      key: "documents",
      type: "document_create",
      label: "Governance documents",
      description: governance.documentsDescription,
      status: "ready",
    },
    {
      key: "people",
      type: "form",
      label: "People",
      description: governance.peopleDescription,
      status: "ready",
    },
    {
      key: "optional_setup",
      type: "manual_trigger",
      label: "Optional setup",
      description: `Skip or choose later: annual calendar, ${governance.registerLabel.toLowerCase()}, finance controls, privacy program, insurance/risk, integrations, and board adoption packet.`,
      status: "draft",
    },
  ];
}

/** Config block stored on the onboarding workflow, shared by every runtime. */
export const WORKSPACE_ONBOARDING_WORKFLOW_CONFIG = {
  source: "createWorkspace",
  requiredProfileFields: [
    "name",
    "incorporationNumber",
    "incorporationDate",
    "fiscalYearEnd",
    "registeredOfficeAddress",
    "mailingAddress",
    "privacyOfficerName",
    "privacyOfficerEmail",
  ],
  optionalSections: [
    "registry_verification",
    "annual_calendar",
    "member_register",
    "finance_controls",
    "privacy_records_program",
    "insurance_risk",
    "integrations",
    "board_adoption_packet",
  ],
} as const;

export function buildWorkspaceOnboardingTasks(args: any) {
  const missingIdentity = [
    !args.incorporationNumber ? "incorporation number" : null,
    !args.incorporationDate ? "incorporation date" : null,
    !args.fiscalYearEnd ? "fiscal year end" : null,
  ].filter(Boolean);
  const organization = { ...args, jurisdictionCode: args?.jurisdictionCode ?? DEFAULT_HOME_JURISDICTION_CODE };
  const registry = registryOnboardingCopy(organization);
  const governance = workspaceGovernanceCopy(organization);
  return [
    ...(args?.organizationStatus === "pre_incorporation" ? [{
      title: "Prepare incorporation before recording an active registration",
      description: "Complete the formation preparation worksheet, review the correct official incorporation process, submit externally, and retain the certificate, registry number, and effective date before marking this organization active.",
      priority: "High",
      tags: ["formation", "incorporation"],
    }] : []),
    {
      title: registry.taskTitle,
      description: `${registry.taskDescription}${missingIdentity.length ? ` Missing profile fields now: ${missingIdentity.join(", ")}.` : ""}`,
      priority: missingIdentity.length ? "High" : "Medium",
      tags: ["optional", "registry"],
    },
    {
      title: "Set registered locations",
      description: "Record registered office delivery and mailing addresses. Add a records location only if records are kept somewhere other than the registered office.",
      priority: args.registeredOfficeAddress ? "Medium" : "High",
      tags: ["addresses", "records"],
    },
    {
      title: "Add governance documents",
      description: governance.documentsDescription,
      priority: "High",
      tags: ["documents", "governance"],
    },
    {
      title: "Add people and workspace access",
      description: governance.peopleDescription,
      priority: "High",
      tags: ["people", "access"],
    },
    {
      title: "Optional: finish advanced setup later",
      description: `Choose only what matters: annual calendar, ${governance.registerLabel.toLowerCase()}, finance controls, privacy and records program, insurance/risk, integrations, or a board adoption packet.`,
      priority: "Low",
      tags: ["optional", "advanced-setup"],
    },
  ];
}

export function workspaceOnboardingWorkflowConfig(organization: LegalEntityLike & { organizationStatus?: string } = {}) {
  return {
    ...WORKSPACE_ONBOARDING_WORKFLOW_CONFIG,
    requiredProfileFields: WORKSPACE_ONBOARDING_WORKFLOW_CONFIG.requiredProfileFields.filter((field) => organization.organizationStatus !== "pre_incorporation" || !["incorporationNumber", "incorporationDate"].includes(field)),
    optionalSections: WORKSPACE_ONBOARDING_WORKFLOW_CONFIG.optionalSections.map((section) => section === "member_register" && isCorporation(organization) ? "shareholder_securities_register" : section),
    formationStage: organization.organizationStatus === "pre_incorporation" ? "preparing" : "incorporated",
  };
}
