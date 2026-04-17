export const MODULE_DEFAULTS = {
  communications: true,
  volunteers: true,
  grants: true,
  voting: true,
  auditors: true,
  attestations: true,
  courtOrders: true,
  filingPrefill: true,
  recordsInspection: true,
  pipaTraining: true,
  insurance: true,
  secrets: true,
  transparency: true,
  reconciliation: true,
  donationReceipts: true,
  membershipBilling: true,
  employees: true,
  paperless: true,
  workflows: true,
} as const;

export type ModuleKey = keyof typeof MODULE_DEFAULTS;
export type ModuleSettings = { [K in ModuleKey]: boolean };
export type ModuleCategory =
  | "Engagement"
  | "Governance"
  | "Compliance"
  | "Finance"
  | "Public"
  | "Integrations";

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  category: ModuleCategory;
  description: string;
  includes: string[];
};

type LegacyModuleSettings = Partial<ModuleSettings>;
type StoredModuleSource =
  | LegacyModuleSettings
  | string[]
  | {
      modules?: LegacyModuleSettings | null;
      disabledModules?: string[] | null;
    }
  | null
  | undefined;

export const MODULE_KEYS = Object.keys(MODULE_DEFAULTS) as ModuleKey[];

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    key: "communications",
    label: "Communications",
    category: "Engagement",
    description: "Campaigns, member consent preferences, and AGM notice delivery.",
    includes: ["Communications", "AGM notice sending", "Privacy consent coverage"],
  },
  {
    key: "volunteers",
    label: "Volunteer management",
    category: "Engagement",
    description: "Volunteer roster, screenings, and public volunteer intake.",
    includes: ["Volunteers", "Volunteer apply page", "Portal volunteer intake"],
  },
  {
    key: "grants",
    label: "Grant management",
    category: "Engagement",
    description: "Grant pipeline, applications, reports, and public funding intake.",
    includes: ["Grants", "Grant apply page", "Portal funding intake"],
  },
  {
    key: "voting",
    label: "Voting & resolutions",
    category: "Governance",
    description: "Member proposals, elections, written resolutions, proxies, and ballot access.",
    includes: ["Member proposals", "Elections", "Written resolutions", "Proxies", "Portal ballots"],
  },
  {
    key: "auditors",
    label: "Auditors",
    category: "Governance",
    description: "Auditor appointments and related oversight records.",
    includes: ["Auditors"],
  },
  {
    key: "attestations",
    label: "Director attestations",
    category: "Governance",
    description: "Annual director attestations and missing-attestation tracking.",
    includes: ["Director attestations"],
  },
  {
    key: "courtOrders",
    label: "Court orders",
    category: "Governance",
    description: "Court order tracking for organizations that need it.",
    includes: ["Court orders"],
  },
  {
    key: "filingPrefill",
    label: "Filing pre-fill",
    category: "Compliance",
    description: "Pre-fill packets and export helpers for filing workflows.",
    includes: ["Filing pre-fill"],
  },
  {
    key: "recordsInspection",
    label: "Records requests",
    category: "Compliance",
    description: "Records retention and inspection request workflows.",
    includes: ["Records retention", "Records inspections"],
  },
  {
    key: "pipaTraining",
    label: "PIPA training log",
    category: "Compliance",
    description: "Training records for privacy and CASL refresh workflows.",
    includes: ["PIPA training", "Privacy training status"],
  },
  {
    key: "insurance",
    label: "Insurance register",
    category: "Compliance",
    description: "Insurance policy records and renewal tracking.",
    includes: ["Insurance"],
  },
  {
    key: "secrets",
    label: "Access custody",
    category: "Compliance",
    description: "Client-facing custody tracking for recovery keys, registry credentials, account owners, and review dates.",
    includes: ["Access custody", "Credential owners", "Recovery-key review"],
  },
  {
    key: "transparency",
    label: "Public transparency",
    category: "Public",
    description: "Public transparency center and published records.",
    includes: ["Public transparency", "Public transparency page"],
  },
  {
    key: "reconciliation",
    label: "Reconciliation",
    category: "Finance",
    description: "Bank-to-ledger reconciliation workflows.",
    includes: ["Reconciliation"],
  },
  {
    key: "donationReceipts",
    label: "Donation receipts",
    category: "Finance",
    description: "Receipt issuance, voiding, and receipt history.",
    includes: ["Donation receipts"],
  },
  {
    key: "membershipBilling",
    label: "Membership billing",
    category: "Finance",
    description: "Plans, subscriptions, and membership billing operations.",
    includes: ["Membership & billing"],
  },
  {
    key: "employees",
    label: "Employee register",
    category: "Finance",
    description: "Employee records for societies with payroll or staff.",
    includes: ["Employees"],
  },
  {
    key: "paperless",
    label: "Paperless-ngx",
    category: "Integrations",
    description: "External document storage, OCR, and Paperless tag sync for Societyer files.",
    includes: ["Paperless-ngx plugin", "Document sync", "Cross-module tagging"],
  },
  {
    key: "workflows",
    label: "Workflows",
    category: "Integrations",
    description: "Templated automations — AGM prep, insurance renewal reminders, annual-report filing.",
    includes: ["Workflows", "Workflow runs", "Scheduled recipes"],
  },
];

export const MODULES_BY_KEY = Object.fromEntries(
  MODULE_DEFINITIONS.map((module) => [module.key, module]),
) as Record<ModuleKey, ModuleDefinition>;

export const MODULE_CATEGORIES = Array.from(
  new Set(MODULE_DEFINITIONS.map((module) => module.category)),
) as ModuleCategory[];

function isModuleKey(value: string): value is ModuleKey {
  return value in MODULE_DEFAULTS;
}

function getLegacyModuleSettings(source: StoredModuleSource) {
  if (!source || Array.isArray(source)) return null;
  if ("disabledModules" in source || "modules" in source) {
    return source.modules ?? null;
  }
  return source;
}

export function getDisabledModuleKeys(source?: StoredModuleSource): ModuleKey[] {
  if (!source) return [];
  if (Array.isArray(source)) {
    return source.filter(isModuleKey);
  }
  if ("disabledModules" in source) {
    return (source.disabledModules ?? []).filter(isModuleKey);
  }

  const legacy = getLegacyModuleSettings(source);
  if (!legacy) return [];

  return MODULE_KEYS.filter((key) => legacy[key] === false);
}

export function settingsToDisabledModules(settings: ModuleSettings): ModuleKey[] {
  return MODULE_KEYS.filter((key) => !settings[key]);
}

export function normalizeModuleSettings(source?: StoredModuleSource): ModuleSettings {
  const disabled = new Set(getDisabledModuleKeys(source));
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = !disabled.has(key);
    return acc;
  }, {} as ModuleSettings);
}

export function isModuleEnabled(
  source:
    | { modules?: LegacyModuleSettings | null; disabledModules?: string[] | null }
    | LegacyModuleSettings
    | string[]
    | null
    | undefined,
  key: ModuleKey,
) {
  return normalizeModuleSettings(source)[key];
}
