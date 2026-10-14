/**
 * Where an organization is incorporated and the Act it is (or will be)
 * incorporated under — the catalogue behind the jurisdiction-first setup flow,
 * the review step, organization settings and anything else that names a
 * governing Act.
 *
 * Every entry maps onto the existing setup model (jurisdictionCode,
 * entityType, actFormedUnder, legalSubtype and the default flags) so the rest
 * of the app keeps resolving legal profiles, pathways, modules and copy from
 * those fields alone:
 *
 * - "full" Acts have a reviewed legal profile and a registered pathway; their
 *   setup values are the ones that pathway always produced (checked by
 *   `npm run test:incorporation-acts`).
 * - "records_only" Acts store their own jurisdiction code and Act value. No
 *   legal profile, pathway or jurisdiction module matches them, so the
 *   workspace keeps records without statutory guidance.
 *
 * Pure data and helpers: no imports from the pathway registry, so the domain
 * validators can use it without an import cycle.
 */

export type IncorporationLevel = "federal" | "provincial" | "territorial";
export type IncorporationJurisdictionId =
  | "CA" | "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "ON" | "PE" | "QC" | "SK" | "NT" | "NU" | "YT";
export type IncorporationEntityKind = "business_corporation" | "not_for_profit_corporation" | "society" | "cooperative";
export type IncorporationSupport = "full" | "records_only";

export type IncorporationJurisdiction = {
  id: IncorporationJurisdictionId;
  level: IncorporationLevel;
  /** Full name, e.g. "British Columbia". */
  name: string;
  /** Name used in summaries such as "Federal · CBCA". */
  summaryName: string;
  /** Jurisdiction code stored for Acts without a reviewed profile here. */
  code: string;
  /** Recorded jurisdiction values (canonical codes and registry slugs) that mean this place. */
  aliases: string[];
};

export type IncorporationAct = {
  /** Stable catalogue id, e.g. "ca-cbca", "bc-societies". */
  id: string;
  jurisdiction: IncorporationJurisdictionId;
  /** Official short title of the Act. */
  officialName: string;
  /** Common abbreviation, when one is in general use. */
  abbreviation?: string;
  /** Part of the Act that governs this kind of entity, when only one Part does. */
  part?: string;
  /** One plain sentence: who the Act is for. */
  summary: string;
  /** Stored `actFormedUnder` option value. */
  actFormedUnder: string;
  /** Earlier stored values that mean the same Act. */
  actAliases?: string[];
  /** Entity kinds the Act incorporates. The setup asks only when there is more than one. */
  entityKinds: IncorporationEntityKind[];
  support: IncorporationSupport;
  /** Registered pathway that already handles this Act (full support only). */
  pathwayKey?: string;
  /** Stored jurisdiction code. Full-support Acts keep their pathway's code. */
  jurisdictionCode: string;
  /** Legal subtype the setup records (full support: the pathway's first subtype). */
  legalSubtype: string;
};

/** The "Another Act" choice: stored with this Act value and the jurisdiction's code. */
export const ANOTHER_ACT_VALUE = "another_act";
export const ANOTHER_ACT_ID_SUFFIX = "-another";
/** Onboarding answer `pathwayKey` for an Act without a registered pathway. */
export const RECORDS_ONLY_PATHWAY_KEY = "records_only";
export const OTHER_ACT_NAME_MAX = 200;

export const ENTITY_KIND_ENTITY_TYPES: Record<IncorporationEntityKind, string> = {
  business_corporation: "corporation__business_",
  not_for_profit_corporation: "corporation__nfp_",
  society: "society",
  cooperative: "cooperative",
};

export const ENTITY_KIND_LABELS: Record<IncorporationEntityKind, { label: string; hint: string }> = {
  business_corporation: { label: "Business corporation", hint: "Owned by shareholders who elect the directors." },
  not_for_profit_corporation: { label: "Not-for-profit corporation", hint: "Has members instead of shareholders; profits stay in the organization." },
  society: { label: "Society", hint: "A non-profit run by members who elect the board." },
  cooperative: { label: "Co-operative", hint: "Owned and controlled by the members who use its services." },
};

export const SUPPORT_LABELS: Record<IncorporationSupport, { badge: string; description: string }> = {
  full: { badge: "Full guidance", description: "Reviewed rules, deadlines and document guidance for this Act." },
  records_only: { badge: "Records only", description: "No reviewed guidance yet. Keep records, documents and tasks; check rules and deadlines with the registry or an adviser." },
};

export const INCORPORATION_JURISDICTIONS: readonly IncorporationJurisdiction[] = [
  { id: "CA", level: "federal", name: "Canada (federal)", summaryName: "Federal", code: "CA-FED", aliases: ["CA-FED", "CA-FED-CBCA", "federal__canada_", "federal", "canada"] },
  // Provinces, then territories, each alphabetical.
  { id: "AB", level: "provincial", name: "Alberta", summaryName: "Alberta", code: "CA-AB", aliases: ["CA-AB", "alberta", "ab"] },
  { id: "BC", level: "provincial", name: "British Columbia", summaryName: "British Columbia", code: "CA-BC", aliases: ["CA-BC", "british_columbia", "bc"] },
  { id: "MB", level: "provincial", name: "Manitoba", summaryName: "Manitoba", code: "CA-MB", aliases: ["CA-MB", "manitoba", "mb"] },
  { id: "NB", level: "provincial", name: "New Brunswick", summaryName: "New Brunswick", code: "CA-NB", aliases: ["CA-NB", "new_brunswick", "nb"] },
  { id: "NL", level: "provincial", name: "Newfoundland and Labrador", summaryName: "Newfoundland and Labrador", code: "CA-NL", aliases: ["CA-NL", "newfoundland_and_labrador", "nl"] },
  { id: "NS", level: "provincial", name: "Nova Scotia", summaryName: "Nova Scotia", code: "CA-NS", aliases: ["CA-NS", "nova_scotia", "ns"] },
  { id: "ON", level: "provincial", name: "Ontario", summaryName: "Ontario", code: "CA-ON", aliases: ["CA-ON", "CA-ON-OBCA", "ontario", "on"] },
  { id: "PE", level: "provincial", name: "Prince Edward Island", summaryName: "Prince Edward Island", code: "CA-PE", aliases: ["CA-PE", "prince_edward_island", "pe", "pei"] },
  { id: "QC", level: "provincial", name: "Quebec", summaryName: "Quebec", code: "CA-QC", aliases: ["CA-QC", "quebec", "qc"] },
  { id: "SK", level: "provincial", name: "Saskatchewan", summaryName: "Saskatchewan", code: "CA-SK", aliases: ["CA-SK", "saskatchewan", "sk"] },
  { id: "NT", level: "territorial", name: "Northwest Territories", summaryName: "Northwest Territories", code: "CA-NT", aliases: ["CA-NT", "north_west_territories", "northwest_territories", "nt"] },
  { id: "NU", level: "territorial", name: "Nunavut", summaryName: "Nunavut", code: "CA-NU", aliases: ["CA-NU", "nunavut", "nu"] },
  { id: "YT", level: "territorial", name: "Yukon", summaryName: "Yukon", code: "CA-YT", aliases: ["CA-YT", "yukon", "yt"] },
];

const business: IncorporationEntityKind[] = ["business_corporation"];
const nonProfit: IncorporationEntityKind[] = ["not_for_profit_corporation"];
const society: IncorporationEntityKind[] = ["society"];
const coop: IncorporationEntityKind[] = ["cooperative"];

function recordsOnly(jurisdiction: IncorporationJurisdictionId, entry: Omit<IncorporationAct, "jurisdiction" | "support" | "jurisdictionCode" | "legalSubtype">): IncorporationAct {
  const place = INCORPORATION_JURISDICTIONS.find((candidate) => candidate.id === jurisdiction)!;
  return { ...entry, jurisdiction, support: "records_only", jurisdictionCode: place.code, legalSubtype: "other" };
}

/**
 * Acts with official short titles. Where an Act's current title could not be
 * confirmed it is left out; "Another Act" covers it.
 */
export const INCORPORATION_ACTS: readonly IncorporationAct[] = [
  // Federal
  { id: "ca-cbca", jurisdiction: "CA", officialName: "Canada Business Corporations Act", abbreviation: "CBCA", summary: "Business corporations owned by shareholders, filed with Corporations Canada.", actFormedUnder: "canada_business_corporations_act", entityKinds: business, support: "full", pathwayKey: "federal_cbca", jurisdictionCode: "CA-FED-CBCA", legalSubtype: "federal_private_corporation" },
  recordsOnly("CA", { id: "ca-cnca", officialName: "Canada Not-for-profit Corporations Act", abbreviation: "CNCA", summary: "Not-for-profit corporations with members, filed with Corporations Canada.", actFormedUnder: "canada_not_for_profit_corporations_act", entityKinds: nonProfit }),
  recordsOnly("CA", { id: "ca-coops", officialName: "Canada Cooperatives Act", summary: "Co-operatives operating in more than one province, filed with Corporations Canada.", actFormedUnder: "canada_cooperatives_act", entityKinds: coop }),
  // Alberta
  recordsOnly("AB", { id: "ab-bca", officialName: "Business Corporations Act", summary: "Business corporations owned by shareholders, filed with Alberta Corporate Registry.", actFormedUnder: "business_corporations_act__alberta_", entityKinds: business }),
  recordsOnly("AB", { id: "ab-societies", officialName: "Societies Act", summary: "Non-profit societies for community, cultural and charitable groups.", actFormedUnder: "societies_act__alberta_", entityKinds: society }),
  recordsOnly("AB", { id: "ab-companies-part9", officialName: "Companies Act", part: "Part 9", summary: "Non-profit companies, often used by charities and larger non-profits.", actFormedUnder: "companies_act__alberta_", entityKinds: nonProfit }),
  recordsOnly("AB", { id: "ab-coops", officialName: "Cooperatives Act", summary: "Co-operatives owned and controlled by their members.", actFormedUnder: "cooperatives_act__alberta_", entityKinds: coop }),
  // British Columbia
  { id: "bc-societies", jurisdiction: "BC", officialName: "Societies Act", summary: "Non-profit societies run by members who elect the board, filed with BC Registries.", actFormedUnder: "societies_act", entityKinds: society, support: "full", pathwayKey: "bc_society", jurisdictionCode: "CA-BC", legalSubtype: "ordinary_society" },
  { id: "bc-bca", jurisdiction: "BC", officialName: "Business Corporations Act", summary: "Companies owned by shareholders who elect the directors, filed with BC Registries.", actFormedUnder: "business_corporations_act__british_columbia_", actAliases: ["business_corporations_act"], entityKinds: business, support: "full", pathwayKey: "bc_company", jurisdictionCode: "CA-BC", legalSubtype: "ordinary_private_company" },
  recordsOnly("BC", { id: "bc-coops", officialName: "Cooperative Association Act", summary: "Co-operative associations owned and controlled by their members.", actFormedUnder: "cooperative_association_act", entityKinds: coop }),
  // Manitoba
  recordsOnly("MB", { id: "mb-corporations", officialName: "The Corporations Act", summary: "Business corporations, and non-profit corporations without share capital.", actFormedUnder: "the_corporations_act__manitoba_", entityKinds: ["business_corporation", "not_for_profit_corporation"] }),
  recordsOnly("MB", { id: "mb-coops", officialName: "The Cooperatives Act", summary: "Co-operatives owned and controlled by their members.", actFormedUnder: "the_cooperatives_act__manitoba_", entityKinds: coop }),
  // New Brunswick
  recordsOnly("NB", { id: "nb-bca", officialName: "Business Corporations Act", summary: "Business corporations owned by shareholders, filed with Service New Brunswick.", actFormedUnder: "business_corporations_act__new_brunswick_", entityKinds: business }),
  recordsOnly("NB", { id: "nb-companies", officialName: "Companies Act", summary: "Non-profit companies, filed with Service New Brunswick.", actFormedUnder: "companies_act__new_brunswick_", entityKinds: nonProfit }),
  // Newfoundland and Labrador
  recordsOnly("NL", { id: "nl-corporations", officialName: "Corporations Act", summary: "Business corporations, and non-profit corporations without share capital.", actFormedUnder: "corporations_act__newfoundland_", entityKinds: ["business_corporation", "not_for_profit_corporation"] }),
  // Nova Scotia
  recordsOnly("NS", { id: "ns-companies", officialName: "Companies Act", summary: "Companies owned by shareholders, filed with the Registry of Joint Stock Companies.", actFormedUnder: "companies_act__nova_scotia_", entityKinds: business }),
  recordsOnly("NS", { id: "ns-societies", officialName: "Societies Act", summary: "Non-profit societies run by their members.", actFormedUnder: "societies_act__nova_scotia_", entityKinds: society }),
  recordsOnly("NS", { id: "ns-coops", officialName: "Co-operative Associations Act", summary: "Co-operatives owned and controlled by their members.", actFormedUnder: "co_operative_associations_act__nova_scotia_", entityKinds: coop }),
  // Ontario
  { id: "on-obca", jurisdiction: "ON", officialName: "Business Corporations Act", abbreviation: "OBCA", summary: "Business corporations owned by shareholders, filed with the Ontario Business Registry.", actFormedUnder: "business_corporations_act__ontario_", entityKinds: business, support: "full", pathwayKey: "ontario_obca", jurisdictionCode: "CA-ON-OBCA", legalSubtype: "other" },
  recordsOnly("ON", { id: "on-onca", officialName: "Not-for-Profit Corporations Act, 2010", abbreviation: "ONCA", summary: "Not-for-profit corporations with members, filed with the Ontario Business Registry.", actFormedUnder: "not_for_profit_corporations_act__2010__ontario_", entityKinds: nonProfit }),
  recordsOnly("ON", { id: "on-coops", officialName: "Co-operative Corporations Act", summary: "Co-operatives owned and controlled by their members.", actFormedUnder: "co_operative_corporations_act__ontario_", entityKinds: coop }),
  // Prince Edward Island
  recordsOnly("PE", { id: "pe-bca", officialName: "Business Corporations Act", summary: "Business corporations owned by shareholders.", actFormedUnder: "business_corporations_act__prince_edward_island_", entityKinds: business }),
  recordsOnly("PE", { id: "pe-companies", officialName: "Companies Act", part: "Part II", summary: "Non-profit companies, such as clubs, associations and charities.", actFormedUnder: "companies_act__prince_edward_island_", entityKinds: nonProfit }),
  recordsOnly("PE", { id: "pe-coops", officialName: "Co-operative Associations Act", summary: "Co-operatives owned and controlled by their members.", actFormedUnder: "co_operative_associations_act__prince_edward_island_", entityKinds: coop }),
  // Quebec
  recordsOnly("QC", { id: "qc-bca", officialName: "Business Corporations Act", summary: "Business corporations owned by shareholders, filed with the Registraire des entreprises.", actFormedUnder: "business_corporations_act__quebec_", entityKinds: business }),
  recordsOnly("QC", { id: "qc-companies-part3", officialName: "Companies Act", part: "Part III", summary: "Non-profit legal persons, such as associations and charities.", actFormedUnder: "companies_act__quebec_", entityKinds: nonProfit }),
  recordsOnly("QC", { id: "qc-coops", officialName: "Cooperatives Act", summary: "Co-operatives owned and controlled by their members.", actFormedUnder: "cooperatives_act__quebec_", entityKinds: coop }),
  // Saskatchewan
  recordsOnly("SK", { id: "sk-bca", officialName: "The Business Corporations Act, 2021", summary: "Business corporations owned by shareholders, filed with ISC Corporate Registry.", actFormedUnder: "business_corporations_act__2021__saskatchewan_", entityKinds: business }),
  recordsOnly("SK", { id: "sk-npca", officialName: "The Non-profit Corporations Act, 2022", summary: "Non-profit corporations with members, filed with ISC Corporate Registry.", actFormedUnder: "non_profit_corporations_act__saskatchewan_", entityKinds: nonProfit }),
  recordsOnly("SK", { id: "sk-coops", officialName: "The Co-operatives Act, 1996", summary: "Co-operatives owned and controlled by their members.", actFormedUnder: "co_operatives_act__1996__saskatchewan_", entityKinds: coop }),
  // Northwest Territories
  recordsOnly("NT", { id: "nt-bca", officialName: "Business Corporations Act", summary: "Business corporations owned by shareholders.", actFormedUnder: "business_corporations_act__northwest_territories_", entityKinds: business }),
  recordsOnly("NT", { id: "nt-societies", officialName: "Societies Act", summary: "Non-profit societies run by their members.", actFormedUnder: "societies_act__northwest_territories_", entityKinds: society }),
  // Nunavut
  recordsOnly("NU", { id: "nu-bca", officialName: "Business Corporations Act", summary: "Business corporations owned by shareholders.", actFormedUnder: "business_corporations_act__nunavut_", entityKinds: business }),
  recordsOnly("NU", { id: "nu-societies", officialName: "Societies Act", summary: "Non-profit societies run by their members.", actFormedUnder: "societies_act__nunavut_", entityKinds: society }),
  // Yukon
  recordsOnly("YT", { id: "yt-bca", officialName: "Business Corporations Act", summary: "Business corporations owned by shareholders.", actFormedUnder: "business_corporations_act__yukon_", entityKinds: business }),
  recordsOnly("YT", { id: "yt-societies", officialName: "Societies Act", summary: "Non-profit societies run by their members.", actFormedUnder: "societies_act__yukon_", entityKinds: society }),
];

const ALL_KINDS: IncorporationEntityKind[] = ["business_corporation", "not_for_profit_corporation", "society", "cooperative"];

/** The per-jurisdiction "Another Act" choice; the user names the Act and picks the entity kind. */
export function anotherActFor(jurisdiction: IncorporationJurisdictionId): IncorporationAct {
  const place = incorporationJurisdiction(jurisdiction)!;
  return {
    id: `${jurisdiction.toLowerCase()}${ANOTHER_ACT_ID_SUFFIX}`, jurisdiction, officialName: "Another Act",
    summary: "Not listed here. Enter the Act's name and the kind of organization.",
    actFormedUnder: ANOTHER_ACT_VALUE, entityKinds: ALL_KINDS, support: "records_only", jurisdictionCode: place.code, legalSubtype: "other",
  };
}

export function incorporationJurisdiction(id?: string | null): IncorporationJurisdiction | undefined {
  return INCORPORATION_JURISDICTIONS.find((place) => place.id === id);
}

/** The jurisdiction a recorded code or registry slug refers to ("CA-ON-OBCA", "ontario" → Ontario). */
export function incorporationJurisdictionForCode(code?: string | null): IncorporationJurisdiction | undefined {
  const value = typeof code === "string" ? code.trim() : "";
  if (!value) return undefined;
  const lower = value.toLowerCase();
  return INCORPORATION_JURISDICTIONS.find((place) => place.aliases.some((alias) => alias.toLowerCase() === lower));
}

export function incorporationActsFor(jurisdiction: IncorporationJurisdictionId): IncorporationAct[] {
  return [...INCORPORATION_ACTS.filter((act) => act.jurisdiction === jurisdiction), anotherActFor(jurisdiction)];
}

/** Catalogue entry by id, including the per-jurisdiction "Another Act" ids. */
export function incorporationActById(id?: string | null): IncorporationAct | undefined {
  if (!id) return undefined;
  const listed = INCORPORATION_ACTS.find((act) => act.id === id);
  if (listed) return listed;
  if (!id.endsWith(ANOTHER_ACT_ID_SUFFIX)) return undefined;
  const place = INCORPORATION_JURISDICTIONS.find((candidate) => `${candidate.id.toLowerCase()}${ANOTHER_ACT_ID_SUFFIX}` === id);
  return place ? anotherActFor(place.id) : undefined;
}

/** Catalogue entry for a stored Act value; "Another Act" resolves through the jurisdiction. */
export function incorporationActForValue(actFormedUnder?: string | null, jurisdictionCode?: string | null): IncorporationAct | undefined {
  const value = typeof actFormedUnder === "string" ? actFormedUnder.trim().toLowerCase() : "";
  if (!value) return undefined;
  if (value === ANOTHER_ACT_VALUE) {
    const place = incorporationJurisdictionForCode(jurisdictionCode);
    return place ? anotherActFor(place.id) : undefined;
  }
  return INCORPORATION_ACTS.find((act) => act.actFormedUnder === value || act.actAliases?.includes(value));
}

export function entityKindForType(entityType?: string | null): IncorporationEntityKind | undefined {
  return (Object.keys(ENTITY_KIND_ENTITY_TYPES) as IncorporationEntityKind[]).find((kind) => ENTITY_KIND_ENTITY_TYPES[kind] === entityType);
}

export type IncorporationSetup = {
  jurisdictionCode: string;
  entityType: string;
  actFormedUnder: string;
  legalSubtype: string;
  isMemberFunded: false;
  isCharity: false;
  numbered: false;
  distributing: false;
  charityStatus: "unknown";
  /** Onboarding answer pathwayKey: the registered pathway, or "records_only". */
  pathwayKey: string;
};

/** Setup values for a chosen Act (and entity kind, when the Act allows several). */
export function incorporationActSetup(act: IncorporationAct, entityKind?: IncorporationEntityKind): IncorporationSetup {
  const kind = entityKind && act.entityKinds.includes(entityKind) ? entityKind : act.entityKinds[0];
  return {
    jurisdictionCode: act.jurisdictionCode,
    entityType: ENTITY_KIND_ENTITY_TYPES[kind],
    actFormedUnder: act.actFormedUnder,
    legalSubtype: act.legalSubtype,
    isMemberFunded: false, isCharity: false, numbered: false, distributing: false, charityStatus: "unknown",
    pathwayKey: act.support === "full" ? act.pathwayKey! : RECORDS_ONLY_PATHWAY_KEY,
  };
}

/** "Canada Business Corporations Act (CBCA)", "Companies Act, Part 9". */
export function incorporationActTitle(act: IncorporationAct, otherActName?: string): string {
  if (act.actFormedUnder === ANOTHER_ACT_VALUE) return otherActName?.trim() || "Another Act";
  return `${act.officialName}${act.part ? `, ${act.part}` : ""}${act.abbreviation ? ` (${act.abbreviation})` : ""}`;
}

/** Short Act name for summaries: the abbreviation when there is one. */
export function incorporationActShortName(act: IncorporationAct, otherActName?: string): string {
  if (act.actFormedUnder === ANOTHER_ACT_VALUE) return otherActName?.trim() || "Another Act";
  return act.abbreviation ?? `${act.officialName}${act.part ? `, ${act.part}` : ""}`;
}

/** "Federal · CBCA", "British Columbia · Societies Act". */
export function incorporationActSummary(act: IncorporationAct, otherActName?: string): string {
  return `${incorporationJurisdiction(act.jurisdiction)!.summaryName} · ${incorporationActShortName(act, otherActName)}`;
}

export type GoverningActDescription = {
  act?: IncorporationAct;
  jurisdiction?: IncorporationJurisdiction;
  /** "Federal · CBCA", or the best available text for an Act outside the catalogue. */
  summary: string;
  support: IncorporationSupport;
};

/**
 * Describe an organization's governing Act for display (review step, settings,
 * demo persona hints). Acts outside the catalogue are described as records only.
 */
export function describeGoverningAct(organization?: { jurisdictionCode?: string | null; homeJurisdictionCode?: string | null; actFormedUnder?: string | null } | null, otherActName?: string): GoverningActDescription {
  const code = organization?.jurisdictionCode ?? organization?.homeJurisdictionCode;
  const act = incorporationActForValue(organization?.actFormedUnder, code);
  const jurisdiction = act ? incorporationJurisdiction(act.jurisdiction) : incorporationJurisdictionForCode(code);
  if (act) return { act, jurisdiction, summary: incorporationActSummary(act, otherActName), support: act.support };
  return { jurisdiction, summary: jurisdiction ? jurisdiction.summaryName : "", support: "records_only" };
}

/** Option values the catalogue stores, for the actsFormedUnder allowlist (gate-checked). */
export const INCORPORATION_ACT_VALUES: readonly string[] = [...new Set([...INCORPORATION_ACTS.map((act) => act.actFormedUnder), ANOTHER_ACT_VALUE])];
/** Jurisdiction codes the catalogue stores, for the entityJurisdictions allowlist (gate-checked). */
export const INCORPORATION_JURISDICTION_CODES: readonly string[] = [...new Set([...INCORPORATION_JURISDICTIONS.map((place) => place.code), ...INCORPORATION_ACTS.map((act) => act.jurisdictionCode)])];
