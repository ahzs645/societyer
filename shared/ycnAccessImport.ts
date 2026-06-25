/**
 * YCN/Access → Societyer import-bundle adapter (pure logic, import-boundary use).
 *
 * Turns the raw rows of a YCN BC-corporate-records Access database (the
 * `DB_GLOB_*` tables, as emitted by `mdb-export`) into a Societyer import
 * "bundle" — the same shape `importSessions.createFromBundle` already accepts.
 * Every record then flows through the existing staged review → promote pipeline;
 * no Convex schema change is required.
 *
 * The two YCN-specific concerns this module owns:
 *   1. Date decoding — every `*_DT_TM` / `*_DT` column is a YCN float
 *      (`YYYYMMDD.HHMMSS`); decode it with {@link decodeYcnDate}, treating the
 *      `<19000101` sentinel as null ({@link isYcnNullDate}).
 *   2. Bitemporal currency — a row whose `REVISE_DT_TM` is set has been
 *      superseded; by default only "current" rows are imported.
 *
 * Framework-free: no convex / react imports. Named exports only.
 */

import { decodeYcnDate, isYcnNullDate } from "./ycnDate";
import { normalizeGender } from "./nlg";

/** A raw row as produced by `mdb-export` — column name → cell text. */
export type YcnRow = Record<string, string | number | null | undefined>;

/** A mapped import-bundle payload (arbitrary record fields). */
export type BundlePayload = Record<string, unknown>;

/** table name → its rows. Table names match `mdb-tables` output exactly. */
export type YcnTables = Record<string, YcnRow[]>;

export interface BuildBundleOptions {
  /** Display name for the import session. */
  name?: string;
  /**
   * Include rows that have been superseded (`REVISE_DT_TM` set). Defaults to
   * false — only the current register rows are imported.
   */
  includeSuperseded?: boolean;
}

/** A Societyer import bundle (only the keys this adapter populates). */
export interface YcnImportBundle {
  metadata: { name: string; createdFrom: string };
  roleHolders: BundlePayload[];
  rightsClasses: BundlePayload[];
  rightsholdingTransfers: BundlePayload[];
  organizationRegistrations: BundlePayload[];
  organizationAddresses: BundlePayload[];
  serviceProviders: BundlePayload[];
  dividends: BundlePayload[];
  nameHistory: BundlePayload[];
  constatingEvents: BundlePayload[];
  significantIndividualSteps: BundlePayload[];
  assets: BundlePayload[];
  shareCertificates: BundlePayload[];
  // Not staged records — applied directly by the runner:
  societySettings: BundlePayload | null; // → society:updateComplianceSettings
  directoryPeople: BundlePayload[]; // → peopleDirectory:upsert (cross-tenant)
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

/** Case-insensitive lookup over a raw row, returning the first non-empty cell. */
export function pick(row: YcnRow, ...names: string[]): string | undefined {
  const upper = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    upper.set(key.toUpperCase(), value);
  }
  for (const name of names) {
    const value = upper.get(name.toUpperCase());
    const text = value == null ? "" : String(value).trim();
    if (text !== "") {
      return text;
    }
  }
  return undefined;
}

/**
 * Decode a YCN float-date cell to ISO-8601, or undefined when missing /
 * sentinel. Non-float strings that already look like ISO are passed through.
 */
export function decodeYcnCell(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  const text = String(value).trim();
  if (text === "") {
    return undefined;
  }
  // An already-ISO value passes through — check before isYcnNullDate, whose
  // numeric sentinel test would otherwise misread the leading year.
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text;
  }
  if (isYcnNullDate(text)) {
    return undefined;
  }
  return decodeYcnDate(text) ?? undefined;
}

/** Decode a date column straight off a row by (case-insensitive) name. */
export function pickDate(row: YcnRow, ...names: string[]): string | undefined {
  return decodeYcnCell(pick(row, ...names));
}

function toNumber(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const n = Number(String(value).replace(/[,$]/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
}

/** Parse a YCN money string ("$52,500", "10", "C$ 1,000") into integer cents. */
export function parseMoneyCents(value: unknown): number | undefined {
  const n = toNumber(value);
  return n === undefined ? undefined : Math.round(n * 100);
}

/** Strip a YCN leading register index ("2. Avery Ward" -> "Avery Ward"). */
export function stripLeadingNumber(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/^\s*\d+\.\s*/, "").trim() || undefined;
}

/** YCN Y/N/Unknown -> Societyer yes|no|unknown. */
export function mapYesNoUnknown(raw: string | undefined): string {
  const text = (raw ?? "").trim().toLowerCase();
  if (text.startsWith("y")) return "yes";
  if (text.startsWith("n")) return "no";
  return "unknown";
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Month name or number -> 1-12, or undefined. */
export function monthToNumber(raw: string | undefined): number | undefined {
  const text = (raw ?? "").trim().toLowerCase();
  if (text === "") return undefined;
  const idx = MONTH_NAMES.findIndex((m) => m.startsWith(text.slice(0, 3)));
  if (idx >= 0) return idx + 1;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : undefined;
}

/** Parse an mdb-export Access date ("MM/DD/YY [HH:MM:SS]") to ISO YYYY-MM-DD. */
export function parseAccessDate(raw: string | undefined): string | undefined {
  const text = (raw ?? "").trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return undefined;
  const month = m[1].padStart(2, "0");
  const day = m[2].padStart(2, "0");
  let year = Number(m[3]);
  if (m[3].length <= 2) year += year < 50 ? 2000 : 1900;
  return `${year}-${month}-${day}`;
}

/** YCN Y/N/D flag -> boolean (Y true; N/D/empty false). */
function ynToBool(raw: string | undefined): boolean {
  return (raw ?? "").trim().toUpperCase().startsWith("Y");
}

/**
 * Extract DB_GLOB_CORP_SETTINGS (current row) into the arg shape of
 * society:updateComplianceSettings. Applied by the runner, not the staged
 * pipeline (settings patch the society directly).
 */
export function extractCorpSettings(tables: YcnTables): BundlePayload | null {
  const rows = rowsOf(tables, "DB_GLOB_CORP_SETTINGS").filter(isCurrentRow);
  const row = rows[0];
  if (!row) return null;
  const out: BundlePayload = {
    agmMonth: monthToNumber(pick(row, "AGM_MONTH")),
    agmDay: toNumber(pick(row, "AGM_DAY")),
    waivePrepFinancials: ynToBool(pick(row, "WAIVE_PREP_FINANCIALS")),
    restrictPeoplePicker: ynToBool(pick(row, "RESTRICT_PEOPLE_YND")),
    docPrepLanguage: pick(row, "DOC_PREP_LANGUAGE"),
    primaryContactName: pick(row, "CONT_PRIM_NAME"),
    primaryContactPhone: pick(row, "CONT_PRIM_PHONE"),
    primaryContactEmail: pick(row, "CONT_PRIM_EMAIL"),
    altContactName: pick(row, "CONT_ALT_NAME"),
    altContactPhone: pick(row, "CONT_ALT_PHONE"),
    altContactEmail: pick(row, "CONT_ALT_EMAIL"),
    minuteBookLocation: pick(row, "LOC_MIN_BOOK"),
    sealLocation: pick(row, "LOC_SEAL_ETC"),
  };
  // Drop undefined keys so the mutation only patches what's present.
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

/**
 * Extract DB_GLOB_PEOPLE_DIRECTORY into the arg shape of peopleDirectory:upsert
 * (cross-tenant; applied directly by the runner, deduped by the upsert).
 */
export function extractDirectoryPeople(tables: YcnTables): BundlePayload[] {
  return rowsOf(tables, "DB_GLOB_PEOPLE_DIRECTORY").map((row) => ({
    fullName: pick(row, "FULL_NAME") ?? pick(row, "SEARCH_NAME") ?? "Imported person",
    firstName: pick(row, "FIRST_NAME"),
    lastName: pick(row, "LAST_NAME"),
    dob: parseAccessDate(pick(row, "INDIV_DOB")),
    isIndividual: ynToBool(pick(row, "INDIVIDUAL")),
    gender: normalizeGender(pick(row, "INDIV_CUR_GENDER")),
    defaultAddress: pick(row, "ADDRESS"),
    isServiceProvider: Boolean(pick(row, "SERVICE_PROVIDER")),
    atAgeOfMajority: ynToBool(pick(row, "INDIV_CUR_MAJ")),
    corpSign: pick(row, "CORP_SIGN"),
  }));
}

/** A row is "current" when its REVISE_DT_TM is null / the YCN sentinel. */
export function isCurrentRow(row: YcnRow): boolean {
  return isYcnNullDate(pick(row, "REVISE_DT_TM"));
}

function entId(row: YcnRow): string {
  return pick(row, "ENT_ID", "Ent_ID") ?? "ycn";
}

function dbId(row: YcnRow): string {
  return pick(row, "DB_ID") ?? "0";
}

function rowsOf(tables: YcnTables, name: string): YcnRow[] {
  // Case-insensitive table lookup so callers needn't match mdb casing exactly.
  const direct = tables[name];
  if (direct) {
    return direct;
  }
  const hit = Object.entries(tables).find(([key]) => key.toUpperCase() === name.toUpperCase());
  return hit ? hit[1] : [];
}

function filterCurrent(rows: YcnRow[], includeSuperseded: boolean): YcnRow[] {
  return includeSuperseded ? rows : rows.filter(isCurrentRow);
}

// ---------------------------------------------------------------------------
// Per-table mappers (each returns import-bundle payloads)
// ---------------------------------------------------------------------------

/** ISS_TYP / share-transaction type → Societyer transferType vocabulary. */
export function mapShareTransferType(raw: string | undefined): string {
  const text = (raw ?? "").trim().toLowerCase();
  if (text.startsWith("allot") || text.startsWith("issu")) return "issuance";
  if (text.startsWith("subdiv") || text.startsWith("split")) return "subdivision";
  if (text.startsWith("consol")) return "consolidation";
  if (text.startsWith("cancel") || text.startsWith("redeem") || text.startsWith("repurch")) return "cancellation";
  if (text.startsWith("transfer") || text === "") return "transfer";
  return "transfer";
}

function directorPayload(row: YcnRow): BundlePayload {
  return {
    roleType: "director",
    fullName: pick(row, "Name", "NAME"),
    startDate: pickDate(row, "APPOINT_DT_TM"),
    endDate: pickDate(row, "REMOVE_DT_TM"),
    sourceExternalIds: [`ycn:director:${entId(row)}:${dbId(row)}`],
  };
}

function officerTitle(row: YcnRow): string | undefined {
  const other = pick(row, "OTHER");
  if (other) return other;
  if (pick(row, "PRES")) return "President";
  if (pick(row, "SECR")) return "Secretary";
  return undefined;
}

function officerPayload(row: YcnRow): BundlePayload {
  return {
    roleType: "officer",
    fullName: pick(row, "Name", "NAME"),
    officerTitle: officerTitle(row),
    startDate: pickDate(row, "APPOINT_DT_TM"),
    endDate: pickDate(row, "REMOVE_DT_TM"),
    sourceExternalIds: [`ycn:officer:${entId(row)}:${dbId(row)}`],
  };
}

function entPersonPayload(row: YcnRow): BundlePayload {
  return {
    roleType: "authorized_representative",
    fullName: pick(row, "FULL_NAME"),
    firstName: pick(row, "FIRST_NAME"),
    lastName: pick(row, "LAST_NAME"),
    street: pick(row, "ADDRESS"),
    // gender flows to the NLG engine once roleHolders carries it (WS2b).
    gender: normalizeGender(pick(row, "GENDER", "INDIV_CUR_GENDER")),
    startDate: pickDate(row, "INFO_STR"),
    endDate: pickDate(row, "INFO_END"),
    sourceExternalIds: [`ycn:person:${entId(row)}:${pick(row, "PERS_ID", "GLOB_ID") ?? dbId(row)}`],
  };
}

// Gender canonicalisation lives in shared/nlg.ts (the M/F/X domain owner) and is
// re-exported here for the import test's convenience.
export { normalizeGender };

function shareClassPayload(row: YcnRow): BundlePayload {
  return {
    className: pick(row, "SHR_DESC", "CLASS"),
    classType: "share",
    idPrefix: pick(row, "CLASS"),
    votingRights: pick(row, "VOTING"),
    startDate: pickDate(row, "CREATION_DT_TM"),
    endDate: pickDate(row, "CANCEL_DT_TM"),
    sourceExternalIds: [`ycn:share-class:${entId(row)}:${pick(row, "CLASS") ?? dbId(row)}`],
  };
}

function shareTransferPayload(row: YcnRow): BundlePayload {
  const amount = pick(row, "SHR_CONSID_AMT");
  const currency = pick(row, "SHR_CONSID_CUR");
  return {
    transferType: mapShareTransferType(pick(row, "ISS_TYP")),
    transferDate: pickDate(row, "ISS_DT_TM"),
    destinationHolderName: pick(row, "HLDR_NAME"),
    quantity: toNumber(pick(row, "SHR_NUM")),
    considerationType: pick(row, "SHR_CONSID_TYP"),
    considerationDescription: amount ? `${amount}${currency ? ` ${currency}` : ""}`.trim() : undefined,
    rightsClassName: pick(row, "SHR_CLASS"),
    sourceExternalIds: [`ycn:share-trans:${entId(row)}:${dbId(row)}`],
  };
}

function regFilingPayload(row: YcnRow): BundlePayload {
  return {
    jurisdiction: pick(row, "JURISDICTION"),
    nature: pick(row, "REGN_NAT"),
    legislation: pick(row, "REGN_LEG"),
    number: pick(row, "REGN_NUM"),
    registeredDate: pickDate(row, "REGN_DT_TM"),
    fiscalYear: pick(row, "FILE_YEAR"),
    sourceExternalIds: [`ycn:reg-filing:${entId(row)}:${dbId(row)}`],
  };
}

/** Split a YCN single-string address ("street, city, region postal") into parts. */
function addressPayload(row: YcnRow, addressType: string): BundlePayload {
  const combined = pick(row, "ADDRESS") ?? [
    pick(row, "ADDRESS_1"),
    pick(row, "ADDRESS_2"),
    pick(row, "ADDRESS_3"),
    pick(row, "ADDRESS_4"),
  ].filter(Boolean).join(", ");
  const parts = combined.split(",").map((p) => p.trim()).filter(Boolean);
  return {
    addressType,
    street: parts[0] || combined,
    city: parts[1],
    provinceState: parts[2],
    address: combined,
    startDate: pickDate(row, "START_DT_TM"),
    sourceExternalIds: [`ycn:${addressType}-address:${entId(row)}:${dbId(row)}`],
  };
}

/** YCN TRANSPARENCY_REG → a controller role holder (significant individual). */
function transparencyControllerPayload(row: YcnRow): BundlePayload {
  const ended = pickDate(row, "END_DT");
  return {
    roleType: "controller",
    fullName: stripLeadingNumber(pick(row, "NAME")),
    status: ended ? "former" : "current",
    street: pick(row, "ADDRESS"),
    dateOfBirth: pickDate(row, "BIRTH"),
    citizenshipResidency: pick(row, "CITIZEN"),
    taxResidentHomeJurisdiction: mapYesNoUnknown(pick(row, "TAX_RESIDENT_YN")),
    significanceReason: pick(row, "REASON"),
    startDate: pickDate(row, "START_DT"),
    endDate: ended,
    sourceExternalIds: [`ycn:transparency:${entId(row)}:${dbId(row)}`],
  };
}

/** YCN TRANSPARENCY_DUE → a significant-individual diligence step. */
function transparencyStepPayload(row: YcnRow): BundlePayload {
  return {
    individualName: stripLeadingNumber(pick(row, "NAME")),
    stepsNarrative: pick(row, "STEPS"),
    stepDate: pickDate(row, "STEP_DT"),
    sourceExternalIds: [`ycn:transparency-due:${entId(row)}:${dbId(row)}`],
  };
}

/** YCN FUNCTION label → serviceProviders.function enum. */
export function mapServiceFunction(raw: string | undefined): string {
  const text = (raw ?? "").trim().toLowerCase();
  if (text.startsWith("auditor")) return "auditor";
  if (text.startsWith("lawyer") || text.startsWith("legal")) return "lawyer";
  if (text.startsWith("account")) return "accountant";
  if (text.startsWith("bank")) return "banker";
  if (text.startsWith("transfer")) return "transfer_agent";
  if (text.startsWith("registered") || text.startsWith("agent")) return "registered_agent";
  return "other";
}

function serviceProviderPayload(row: YcnRow): BundlePayload {
  return {
    function: mapServiceFunction(pick(row, "FUNCTION")),
    firmName: pick(row, "FIRM_NAME"),
    contactName: pick(row, "CONTACT_NAME"),
    firmLocation: pick(row, "FIRM_LOCATION"),
    appointedOn: pickDate(row, "APPOINT_DT_TM"),
    removedOn: pickDate(row, "REMOVE_DT_TM"),
    sourceExternalIds: [`ycn:service-provider:${entId(row)}:${pick(row, "FIRM_ID") ?? dbId(row)}`],
  };
}

function dividendPayload(row: YcnRow): BundlePayload {
  return {
    declaredOn: pickDate(row, "DECLARE_DT_TM"),
    shareClass: pick(row, "CLASS"),
    perShareCents: parseMoneyCents(pick(row, "DIV_PER_SHARE")),
    sharesOutstanding: toNumber(pick(row, "SHR_TOTAL")),
    currency: pick(row, "DIV_CURRENCY"),
    totalCents: parseMoneyCents(pick(row, "DIV_TOTAL")),
    sourceExternalIds: [`ycn:dividend:${entId(row)}:${dbId(row)}`],
  };
}

function nameHistoryPayload(row: YcnRow): BundlePayload {
  return {
    name: pick(row, "CORP_NAME"),
    shortName: pick(row, "SHORT_NAME"),
    startISO: pickDate(row, "START_DT_TM"),
    regPosn: toNumber(pick(row, "REG_POSN")),
    sourceExternalIds: [`ycn:corp-name:${entId(row)}:${dbId(row)}`],
  };
}

/** YCN REG_ACTION → constatingEvents.action enum. */
export function mapConstatingAction(raw: string | undefined): string {
  const text = (raw ?? "").trim().toLowerCase();
  for (const action of ["incorporated", "transitioned", "continued", "amalgamated", "restated"]) {
    if (text.includes(action.slice(0, 6))) return action;
  }
  return "other";
}

function constatingPayload(row: YcnRow): BundlePayload {
  return {
    action: mapConstatingAction(pick(row, "REG_ACTION")),
    jurisdiction: pick(row, "JURISDICTION"),
    legislation: pick(row, "LEGISLATION"),
    regNumber: pick(row, "REG_NUMBER"),
    startISO: pickDate(row, "START_DT_TM"),
    sourceExternalIds: [`ycn:constating:${entId(row)}:${dbId(row)}`],
  };
}

function assetPayload(row: YcnRow): BundlePayload {
  const disposed = pickDate(row, "DISP_DT_TM");
  const disposalNote = [
    disposed ? `Disposed ${disposed}` : null,
    pick(row, "DISP_PRICE") ? `for ${pick(row, "DISP_PRICE")} ${pick(row, "DISP_CURRENCY") ?? ""}`.trim() : null,
    pick(row, "DISP_TO") ? `to ${pick(row, "DISP_TO")}` : null,
    pick(row, "DISP_COMMENTS"),
    pick(row, "ACQ_COMMENTS"),
  ].filter(Boolean).join("; ");
  return {
    assetTag: pick(row, "ASSET_ID"),
    name: pick(row, "ASSET_DESC"),
    category: pick(row, "ASSET_TYPE"),
    quantityOnHand: toNumber(pick(row, "ASSET_QUANT")),
    purchaseDate: pickDate(row, "ACQ_DT_TM"),
    purchaseValueCents: parseMoneyCents(pick(row, "ACQ_COST")),
    currency: pick(row, "ACQ_CURRENCY"),
    supplier: pick(row, "ACQ_FROM"),
    location: pick(row, "ASSET_JUR"),
    status: disposed ? "disposed" : "in_service",
    notes: disposalNote || undefined,
    sourceExternalIds: [`ycn:asset:${entId(row)}:${dbId(row)}`],
  };
}

/** YCN SHARE_TRANS rows carrying a certificate number → the certificate register. */
function shareCertificatePayload(row: YcnRow): BundlePayload {
  return {
    certificateNumber: pick(row, "SHR_CERT"),
    holderName: pick(row, "HLDR_NAME"),
    shareClass: pick(row, "SHR_CLASS"),
    shares: toNumber(pick(row, "SHR_NUM")),
    issuedOn: pickDate(row, "ISS_DT_TM"),
    replacesCertificateNumber: pick(row, "SHR_CERT_REPL"),
    cancelledOn: pickDate(row, "CANCEL_DT_TM"),
    sourceExternalIds: [`ycn:share-cert:${entId(row)}:${dbId(row)}`],
  };
}

// ---------------------------------------------------------------------------
// Bundle builder
// ---------------------------------------------------------------------------

/**
 * Build a Societyer import bundle from a set of YCN Access tables.
 *
 * Only the tables with a clean home in the existing import pipeline are mapped:
 * directors/officers/people → roleHolders, share capital → rightsClasses, share
 * transactions → rightsholdingTransfers, registration filings →
 * organizationRegistrations, and the office/business addresses →
 * organizationAddresses.
 */
export function buildBundleFromAccessTables(
  tables: YcnTables,
  options: BuildBundleOptions = {},
): YcnImportBundle {
  const includeSuperseded = options.includeSuperseded ?? false;
  const current = (name: string) => filterCurrent(rowsOf(tables, name), includeSuperseded);

  const roleHolders: BundlePayload[] = [
    ...current("DB_GLOB_DIRECTOR").map(directorPayload),
    ...current("DB_GLOB_OFFICER").map(officerPayload),
    ...current("DB_GLOB_ENT_PEOPLE").map(entPersonPayload),
    // The BC transparency register's significant individuals are controller role holders.
    ...current("DB_GLOB_TRANSPARENCY_REG").map(transparencyControllerPayload),
  ];

  const rightsClasses = current("DB_GLOB_SHARE_CAPTL").map(shareClassPayload);
  const shareTransRows = current("DB_GLOB_SHARE_TRANS");
  const rightsholdingTransfers = shareTransRows.map(shareTransferPayload);
  const shareCertificates = shareTransRows
    .filter((row) => pick(row, "SHR_CERT"))
    .map(shareCertificatePayload);
  const organizationRegistrations = current("DB_GLOB_REG_FILING").map(regFilingPayload);
  const organizationAddresses: BundlePayload[] = [
    ...current("DB_GLOB_REG_OFFICE").map((row) => addressPayload(row, "registered")),
    ...current("DB_GLOB_REC_OFFICE").map((row) => addressPayload(row, "records")),
    ...current("DB_GLOB_BUS_ADDRESS").map((row) => addressPayload(row, "business")),
  ];

  return {
    metadata: {
      name: options.name || "YCN Access import",
      createdFrom: "YCN/Access",
    },
    roleHolders,
    rightsClasses,
    rightsholdingTransfers,
    organizationRegistrations,
    organizationAddresses,
    serviceProviders: current("DB_GLOB_SERVICE_PROVIDERS").map(serviceProviderPayload),
    dividends: current("DB_GLOB_DIVIDEND").map(dividendPayload),
    nameHistory: current("DB_GLOB_CORP_NAME").map(nameHistoryPayload),
    constatingEvents: current("DB_GLOB_CONSTATING").map(constatingPayload),
    significantIndividualSteps: current("DB_GLOB_TRANSPARENCY_DUE").map(transparencyStepPayload),
    assets: current("DB_GLOB_CORP_ASSETS").map(assetPayload),
    shareCertificates,
    societySettings: extractCorpSettings(tables),
    directoryPeople: extractDirectoryPeople(tables),
  };
}

/** Total record count across all mapped collections (for logging / summaries). */
export function countBundleRecords(bundle: YcnImportBundle): number {
  return (
    bundle.roleHolders.length +
    bundle.rightsClasses.length +
    bundle.rightsholdingTransfers.length +
    bundle.organizationRegistrations.length +
    bundle.organizationAddresses.length +
    bundle.serviceProviders.length +
    bundle.dividends.length +
    bundle.nameHistory.length +
    bundle.constatingEvents.length +
    bundle.significantIndividualSteps.length +
    bundle.assets.length +
    bundle.shareCertificates.length
  );
}
