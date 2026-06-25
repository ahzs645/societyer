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
  ];

  const rightsClasses = current("DB_GLOB_SHARE_CAPTL").map(shareClassPayload);
  const rightsholdingTransfers = current("DB_GLOB_SHARE_TRANS").map(shareTransferPayload);
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
  };
}

/** Total record count across all mapped collections (for logging / summaries). */
export function countBundleRecords(bundle: YcnImportBundle): number {
  return (
    bundle.roleHolders.length +
    bundle.rightsClasses.length +
    bundle.rightsholdingTransfers.length +
    bundle.organizationRegistrations.length +
    bundle.organizationAddresses.length
  );
}
