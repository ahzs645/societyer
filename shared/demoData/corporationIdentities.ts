/**
 * Identity of the three fictional corporation demo workspaces offered by the
 * demo banner's "Try another organization type" menu. Kept apart from the
 * generator (shared/demoData/corporations.ts) so the banner can name a persona
 * without bundling the whole story. Every name, number and address here is
 * invented for the demo; none refers to a real person or business.
 */
export type CorporationDemoKey = "bc_company" | "federal_cbca" | "ontario_obca";

export const CORPORATION_DEMO_KEYS: readonly CorporationDemoKey[] = ["bc_company", "federal_cbca", "ontario_obca"];

export type CorporationDemoIdentity = {
  key: CorporationDemoKey;
  name: string;
  incorporationNumber: string;
  incorporationDate: string;
  /** Recurring fiscal year end, MM-DD. */
  fiscalYearEnd: string;
  jurisdictionCode: "CA-BC" | "CA-FED-CBCA" | "CA-ON-OBCA";
  actFormedUnder: string;
  /** The pathway subtype; Ontario has no reviewed subtype, so none is recorded. */
  legalSubtype?: string;
  /** Deterministic id prefix for every generated row of this workspace. */
  idPrefix: string;
};

export const CORPORATION_DEMO_IDENTITIES: Readonly<Record<CorporationDemoKey, CorporationDemoIdentity>> = {
  bc_company: {
    key: "bc_company",
    name: "Cedar Demo Holdings Ltd.",
    incorporationNumber: "BC1234567",
    incorporationDate: "2019-02-01",
    fiscalYearEnd: "12-31",
    jurisdictionCode: "CA-BC",
    actFormedUnder: "business_corporations_act__british_columbia_",
    legalSubtype: "ordinary_private_company",
    idPrefix: "democorp_bc",
  },
  federal_cbca: {
    key: "federal_cbca",
    name: "Maple Demo Federal Inc.",
    incorporationNumber: "1234567-8",
    incorporationDate: "2020-09-15",
    fiscalYearEnd: "12-31",
    jurisdictionCode: "CA-FED-CBCA",
    actFormedUnder: "canada_business_corporations_act",
    legalSubtype: "federal_private_corporation",
    idPrefix: "democorp_cbca",
  },
  ontario_obca: {
    key: "ontario_obca",
    name: "Lakeshore Demo Ontario Inc.",
    incorporationNumber: "1000123456",
    incorporationDate: "2018-03-12",
    fiscalYearEnd: "06-30",
    jurisdictionCode: "CA-ON-OBCA",
    actFormedUnder: "business_corporations_act__ontario_",
    idPrefix: "democorp_obca",
  },
};

/** The society row id of a corporation demo workspace in the in-browser demo. */
export function corporationDemoSocietyId(key: CorporationDemoKey): string {
  return `${CORPORATION_DEMO_IDENTITIES[key].idPrefix}_society`;
}

export function isCorporationDemoKey(value: unknown): value is CorporationDemoKey {
  return typeof value === "string" && (CORPORATION_DEMO_KEYS as readonly string[]).includes(value);
}
