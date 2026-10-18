export const MODULE_DEFAULTS = {
  communications: true,
  volunteers: true,
  grants: true,
  agreements: true,
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
  assets: true,
  donationReceipts: true,
  membershipBilling: true,
  employees: true,
  payroll: true,
  cards: true,
  investments: true,
  paperless: true,
  browserConnectors: true,
  workflows: true,
  // Off until a workspace turns it on: it shows data published from outside Societyer.
  procurementReview: false,
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

/** Entity kinds a module applies to; omitted means every kind. */
export type ModuleEntityKind = "society" | "corporation";

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  category: ModuleCategory;
  description: string;
  includes: string[];
  /** Matches the module's routes in ROUTE_IDENTITY (entityKinds). */
  entityKinds?: ModuleEntityKind[];
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
    key: "agreements",
    label: "Agreements register",
    category: "Finance",
    description: "Contracts, funding agreements, leases and MOUs with their term, renewal, deliverables, reports and signing authority.",
    includes: ["Agreements", "Renewal and report deadlines", "Agreements expiring card"],
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
    label: "Privacy training log",
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
    key: "assets",
    label: "Asset register",
    category: "Finance",
    description: "Asset tags, custody, maintenance, insurance, grants, verification, and disposal tracking.",
    includes: ["Assets", "QR labels", "Physical inventory"],
  },
  {
    key: "donationReceipts",
    label: "Donation receipts",
    category: "Finance",
    description: "Receipt issuance, voiding, and receipt history.",
    includes: ["Donation receipts"],
    entityKinds: ["society"],
  },
  {
    key: "membershipBilling",
    label: "Membership billing",
    category: "Finance",
    description: "Plans, subscriptions, and membership billing operations.",
    includes: ["Membership & billing"],
    entityKinds: ["society"],
  },
  {
    key: "employees",
    label: "Employee register",
    category: "Finance",
    description: "Employee records for organizations with payroll or staff.",
    includes: ["Employees"],
  },
  {
    key: "payroll",
    label: "Payroll register",
    category: "Finance",
    description: "Pay runs, CRA source-deduction remittances, year-end slips and records of employment. Record-keeping only.",
    includes: ["Payroll"],
  },
  {
    key: "cards",
    label: "Credit card register",
    category: "Finance",
    description: "Organization credit cards, cardholder agreements and monthly statement reconciliation against the bank feed.",
    includes: ["Credit cards"],
  },
  {
    key: "investments",
    label: "Investments register",
    category: "Finance",
    description: "GICs, term deposits and savings held as reserves, with interest and maturity reminders.",
    includes: ["Investments"],
  },
  {
    key: "paperless",
    label: "Paperless-ngx",
    category: "Integrations",
    description: "External document storage, OCR, and Paperless tag sync for Societyer files.",
    includes: ["Paperless-ngx plugin", "Document sync", "Cross-module tagging"],
  },
  {
    key: "browserConnectors",
    label: "Browser apps",
    category: "Integrations",
    description: "User-authorized browser app profiles for imports, downloads, and site utilities.",
    includes: ["App login sessions", "Saved browser profiles", "Browser utility actions"],
  },
  {
    key: "workflows",
    label: "Workflows",
    category: "Integrations",
    description: "Templated automations — AGM prep, insurance renewal reminders, annual-report filing.",
    includes: ["Workflows", "Workflow runs", "Scheduled recipes"],
  },
  {
    key: "procurementReview",
    label: "Procurement review",
    category: "Integrations",
    description: "A read-only copy of the bid opportunities a Zoer instance publishes to this workspace's SharePoint folder.",
    includes: ["Procurement review", "Published snapshot viewer", "Bid document previews"],
  },
];

/**
 * Whether a module applies to an organisation of this kind. Unknown kinds
 * ("organization", or before the workspace loads) keep every module, like
 * routeAllowedForEntityKind.
 */
export function moduleAppliesToEntityKind(
  module: { entityKinds?: readonly ModuleEntityKind[] },
  kind: string | null | undefined,
): boolean {
  if (!module.entityKinds?.length) return true;
  if (kind === "society" || kind === "corporation") return module.entityKinds.includes(kind);
  return true;
}

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

/**
 * A workspace stores only the module choices that differ from MODULE_DEFAULTS,
 * in its `disabledModules` list: a bare key turns a default-on module off, and
 * `+key` turns a default-off module on. Workspaces that never chose keep every
 * default, so a new default-off module starts off everywhere without a
 * migration, and a stale client that drops a `+key` it doesn't know leaves the
 * module off rather than on.
 */
export const MODULE_OPT_IN_PREFIX = "+";

function storedModuleChoices(source: StoredModuleSource): Map<ModuleKey, boolean> {
  const choices = new Map<ModuleKey, boolean>();
  if (!source) return choices;
  const list = Array.isArray(source) ? source : "disabledModules" in source ? source.disabledModules ?? [] : null;
  if (list) {
    for (const entry of list) {
      if (typeof entry !== "string") continue;
      if (isModuleKey(entry)) {
        if (MODULE_DEFAULTS[entry]) choices.set(entry, false);
      } else if (entry.startsWith(MODULE_OPT_IN_PREFIX)) {
        const key = entry.slice(MODULE_OPT_IN_PREFIX.length);
        if (isModuleKey(key) && !MODULE_DEFAULTS[key]) choices.set(key, true);
      }
    }
    return choices;
  }
  const legacy = getLegacyModuleSettings(source) as Record<string, unknown> | null;
  for (const key of MODULE_KEYS) {
    // Legacy objects only ever recorded a change from the default.
    if (legacy?.[key] === !MODULE_DEFAULTS[key]) choices.set(key, !MODULE_DEFAULTS[key]);
  }
  return choices;
}

export function getDisabledModuleKeys(source?: StoredModuleSource): ModuleKey[] {
  const settings = normalizeModuleSettings(source);
  return MODULE_KEYS.filter((key) => !settings[key]);
}

/** The stored form of a full set of choices (see MODULE_OPT_IN_PREFIX). */
export function settingsToDisabledModules(settings: ModuleSettings): string[] {
  return MODULE_KEYS.flatMap((key) => {
    if (settings[key] === MODULE_DEFAULTS[key]) return [];
    return MODULE_DEFAULTS[key] ? [key] : [`${MODULE_OPT_IN_PREFIX}${key}`];
  });
}

/**
 * Modules whose backing service this deployment doesn't run, with the reason.
 * They read as disabled wherever a module is checked, while a workspace's own
 * saved choices (`normalizeModuleSettings`) stay untouched, so turning the
 * service on later brings them back as each workspace left them.
 */
const unavailableOnDeployment = new Map<ModuleKey, string>();

export function setDeploymentUnavailableModules(entries: Partial<Record<ModuleKey, string>>) {
  unavailableOnDeployment.clear();
  for (const [key, reason] of Object.entries(entries)) {
    if (isModuleKey(key) && reason) unavailableOnDeployment.set(key, reason);
  }
}

/** Why this deployment can't offer a module, or undefined when it can. */
export function deploymentUnavailableReason(key: ModuleKey): string | undefined {
  return unavailableOnDeployment.get(key);
}

/** A workspace's saved module choices; see `isModuleEnabled` for what is actually available. */
export function normalizeModuleSettings(source?: StoredModuleSource): ModuleSettings {
  const choices = storedModuleChoices(source);
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = choices.get(key) ?? MODULE_DEFAULTS[key];
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
  return normalizeModuleSettings(source)[key] && !unavailableOnDeployment.has(key);
}
