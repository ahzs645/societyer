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

type JurisdictionWorkspaceConfig = {
  code: string;
  defaults: JurisdictionWorkspaceDefaults;
  registry: RegistryOnboardingCopy;
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

export function defaultsForJurisdiction(jurisdictionCode?: string | null): JurisdictionWorkspaceDefaults {
  return findJurisdictionWorkspaceConfig(jurisdictionCode)?.defaults ?? {};
}

export function registryOnboardingCopy(jurisdictionCode?: string | null): RegistryOnboardingCopy {
  return findJurisdictionWorkspaceConfig(jurisdictionCode)?.registry ?? GENERIC_REGISTRY_COPY;
}

export function jurisdictionDisplayCopy(jurisdictionCode?: string | null) {
  return (
    findJurisdictionWorkspaceConfig(jurisdictionCode)?.display ?? {
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

function findJurisdictionWorkspaceConfig(jurisdictionCode?: string | null) {
  return JURISDICTION_WORKSPACE_CONFIGS.find((config) => config.code === jurisdictionCode);
}
