/**
 * YCN/Access → Societyer import-bundle adapter (pure logic, import-boundary use).
 *
 * Turns the raw rows of a YCN BC-corporate-records Access database (the
 * `DB_GLOB_*` tables, as emitted by `mdb-export`) into a Societyer import
 * "bundle" — the shape `importSessions.createFromBundle` accepts. Every staged
 * record then flows through the review → promote pipeline.
 *
 * What this module owns:
 *  1. ONE ENTITY AT A TIME. A YCN database holds many companies, keyed by
 *     `ENT_ID` (the registry number). {@link listYcnEntities} lists them and
 *     {@link buildBundleFromAccessTables} imports exactly one, so two companies
 *     are never merged into one organization. The global PEOPLE_DIRECTORY is
 *     narrowed to the people on that entity's roster.
 *  2. Date decoding — `*_DT_TM` / `*_DT` columns are YCN floats
 *     (`YYYYMMDD.HHMMSS`); `<19000101` means null and `29991231` means "no end".
 *     Access DateTime columns (birth dates) are exported with 4-digit years by
 *     the runner; a 2-digit year is resolved sensibly and flagged when unclear.
 *  3. Bitemporal currency — a row whose `REVISE_DT_TM` is set has been
 *     superseded and is not imported (YCN keeps it only as an audit trail).
 *  4. Field names that match what the apply step reads (office history with
 *     effective dates, registrations, the annual-filing ledger, officer titles,
 *     share-class flags, asset acquisition/disposition fields, fiscal year end).
 *  5. The certificate register → ledger conversion, delegated to
 *     shared/ycnShareConversion.ts, with a reconciliation report.
 *  6. People: the per-entity roster (ENT_PEOPLE) gives each director, officer,
 *     shareholder and significant individual their name and address and a link
 *     to the directory person (GLOB_ID). The roster is NOT imported as signers:
 *     Societyer's entitySigners would override the role-based signatories of
 *     every generated document, and YCN's roster lists everyone connected to the
 *     company (holding companies, former officers, relatives), not signatories.
 *     Societyer has no per-entity, valid-time name/address table, so each register
 *     row gets the particulars in effect at the right date (today, or when the
 *     office ended) and a person's earlier particulars are kept in the notes.
 *  7. Retain_List is the firm's client list, not a retention schedule: only
 *     RESP_LWYR is used (→ responsibleLawyer).
 *
 * Framework-free: no convex / react imports. Named exports only.
 */

import { decodeYcnDate, isYcnNullDate, isYcnOpenEndDate, resolveTwoDigitBirthYear } from "./ycnDate";
import { normalizeGender } from "./nlg";
import { isAllowedOption, normalizeOptionValue } from "./orgHubOptions";
import {
  convertYcnShareRegister,
  ycnIssueType,
  type ShareConversionResult,
  type YcnShareRow,
} from "./ycnShareConversion";

// Gender canonicalisation lives in shared/nlg.ts (the M/F/X domain owner); re-exported for the import check.
export { normalizeGender };

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
   * The ENT_ID to import. Required when the database holds more than one
   * entity; {@link listYcnEntities} lists them.
   */
  entityId?: string;
  /** "Today" for current/former status and birth-year checks (YYYY-MM-DD). */
  referenceDate?: string;
  /** Ledger kind for a share certificate cancelled with nothing replacing it. */
  cancellationKind?: "redemption" | "cancellation";
}

/** A Societyer import bundle (only the keys this adapter populates). */
export interface YcnImportBundle {
  metadata: { name: string; createdFrom: string; ycnEntityId: string; ycnEntityName?: string };
  roleHolders: BundlePayload[];
  rightsClasses: BundlePayload[];
  rightsholdingTransfers: BundlePayload[];
  organizationRegistrations: BundlePayload[];
  annualFilingLedger: BundlePayload[];
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
  directoryPeople: BundlePayload[]; // → peopleDirectory:upsert (only this entity's roster)
  // Report only (not staged):
  report: YcnImportReport;
}

/** What the import could not do cleanly, for the person reviewing it. */
export interface YcnImportReport {
  entityId: string;
  shareConversion: {
    clean: boolean;
    movements: number;
    certificates: number;
    reconciledDates: string[];
    checkedPoints: number;
    mismatches: number;
    issues: ShareConversionResult["issues"];
  };
  warnings: string[];
}

/** Bundle keys staged through importSessions.createFromBundle. */
export const YCN_STAGED_KEYS = [
  "roleHolders", "rightsClasses", "rightsholdingTransfers", "organizationRegistrations", "annualFilingLedger",
  "organizationAddresses", "serviceProviders", "dividends", "nameHistory", "constatingEvents",
  "significantIndividualSteps", "assets", "shareCertificates",
] as const;

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
 * Decode a YCN float-date cell to ISO-8601, or undefined when missing, the
 * null sentinel (<19000101) or the open-end sentinel (29991231). Strings that
 * already look like ISO pass through.
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
    return Number(text.slice(0, 4)) >= 2999 ? undefined : text;
  }
  if (isYcnNullDate(text) || isYcnOpenEndDate(text)) {
    return undefined;
  }
  return decodeYcnDate(text) ?? undefined;
}

/** Decode a date column straight off a row by (case-insensitive) name. */
export function pickDate(row: YcnRow, ...names: string[]): string | undefined {
  return decodeYcnCell(pick(row, ...names));
}

/** The calendar day (YYYY-MM-DD) of a date column, or undefined. */
export function pickDay(row: YcnRow, ...names: string[]): string | undefined {
  return pickDate(row, ...names)?.slice(0, 10);
}

function toNumber(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const n = Number(String(value).replace(/[,$€£¥]/g, "").replace(/^[A-Za-z]+/, "").trim());
  return Number.isFinite(n) ? n : undefined;
}

/** Parse a YCN money string ("$52,500", "10", "C$ 1,000") into integer cents. */
export function parseMoneyCents(value: unknown): number | undefined {
  const n = toNumber(value);
  return n === undefined ? undefined : Math.round(n * 100);
}

/** YCN currency label ("$", "C$", "US$", "EU€") → Societyer currency code, when known. */
export function mapYcnCurrency(raw: string | undefined): string | undefined {
  const text = (raw ?? "").trim().toUpperCase();
  if (!text) return undefined;
  if (text === "$" || text.startsWith("C$") || text.startsWith("CA") || text === "CDN") return "cad";
  if (text.startsWith("US")) return "usd";
  if (text.startsWith("EU") || text.includes("€")) return "eur";
  if (text.startsWith("UK") || text.startsWith("GB") || text.includes("£")) return "gbp";
  if (text.startsWith("JP") || text.includes("¥")) return "jpy";
  return undefined;
}

/** Strip a YCN leading register index ("2. Person A" -> "Person A"). */
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

/** YCN FIN_MONTH / FIN_DAY → `fiscalYearEnd` (recurring MM-DD), or undefined when invalid. */
export function fiscalYearEndFrom(monthRaw: string | undefined, dayRaw: string | undefined): string | undefined {
  const month = monthToNumber(monthRaw);
  const dayNumber = toNumber(dayRaw);
  if (!month || !dayNumber || !Number.isInteger(dayNumber) || dayNumber < 1) return undefined;
  // Validate against a leap year so a 29 February year end is kept (it means the last day of February).
  if (dayNumber > new Date(Date.UTC(2000, month, 0)).getUTCDate()) return undefined;
  return `${String(month).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
}

/** A parsed birth date with any doubt about the century. */
export interface ParsedBirthDate {
  iso?: string;
  ambiguous: boolean;
  note?: string;
}

/**
 * Parse an mdb-export Access date to ISO YYYY-MM-DD. Accepts ISO output
 * (`-D '%Y-%m-%d'`, which the runner uses) and the default `MM/DD/YY` form.
 * A 2-digit year is resolved as a birth year (see resolveTwoDigitBirthYear) and
 * flagged when both centuries are plausible.
 */
export function parseAccessBirthDate(
  raw: string | undefined,
  options: { referenceYear: number; atAgeOfMajority?: boolean },
): ParsedBirthDate {
  const text = (raw ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, ambiguous: false };
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return { ambiguous: false };
  const month = m[1].padStart(2, "0");
  const day = m[2].padStart(2, "0");
  if (m[3].length === 4) return { iso: `${m[3]}-${month}-${day}`, ambiguous: false };
  const resolved = resolveTwoDigitBirthYear(Number(m[3]), options);
  return { iso: `${resolved.year}-${month}-${day}`, ambiguous: resolved.ambiguous, note: resolved.reason };
}

/** Back-compatible wrapper: an Access date as ISO, reading a 2-digit year as a birth year. */
export function parseAccessDate(raw: string | undefined, referenceYear = new Date().getUTCFullYear()): string | undefined {
  return parseAccessBirthDate(raw, { referenceYear }).iso;
}

/** YCN Y/N/D flag -> boolean (Y true; N/D/empty false). */
function ynToBool(raw: string | undefined): boolean {
  return (raw ?? "").trim().toUpperCase().startsWith("Y");
}

/** YCN Y/N flag -> boolean, or undefined when blank. */
function ynOptional(raw: string | undefined): boolean | undefined {
  const text = (raw ?? "").trim().toUpperCase();
  if (text.startsWith("Y")) return true;
  if (text.startsWith("N")) return false;
  return undefined;
}

/** A row is "current" when its REVISE_DT_TM is null / the YCN sentinel. */
export function isCurrentRow(row: YcnRow): boolean {
  return isYcnNullDate(pick(row, "REVISE_DT_TM"));
}

function entId(row: YcnRow): string | undefined {
  return pick(row, "ENT_ID");
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

function compact<T extends BundlePayload>(payload: T): T {
  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0 && key !== "sourceExternalIds")) delete payload[key];
  }
  return payload;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** Tables keyed by ENT_ID (PEOPLE_DIRECTORY is global and has none). */
const ENTITY_TABLES = [
  "DB_GLOB_CORP_NAME", "DB_GLOB_CONSTATING", "DB_GLOB_REG_OFFICE", "DB_GLOB_REC_OFFICE", "DB_GLOB_BUS_ADDRESS",
  "DB_GLOB_REG_FILING", "DB_GLOB_CORP_SETTINGS", "DB_GLOB_DIRECTOR", "DB_GLOB_OFFICER", "DB_GLOB_SHARE_CAPTL",
  "DB_GLOB_SHARE_TRANS", "DB_GLOB_DIVIDEND", "DB_GLOB_TRANSPARENCY_REG", "DB_GLOB_TRANSPARENCY_DUE",
  "DB_GLOB_SERVICE_PROVIDERS", "DB_GLOB_CORP_ASSETS", "DB_GLOB_ENT_PEOPLE",
] as const;

export interface YcnEntitySummary {
  entityId: string;
  /** Latest current CORP_NAME, when the entity has one. */
  name?: string;
  formerNames: string[];
  /** Current (not superseded) rows per table. */
  rowCounts: Record<string, number>;
}

/** Every entity in the database, with its current name and row counts. */
export function listYcnEntities(tables: YcnTables): YcnEntitySummary[] {
  const byId = new Map<string, YcnEntitySummary>();
  for (const table of ENTITY_TABLES) {
    for (const row of rowsOf(tables, table)) {
      const id = entId(row);
      if (!id) continue;
      const summary = byId.get(id) ?? { entityId: id, formerNames: [], rowCounts: {} };
      if (table === "DB_GLOB_ENT_PEOPLE" || isCurrentRow(row)) {
        summary.rowCounts[table] = (summary.rowCounts[table] ?? 0) + 1;
      }
      byId.set(id, summary);
    }
  }
  for (const summary of byId.values()) {
    const names = rowsOf(tables, "DB_GLOB_CORP_NAME")
      .filter((row) => entId(row) === summary.entityId && isCurrentRow(row))
      .sort((a, b) => String(pickDate(a, "START_DT_TM") ?? "").localeCompare(String(pickDate(b, "START_DT_TM") ?? "")));
    summary.name = pick(names[names.length - 1] ?? {}, "CORP_NAME");
    summary.formerNames = names.slice(0, -1).map((row) => pick(row, "CORP_NAME")).filter(Boolean) as string[];
  }
  return [...byId.values()].sort((a, b) => a.entityId.localeCompare(b.entityId));
}

/** Resolve which entity to import, or throw with the list of entities. */
export function resolveYcnEntity(tables: YcnTables, requested?: string): YcnEntitySummary {
  const entities = listYcnEntities(tables);
  const describe = () => entities.map((e) => `  ${e.entityId}${e.name ? `  ${e.name}` : ""}`).join("\n");
  if (requested) {
    const hit = entities.find((e) => e.entityId === requested.trim());
    if (!hit) throw new Error(`Entity ${requested} is not in this database. Entities:\n${describe()}`);
    return hit;
  }
  if (entities.length === 1) return entities[0];
  if (entities.length === 0) throw new Error("This database has no YCN entity rows.");
  throw new Error(`This database holds ${entities.length} entities; import one at a time with --entity <ENT_ID>:\n${describe()}`);
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const PROVINCES: Record<string, string> = {
  "BRITISH COLUMBIA": "BC", ALBERTA: "AB", SASKATCHEWAN: "SK", MANITOBA: "MB", ONTARIO: "ON", QUEBEC: "QC",
  "NEW BRUNSWICK": "NB", "NOVA SCOTIA": "NS", "PRINCE EDWARD ISLAND": "PE", "NEWFOUNDLAND AND LABRADOR": "NL",
  YUKON: "YT", "NORTHWEST TERRITORIES": "NT", NUNAVUT: "NU",
};
const PROVINCE_CODES = new Set(Object.values(PROVINCES));

export interface SplitAddress {
  street?: string;
  city?: string;
  provinceState?: string;
  postalCode?: string;
  country?: string;
}

/**
 * Split a YCN single-string address ("123 Example St, Exampleton, BC Canada V1A 2B3")
 * into parts. Best effort: anything not recognised stays in `street`.
 */
export function splitYcnAddress(text: string | undefined): SplitAddress {
  const combined = (text ?? "").trim();
  if (!combined) return {};
  const out: SplitAddress = {};
  let rest = combined;
  const ca = rest.match(/\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b\s*$/i);
  const us = rest.match(/\b(\d{5}(?:-\d{4})?)\s*$/);
  if (ca) {
    out.postalCode = `${ca[1]} ${ca[2]}`.toUpperCase();
    out.country = "Canada";
    rest = rest.slice(0, ca.index).trim();
  } else if (us) {
    out.postalCode = us[1];
    rest = rest.slice(0, us.index).trim();
  }
  rest = rest.replace(/[,\s]+$/, "");
  const countryMatch = rest.match(/[,\s]+(Canada|USA|U\.S\.A?\.?|United States)\s*$/i);
  if (countryMatch) {
    out.country = /canada/i.test(countryMatch[1]) ? "Canada" : "United States";
    rest = rest.slice(0, countryMatch.index).trim();
  }
  const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const provinceName = PROVINCES[last.toUpperCase()];
    const lastToken = last.split(/\s+/).pop()?.toUpperCase() ?? "";
    if (provinceName || PROVINCE_CODES.has(last.toUpperCase())) {
      out.provinceState = provinceName ?? last.toUpperCase();
      parts.pop();
    } else if (PROVINCE_CODES.has(lastToken) && parts.length >= 2 && last.split(/\s+/).length > 1) {
      // "Exampleton BC" in one part.
      out.provinceState = lastToken;
      parts[parts.length - 1] = last.slice(0, last.length - lastToken.length).trim();
    } else if (/^[A-Z]{2}$/.test(last)) {
      out.provinceState = last;
      parts.pop();
      if (!out.country) out.country = "United States";
    }
  }
  if (out.provinceState && PROVINCE_CODES.has(out.provinceState) && !out.country) out.country = "Canada";
  if (parts.length >= 2) {
    out.city = parts.pop();
    out.street = parts.join(", ");
  } else {
    out.street = parts[0] ?? combined;
  }
  return out;
}

const ADDRESS_TABLES = [
  { table: "DB_GLOB_REG_OFFICE", type: "registered_office", label: "registered office" },
  { table: "DB_GLOB_REC_OFFICE", type: "records_office", label: "records office" },
  { table: "DB_GLOB_BUS_ADDRESS", type: "physical", label: "business address" },
] as const;

/**
 * Office history (BCA ss. 35, 42): each row starts on START_DT_TM and ends when
 * the next row of the same kind starts. The latest row is `current`.
 */
function addressPayloads(rows: YcnRow[], type: string, label: string, ent: string): BundlePayload[] {
  const sorted = [...rows].sort((a, b) =>
    String(pickDay(a, "START_DT_TM") ?? "").localeCompare(String(pickDay(b, "START_DT_TM") ?? ""))
      || (toNumber(pick(a, "REG_POSN")) ?? 0) - (toNumber(pick(b, "REG_POSN")) ?? 0));
  return sorted.map((row, index) => {
    const lines = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => pick(row, `ADDRESS_${n}`)).filter(Boolean) as string[];
    const single = pick(row, "ADDRESS");
    // A business address is free-form lines; the first is often an addressee, not a street.
    const addressee = !single && lines.length >= 3 && !/\d/.test(lines[0]) ? lines[0] : undefined;
    const parseable = single ?? (addressee ? lines.slice(1) : lines).join(", ");
    const split = splitYcnAddress(parseable);
    const effectiveFrom = pickDay(row, "START_DT_TM");
    const next = sorted[index + 1];
    const effectiveTo = next ? pickDay(next, "START_DT_TM") : undefined;
    const contactName = pick(row, "CONTACT_1");
    const contacts = contactName ? [{ name: contactName, ...(pick(row, "CONTACT_2") ? { role: pick(row, "CONTACT_2") } : {}) }] : undefined;
    return compact({
      type,
      status: effectiveTo ? "past" : "current",
      effectiveFrom,
      effectiveTo,
      street: split.street,
      city: split.city,
      provinceState: split.provinceState,
      postalCode: split.postalCode,
      country: split.country,
      address: parseable || undefined,
      freeformLines: lines.length ? lines : undefined,
      contacts,
      notes: [`YCN ${label}${addressee ? ` (addressed to ${addressee})` : ""}.`, single && !split.city ? `Recorded as: ${single}` : undefined].filter(Boolean).join(" "),
      confidence: split.city ? "High" : undefined,
      sourceExternalIds: [`ycn:${type}-address:${ent}:${dbId(row)}`],
    });
  });
}

// ---------------------------------------------------------------------------
// People (ENT_PEOPLE roster)
// ---------------------------------------------------------------------------

/** One effective-dated window of a person's particulars on an entity's roster. */
export interface RosterParticulars {
  personId: string;
  globalId?: string;
  from?: string;
  to?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  address?: string;
  individual?: boolean;
  atAgeOfMajority?: boolean;
  gender?: string;
  corpSign?: string;
  signOrder?: number;
}

export type RosterIndex = Map<string, RosterParticulars[]>;

/** The entity's roster: PERS_ID → its particulars windows, oldest first. */
export function buildRoster(rows: YcnRow[]): RosterIndex {
  const index: RosterIndex = new Map();
  for (const row of rows) {
    const personId = pick(row, "PERS_ID");
    if (!personId) continue;
    const list = index.get(personId) ?? [];
    list.push({
      personId,
      globalId: pick(row, "GLOB_ID"),
      from: pickDay(row, "INFO_STR"),
      to: pickDay(row, "INFO_END"),
      fullName: pick(row, "FULL_NAME"),
      firstName: pick(row, "FIRST_NAME"),
      lastName: pick(row, "LAST_NAME"),
      address: pick(row, "ADDRESS"),
      individual: ynOptional(pick(row, "INDIVIDUAL")),
      atAgeOfMajority: ynOptional(pick(row, "MAJORITY")),
      gender: normalizeGender(pick(row, "GENDER")),
      corpSign: pick(row, "CORP_SIGN"),
      signOrder: toNumber(pick(row, "SIGN_ORDER")),
    });
    index.set(personId, list);
  }
  for (const list of index.values()) list.sort((a, b) => String(a.from ?? "").localeCompare(String(b.from ?? "")));
  return index;
}

/**
 * The particulars in effect on `date` (YYYY-MM-DD): the window covering it, else
 * the latest window that started before it, else the earliest window.
 */
export function particularsAt(roster: RosterIndex, personId: string | undefined, date?: string): RosterParticulars | undefined {
  if (!personId) return undefined;
  const list = roster.get(personId);
  if (!list?.length) return undefined;
  if (!date) return list[list.length - 1];
  const covering = list.filter((p) => (!p.from || p.from <= date) && (!p.to || p.to >= date));
  if (covering.length) return covering[covering.length - 1];
  const before = list.filter((p) => !p.from || p.from <= date);
  return before.length ? before[before.length - 1] : list[0];
}

/** Earlier particulars of a person, as a review note (dated name/address history on this roster). */
function particularsHistoryNote(roster: RosterIndex, personId: string | undefined, used: RosterParticulars | undefined): string | undefined {
  if (!personId) return undefined;
  const list = roster.get(personId) ?? [];
  if (list.length < 2) return undefined;
  const lines = list.map((p) => `${p.from ?? "?"} to ${p.to ?? "open"}: ${p.fullName ?? "(no name)"}${p.address ? `, ${p.address}` : ""}${p === used ? " (used here)" : ""}`);
  return `YCN roster particulars for ${personId} on this entity:\n${lines.join("\n")}`;
}

function personFields(particulars: RosterParticulars | undefined, fallbackName: string | undefined): BundlePayload {
  const split = splitYcnAddress(particulars?.address);
  return {
    fullName: particulars?.fullName ?? fallbackName,
    firstName: particulars?.firstName,
    lastName: particulars?.lastName,
    street: split.street,
    city: split.city,
    provinceState: split.provinceState,
    postalCode: split.postalCode,
    country: split.country,
    gender: particulars?.gender,
    nonNaturalPerson: particulars?.individual === false ? true : undefined,
    ageOver18: particulars?.individual !== false ? particulars?.atAgeOfMajority : undefined,
    ycnPersonId: particulars?.personId,
    ycnGlobalId: particulars?.globalId,
  };
}

/** The day whose particulars a register row shows: the end of office if it ended, else today. */
function particularsDay(endDay: string | undefined, referenceDate: string): string {
  return endDay && endDay < referenceDate ? endDay : referenceDate;
}

// ---------------------------------------------------------------------------
// Per-table mappers
// ---------------------------------------------------------------------------

/** ISS_TYP / share-transaction type → Societyer transferType vocabulary. */
export function mapShareTransferType(raw: string | undefined): string {
  const type = ycnIssueType(raw);
  if (type === "allot") return "issuance";
  if (type === "redemption") return "redemption";
  if (type === "cancellation") return "cancellation";
  if (type === "subdivision") return "subdivision";
  if (type === "consolidation") return "consolidation";
  if (type === "certificate") return "replacement_certificate";
  return "transfer";
}

/** OFFICER row → office codes: PRES and SECR can both be set, plus a free-text OTHER. */
export function officerTitles(row: YcnRow): { officerTitle: string; additionalOfficerTitles: string[]; freeText?: string } {
  const titles: string[] = [];
  if (ynToBool(pick(row, "PRES"))) titles.push("president");
  if (ynToBool(pick(row, "SECR"))) titles.push("secretary");
  const other = pick(row, "OTHER");
  let freeText: string | undefined;
  if (other) {
    const code = normalizeOptionValue("officerTitles", other);
    if (code && isAllowedOption("officerTitles", code)) titles.push(code);
    else freeText = other;
  }
  // A free-text office keeps its own wording in the additional titles; the coded title is "other".
  if (!titles.length) return { officerTitle: "other", additionalOfficerTitles: freeText ? [freeText] : [], freeText };
  return { officerTitle: titles[0], additionalOfficerTitles: [...titles.slice(1), ...(freeText ? [freeText] : [])], freeText };
}

/** Citizenship text ("Yes", "No", "Ireland/U.S.") → country list and a note. */
export function parseCitizenship(raw: string | undefined): { countries: string[]; note?: string } {
  const text = (raw ?? "").trim();
  if (!text) return { countries: [] };
  if (/^(y|yes)$/i.test(text)) return { countries: [], note: "YCN: citizen or permanent resident of Canada (Yes)." };
  if (/^(n|no)$/i.test(text)) return { countries: [], note: "YCN: not a citizen or permanent resident of Canada (No)." };
  const countries = text.split(/\s*(?:\/|,|;|&|\band\b)\s*/i).map((c) => c.trim()).filter(Boolean)
    .map((c) => (/^(u\.?s\.?a?\.?|united states( of america)?|america)$/i.test(c) ? "United States" : /^(u\.?k\.?|great britain)$/i.test(c) ? "United Kingdom" : c));
  return { countries, note: `YCN citizenship: ${text}` };
}

/** YCN FUNCTION label → serviceProviders.function enum. */
export function mapServiceFunction(raw: string | undefined): string {
  const text = (raw ?? "").trim().toLowerCase();
  if (text.startsWith("auditor")) return "auditor";
  if (text.startsWith("lawyer") || text.startsWith("legal") || text.startsWith("corp_rec")) return "lawyer";
  if (text.startsWith("account")) return "accountant";
  if (text.startsWith("bank")) return "banker";
  if (text.startsWith("transfer")) return "transfer_agent";
  if (text.startsWith("registered") || text.startsWith("agent")) return "registered_agent";
  return "other";
}

/** YCN REG_ACTION → constatingEvents.action enum. */
export function mapConstatingAction(raw: string | undefined): string {
  const text = (raw ?? "").trim().toLowerCase();
  for (const action of ["incorporated", "transitioned", "continued", "amalgamated", "restated"]) {
    if (text.includes(action.slice(0, 6))) return action;
  }
  return "other";
}

/** Province/territory name → the jurisdiction code used by filings ("CA-BC"); other names unchanged. */
export function ledgerJurisdiction(raw: string | undefined): string | undefined {
  const text = (raw ?? "").trim();
  if (!text) return undefined;
  const code = PROVINCES[text.toUpperCase()] ?? (PROVINCE_CODES.has(text.toUpperCase()) ? text.toUpperCase() : undefined);
  if (code) return `CA-${code}`;
  if (/^(canada|federal)$/i.test(text)) return "CA-FED-CBCA";
  return text;
}

/** REGN_NAT → organizationRegistrations.registrationType. */
function registrationType(nature: string | undefined): string | undefined {
  const text = (nature ?? "").toLowerCase();
  if (!text) return undefined;
  if (text.includes("xp") || text.includes("extra")) return "extra_provincial";
  return "home";
}

/**
 * REG_FILING holds two things: registrations (REGN_YN = Y) and the annual
 * filing for a year (FILE_YEAR). A transition or continuation under a new Act
 * keeps the same registration, so it is folded into that registration's notes
 * instead of becoming a second (duplicate) registration.
 */
function registrationAndFilingPayloads(rows: YcnRow[], ent: string, warnings: string[]): { registrations: BundlePayload[]; filings: BundlePayload[] } {
  const registrationRows = rows.filter((row) => ynToBool(pick(row, "REGN_YN")) || pick(row, "REGN_NAT") || pick(row, "REGN_NUM"));
  const filingRows = rows.filter((row) => !registrationRows.includes(row) && pick(row, "FILE_YEAR"));
  const groups = new Map<string, YcnRow[]>();
  for (const row of registrationRows) {
    const key = `${(pick(row, "JURISDICTION") ?? "").toLowerCase()}|${pick(row, "REGN_NUM") ?? ""}|${registrationType(pick(row, "REGN_NAT"))}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const registrations = [...groups.values()].map((group) => {
    const sorted = group.sort((a, b) => String(pickDay(a, "REGN_DT_TM") ?? "").localeCompare(String(pickDay(b, "REGN_DT_TM") ?? "")));
    const first = sorted[0];
    const jurisdictionName = pick(first, "JURISDICTION");
    const jurisdiction = normalizeOptionValue("entityJurisdictions", jurisdictionName);
    const history = sorted.map((row) => `${pick(row, "REGN_NAT") ?? "Registration"}${pick(row, "REGN_LEG") ? ` under the ${pick(row, "REGN_LEG")}` : ""}${pickDay(row, "REGN_DT_TM") ? ` on ${pickDay(row, "REGN_DT_TM")}` : ""}`);
    const type = registrationType(pick(first, "REGN_NAT"));
    return compact({
      jurisdiction: jurisdiction && isAllowedOption("entityJurisdictions", jurisdiction) ? jurisdiction : jurisdictionName,
      registrationType: type,
      registrationNumber: pick(first, "REGN_NUM"),
      registrationDate: pickDay(first, "REGN_DT_TM"),
      notes: `YCN registration history: ${history.join("; ")}.`,
      confidence: "High",
      sourceExternalIds: [`ycn:registration:${ent}:${dbId(first)}`],
    });
  });
  const filings = filingRows.map((row) => {
    const year = pick(row, "FILE_YEAR");
    const filed = ynToBool(pick(row, "FILE_YN"));
    const date = pickDay(row, "FILE_DT_TM");
    if (!filed && date) warnings.push(`Annual filing ${pick(row, "JURISDICTION")} ${year}: a date (${date}) is recorded but the filing is not marked filed; it is imported as not filed.`);
    if (filed && !date) warnings.push(`Annual filing ${pick(row, "JURISDICTION")} ${year} is marked filed with no date; add the filed-on date in review.`);
    return compact({
      jurisdiction: ledgerJurisdiction(pick(row, "JURISDICTION")),
      year,
      filed,
      filedOn: filed ? date : undefined,
      confidence: filed && !date ? undefined : "High",
      sourceExternalIds: [`ycn:annual-filing:${ent}:${dbId(row)}`],
    });
  });
  return { registrations, filings };
}

/** VOTING (numeric or Y/N; mdb-export can't read the Access decimal) → votes per share. */
function votesPerShare(row: YcnRow): { votesPerShare?: number; inferred: boolean } {
  const voting = pick(row, "VOTING");
  const n = toNumber(voting);
  if (n !== undefined && n >= 0) return { votesPerShare: n, inferred: false };
  const flag = ynOptional(voting);
  if (flag !== undefined) return { votesPerShare: flag ? 1 : 0, inferred: false };
  const description = `${pick(row, "SHR_DESC") ?? ""} ${pick(row, "SHR_SINGLE") ?? ""}`;
  if (/non[-\s]?voting/i.test(description)) return { votesPerShare: 0, inferred: true };
  if (/\bvoting\b/i.test(description)) return { votesPerShare: 1, inferred: true };
  return { inferred: false };
}

function shareClassPayload(row: YcnRow, ent: string): BundlePayload {
  const votes = votesPerShare(row);
  const ended = pickDay(row, "CANCEL_DT_TM");
  return compact({
    className: pick(row, "SHR_DESC", "CLASS"),
    singularForm: pick(row, "SHR_SINGLE"),
    classType: "share",
    status: ended ? "inactive" : "active",
    idPrefix: pick(row, "CLASS"),
    votesPerShare: votes.votesPerShare,
    votingRights: votes.votesPerShare === undefined ? undefined : votes.votesPerShare === 0 ? "Non-voting" : `${votes.votesPerShare} vote(s) per share`,
    startDate: pickDay(row, "CREATION_DT_TM"),
    endDate: ended,
    notes: votes.inferred ? "Votes per share inferred from the class name (the YCN VOTING column could not be read); confirm against the articles." : undefined,
    confidence: votes.inferred ? undefined : "High",
    sourceExternalIds: [`ycn:share-class:${ent}:${pick(row, "CLASS") ?? dbId(row)}`],
  });
}

function assetPayload(row: YcnRow, ent: string): BundlePayload {
  const disposed = pickDay(row, "DISP_DT_TM");
  return compact({
    assetTag: pick(row, "ASSET_ID") ?? `ycn-asset-${ent}-${dbId(row)}`,
    name: pick(row, "ASSET_DESC"),
    category: pick(row, "ASSET_TYPE"),
    quantityOnHand: toNumber(pick(row, "ASSET_QUANT")),
    purchaseDate: pickDay(row, "ACQ_DT_TM"),
    purchaseValueCents: parseMoneyCents(pick(row, "ACQ_COST")),
    currency: mapYcnCurrency(pick(row, "ACQ_CURRENCY"))?.toUpperCase() ?? pick(row, "ACQ_CURRENCY"),
    acquisitionCurrency: pick(row, "ACQ_CURRENCY"),
    acquiredFrom: pick(row, "ACQ_FROM"),
    acquisitionComments: pick(row, "ACQ_COMMENTS"),
    assetJurisdiction: pick(row, "ASSET_JUR"),
    disposedAt: disposed,
    disposalValueCents: parseMoneyCents(pick(row, "DISP_PRICE")),
    dispositionCurrency: pick(row, "DISP_CURRENCY"),
    disposedTo: pick(row, "DISP_TO"),
    dispositionComments: pick(row, "DISP_COMMENTS"),
    status: disposed ? "disposed" : "in_service",
    confidence: "High",
    sourceExternalIds: [`ycn:asset:${ent}:${dbId(row)}`],
  });
}

/** One SHARE_TRANS row decoded for the certificate → ledger conversion. */
export function toYcnShareRow(row: YcnRow): YcnShareRow {
  const repl = pick(row, "SHR_CERT_REPL");
  return {
    rowId: dbId(row),
    issuedOn: pickDate(row, "ISS_DT_TM") ?? "",
    cancelledOn: pickDate(row, "CANCEL_DT_TM"),
    holderId: pick(row, "HLDR_ID") ?? (pick(row, "HLDR_NAME") ? `name:${pick(row, "HLDR_NAME")}` : ""),
    holderName: pick(row, "HLDR_NAME"),
    classCode: pick(row, "SHR_CLASS") ?? "",
    shares: toNumber(pick(row, "SHR_NUM")) ?? 0,
    certificate: pick(row, "SHR_CERT"),
    // SHR_CERT_REPL is a forward pointer; the literal "Replacement" only marks a replacement row.
    replacedBy: repl && !/^replacement$/i.test(repl) ? repl : undefined,
    issueType: ycnIssueType(pick(row, "ISS_TYP")),
    considerationCents: parseMoneyCents(pick(row, "SHR_CONSID_AMT")),
    considerationCurrency: mapYcnCurrency(pick(row, "SHR_CONSID_CUR")),
    considerationType: pick(row, "SHR_CONSID_TYP"),
  };
}

/** One entity's current SHARE_TRANS rows, decoded. */
export function ycnShareRows(tables: YcnTables, entityId: string): YcnShareRow[] {
  return rowsOf(tables, "DB_GLOB_SHARE_TRANS").filter((row) => entId(row) === entityId && isCurrentRow(row)).map(toYcnShareRow);
}

// ---------------------------------------------------------------------------
// Bundle builder
// ---------------------------------------------------------------------------

/**
 * Build a Societyer import bundle for ONE entity of a YCN Access database.
 * Throws (listing the entities) when the database holds several and no
 * `entityId` is given.
 */
export function buildBundleFromAccessTables(tables: YcnTables, options: BuildBundleOptions = {}): YcnImportBundle {
  const entity = resolveYcnEntity(tables, options.entityId);
  const ent = entity.entityId;
  const referenceDate = options.referenceDate ?? todayISO();
  const referenceYear = Number(referenceDate.slice(0, 4));
  const warnings: string[] = [];
  const current = (name: string) => rowsOf(tables, name).filter((row) => entId(row) === ent && isCurrentRow(row));

  const roster = buildRoster(rowsOf(tables, "DB_GLOB_ENT_PEOPLE").filter((row) => entId(row) === ent));
  const statusFor = (endDay?: string) => (endDay && endDay <= referenceDate ? "former" : "current");

  // Directors: name and address from the roster, link to the directory person.
  const directors = current("DB_GLOB_DIRECTOR").map((row) => {
    const personId = pick(row, "ID");
    const startDate = pickDay(row, "APPOINT_DT_TM");
    const endDate = pickDay(row, "REMOVE_DT_TM");
    const particulars = particularsAt(roster, personId, particularsDay(endDate, referenceDate));
    if (personId && !particulars) warnings.push(`Director row ${dbId(row)} names ${personId}, who is not on the entity's roster; the address is missing.`);
    return compact({
      roleType: "director",
      status: statusFor(endDate),
      ...personFields(particulars, pick(row, "Name", "NAME")),
      startDate,
      endDate,
      notes: particularsHistoryNote(roster, personId, particulars),
      confidence: "High",
      sourceExternalIds: [`ycn:director:${ent}:${dbId(row)}`],
    });
  });

  const officers = current("DB_GLOB_OFFICER").map((row) => {
    const personId = pick(row, "ID");
    const startDate = pickDay(row, "APPOINT_DT_TM");
    const endDate = pickDay(row, "REMOVE_DT_TM");
    const particulars = particularsAt(roster, personId, particularsDay(endDate, referenceDate));
    const titles = officerTitles(row);
    if (titles.officerTitle === "other" && !titles.freeText) warnings.push(`Officer row ${dbId(row)} holds no office (no PRES, SECR or OTHER).`);
    return compact({
      roleType: "officer",
      status: statusFor(endDate),
      ...personFields(particulars, pick(row, "Name", "NAME")),
      officerTitle: titles.officerTitle,
      additionalOfficerTitles: titles.additionalOfficerTitles,
      startDate,
      endDate,
      notes: [titles.freeText ? `Office as recorded in YCN: ${titles.freeText}.` : undefined, particularsHistoryNote(roster, personId, particulars)].filter(Boolean).join("\n") || undefined,
      confidence: "High",
      sourceExternalIds: [`ycn:officer:${ent}:${dbId(row)}`],
    });
  });

  const controllers = current("DB_GLOB_TRANSPARENCY_REG").map((row) => {
    const ended = pickDay(row, "END_DT");
    const citizenship = parseCitizenship(pick(row, "CITIZEN"));
    const split = splitYcnAddress(pick(row, "ADDRESS"));
    return compact({
      roleType: "controller",
      status: ended ? "former" : "current",
      fullName: stripLeadingNumber(pick(row, "NAME")),
      street: split.street,
      city: split.city,
      provinceState: split.provinceState,
      postalCode: split.postalCode,
      country: split.country,
      dateOfBirth: pickDay(row, "BIRTH"),
      citizenshipCountries: citizenship.countries,
      taxResidentHomeJurisdiction: mapYesNoUnknown(pick(row, "TAX_RESIDENT_YN")),
      significanceReason: pick(row, "REASON"),
      startDate: pickDay(row, "START_DT"),
      endDate: ended,
      notes: citizenship.note,
      confidence: "High",
      sourceExternalIds: [`ycn:transparency:${ent}:${dbId(row)}`],
    });
  });

  // Share capital and the certificate register.
  const classRows = current("DB_GLOB_SHARE_CAPTL");
  const rightsClasses = classRows.map((row) => shareClassPayload(row, ent));
  const classNames = new Map(classRows.map((row) => [pick(row, "CLASS") ?? "", pick(row, "SHR_DESC") ?? pick(row, "CLASS") ?? ""]));
  const shareRows = current("DB_GLOB_SHARE_TRANS").map(toYcnShareRow);
  for (const code of new Set(shareRows.map((row) => row.classCode))) {
    if (code && !classNames.has(code)) warnings.push(`Share class ${code} is used in the register but not in the share capital table.`);
  }
  const conversion = convertYcnShareRegister(shareRows, { cancellationKind: options.cancellationKind });
  const holderName = (holderId: string | undefined) => {
    if (!holderId) return undefined;
    // The holder's current name on the roster, so one person keeps one holding across a change of name.
    return particularsAt(roster, holderId, referenceDate)?.fullName
      ?? shareRows.filter((row) => row.holderId === holderId).map((row) => row.holderName).filter(Boolean).pop()
      ?? holderId.replace(/^name:/, "");
  };
  const holderRef = (holderId: string | undefined) => (holderId ? `ycn:shareholder:${ent}:${holderId}` : undefined);
  const transferStatus = conversion.clean ? "posted" : "needs_review";
  const rightsholdingTransfers = conversion.movements.map((m) => compact({
    transferType: m.transferType,
    status: transferStatus,
    transferDate: m.transferDate,
    rightsClassName: classNames.get(m.classCode) ?? m.classCode,
    rightsClassCode: m.classCode,
    rightsClassExternalId: `ycn:share-class:${ent}:${m.classCode}`,
    sourceHolderName: holderName(m.sourceHolderId),
    destinationHolderName: holderName(m.destinationHolderId),
    sourceHolderExternalId: holderRef(m.sourceHolderId),
    destinationHolderExternalId: holderRef(m.destinationHolderId),
    quantity: m.quantity,
    considerationType: m.considerationType,
    priceToOrganizationCents: m.priceToOrganizationCents,
    priceToOrganizationCurrency: m.priceToOrganizationCents !== undefined ? m.priceToOrganizationCurrency : undefined,
    notes: [
      `From the YCN certificate register (rows ${m.rowIds.join(", ") || "n/a"}${m.certificates.length ? `; certificates ${m.certificates.join(", ")}` : ""}).`,
      m.note,
      conversion.clean ? undefined : "The register did not reconcile cleanly; see the import report before posting.",
    ].filter(Boolean).join(" "),
    confidence: conversion.clean && !m.note ? "High" : undefined,
    sourceExternalIds: [`ycn:share-ledger:${ent}:${m.key}`],
  }));
  const shareCertificates = conversion.certificates.map((c) => compact({
    certificateNumber: c.certificateNumber,
    holderName: particularsAt(roster, c.holderId, c.issuedOn)?.fullName ?? c.holderName ?? holderName(c.holderId),
    shareClass: classNames.get(c.classCode) ?? c.classCode,
    shares: c.shares,
    issuedOn: c.issuedOn,
    replacesCertificateNumber: c.replacesCertificateNumber,
    cancelledOn: c.cancelledOn,
    confidence: "High",
    sourceExternalIds: [`ycn:share-cert:${ent}:${c.rowId}`],
  }));

  // One shareholder role holder per holder (stable identity, address for the securities register).
  const shareholders = [...new Set(shareRows.map((row) => row.holderId).filter(Boolean))].sort().map((holderId) => {
    const rowsForHolder = shareRows.filter((row) => row.holderId === holderId);
    const firstDay = rowsForHolder.map((row) => row.issuedOn.slice(0, 10)).filter(Boolean).sort()[0];
    const stillHolds = conversion.movements.reduce((sum, m) =>
      sum + (m.destinationHolderId === holderId ? m.quantity : 0) - (m.sourceHolderId === holderId ? m.quantity : 0), 0) > 0;
    const lastDay = [...rowsForHolder.map((row) => row.cancelledOn?.slice(0, 10)), ...rowsForHolder.map((row) => row.issuedOn.slice(0, 10))]
      .filter(Boolean).sort().pop();
    const particulars = particularsAt(roster, holderId.startsWith("name:") ? undefined : holderId, referenceDate);
    return compact({
      roleType: "shareholder",
      status: stillHolds ? "current" : "former",
      ...personFields(particulars, holderName(holderId)),
      fullName: holderName(holderId),
      startDate: firstDay,
      endDate: stillHolds ? undefined : lastDay,
      notes: particularsHistoryNote(roster, particulars?.personId, particulars),
      confidence: "High",
      sourceExternalIds: [holderRef(holderId)!],
    });
  });

  const { registrations, filings } = registrationAndFilingPayloads(current("DB_GLOB_REG_FILING"), ent, warnings);
  const organizationAddresses = ADDRESS_TABLES.flatMap(({ table, type, label }) => addressPayloads(current(table), type, label, ent));

  // Directory people: only those on this entity's roster (the directory is global).
  const rosterGlobalIds = new Set([...roster.values()].flatMap((list) => list.map((p) => p.globalId)).filter(Boolean));
  const directoryPeople = rowsOf(tables, "DB_GLOB_PEOPLE_DIRECTORY")
    .filter((row) => rosterGlobalIds.has(pick(row, "GLOB_ID")))
    .map((row) => {
      const atAgeOfMajority = ynOptional(pick(row, "INDIV_CUR_MAJ"));
      const isIndividual = ynToBool(pick(row, "INDIVIDUAL"));
      const birth = isIndividual ? parseAccessBirthDate(pick(row, "INDIV_DOB"), { referenceYear, atAgeOfMajority }) : { ambiguous: false } as ParsedBirthDate;
      if (birth.ambiguous) warnings.push(`Directory person ${pick(row, "GLOB_ID")}: ${birth.note}.`);
      return compact({
        globalId: pick(row, "GLOB_ID"),
        fullName: pick(row, "FULL_NAME") ?? pick(row, "SEARCH_NAME") ?? "Imported person",
        firstName: pick(row, "FIRST_NAME"),
        lastName: pick(row, "LAST_NAME"),
        dob: birth.iso,
        dobNeedsReview: birth.ambiguous || undefined,
        isIndividual,
        gender: normalizeGender(pick(row, "INDIV_CUR_GENDER")),
        defaultAddress: pick(row, "ADDRESS"),
        isServiceProvider: ynToBool(pick(row, "SERVICE_PROVIDER")),
        atAgeOfMajority,
        corpSign: pick(row, "CORP_SIGN"),
      });
    });

  const serviceProviders = current("DB_GLOB_SERVICE_PROVIDERS").map((row) => {
    const fn = pick(row, "FUNCTION");
    return compact({
      function: mapServiceFunction(fn),
      firmName: pick(row, "FIRM_NAME"),
      contactName: pick(row, "CONTACT_NAME"),
      firmLocation: pick(row, "FIRM_LOCATION"),
      appointedOn: pickDay(row, "APPOINT_DT_TM"),
      removedOn: pickDay(row, "REMOVE_DT_TM"),
      notes: /^corp_rec/i.test(fn ?? "") ? "YCN: corporate records lawyer." : undefined,
      sourceExternalIds: [`ycn:service-provider:${ent}:${dbId(row)}`],
    });
  });

  const report: YcnImportReport = {
    entityId: ent,
    shareConversion: {
      clean: conversion.clean,
      movements: conversion.movements.length,
      certificates: conversion.certificates.length,
      reconciledDates: conversion.reconciliation.dates,
      checkedPoints: conversion.reconciliation.checkedPoints,
      mismatches: conversion.reconciliation.mismatches.length,
      issues: conversion.issues,
    },
    warnings,
  };

  return {
    metadata: {
      name: options.name || `YCN Access import — ${entity.name ?? ent}`,
      createdFrom: "YCN/Access",
      ycnEntityId: ent,
      ycnEntityName: entity.name,
    },
    roleHolders: [...directors, ...officers, ...shareholders, ...controllers],
    rightsClasses,
    rightsholdingTransfers,
    organizationRegistrations: registrations,
    annualFilingLedger: filings,
    organizationAddresses,
    serviceProviders,
    dividends: current("DB_GLOB_DIVIDEND").map((row) => compact({
      declaredOn: pickDay(row, "DECLARE_DT_TM"),
      shareClass: pick(row, "CLASS"),
      perShareCents: parseMoneyCents(pick(row, "DIV_PER_SHARE")),
      sharesOutstanding: toNumber(pick(row, "SHR_TOTAL")),
      currency: pick(row, "DIV_CURRENCY"),
      totalCents: parseMoneyCents(pick(row, "DIV_TOTAL")),
      sourceExternalIds: [`ycn:dividend:${ent}:${dbId(row)}`],
    })),
    nameHistory: current("DB_GLOB_CORP_NAME").map((row) => compact({
      name: pick(row, "CORP_NAME"),
      shortName: pick(row, "SHORT_NAME"),
      startISO: pickDay(row, "START_DT_TM"),
      regPosn: toNumber(pick(row, "REG_POSN")),
      sourceExternalIds: [`ycn:corp-name:${ent}:${dbId(row)}`],
    })),
    constatingEvents: current("DB_GLOB_CONSTATING").map((row) => compact({
      action: mapConstatingAction(pick(row, "REG_ACTION")),
      jurisdiction: pick(row, "JURISDICTION"),
      legislation: pick(row, "LEGISLATION"),
      regNumber: pick(row, "REG_NUMBER"),
      startISO: pickDay(row, "START_DT_TM"),
      sourceExternalIds: [`ycn:constating:${ent}:${dbId(row)}`],
    })),
    significantIndividualSteps: current("DB_GLOB_TRANSPARENCY_DUE").map((row) => compact({
      individualName: stripLeadingNumber(pick(row, "NAME")),
      stepsNarrative: pick(row, "STEPS"),
      stepDate: pickDay(row, "STEP_DT"),
      sourceExternalIds: [`ycn:transparency-due:${ent}:${dbId(row)}`],
    })),
    assets: current("DB_GLOB_CORP_ASSETS").map((row) => assetPayload(row, ent)),
    shareCertificates,
    societySettings: extractCorpSettings(tables, ent),
    directoryPeople,
    report,
  };
}

/**
 * Extract DB_GLOB_CORP_SETTINGS (current row) for one entity into the arg shape
 * of society:updateComplianceSettings, plus the responsible lawyer from
 * Retain_List. Applied by the runner, not the staged pipeline.
 *
 * Retain_List is the firm's client list (entity, corporation number and the
 * responsible lawyer), not a records-retention schedule: RESP_LWYR maps to
 * `responsibleLawyer`; the other columns duplicate the entity key and name.
 */
export function extractCorpSettings(tables: YcnTables, entityId?: string): BundlePayload | null {
  const ent = entityId ?? resolveYcnEntity(tables).entityId;
  const rows = rowsOf(tables, "DB_GLOB_CORP_SETTINGS").filter((row) => entId(row) === ent && isCurrentRow(row));
  const row = rows[rows.length - 1];
  const retain = rowsOf(tables, "Retain_List").find((r) => entId(r) === ent);
  if (!row && !retain) return null;
  const out: BundlePayload = row ? {
    agmMonth: monthToNumber(pick(row, "AGM_MONTH")),
    agmDay: toNumber(pick(row, "AGM_DAY")),
    fiscalYearEnd: fiscalYearEndFrom(pick(row, "FIN_MONTH"), pick(row, "FIN_DAY")),
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
  } : {};
  if (retain) out.responsibleLawyer = pick(retain, "RESP_LWYR");
  // Drop undefined keys so the mutation only patches what's present.
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

/**
 * Directory people referenced by one entity's roster, in the arg shape of
 * peopleDirectory:upsert (plus `globalId`, which the runner uses to link role
 * holders and strips before calling the mutation).
 */
export function extractDirectoryPeople(tables: YcnTables, entityId?: string): BundlePayload[] {
  return buildBundleFromAccessTables(tables, { entityId }).directoryPeople;
}

/** The part of the bundle staged through importSessions.createFromBundle. */
export function stagedBundle(bundle: YcnImportBundle): Record<string, unknown> {
  const out: Record<string, unknown> = { metadata: bundle.metadata };
  for (const key of YCN_STAGED_KEYS) if (bundle[key].length) out[key] = bundle[key];
  return out;
}

/**
 * Link staged role holders to directory people once the runner has upserted
 * them: `directoryIds` maps GLOB_ID → peopleDirectory id.
 */
export function linkDirectoryPeople(bundle: YcnImportBundle, directoryIds: Map<string, string>): number {
  let linked = 0;
  for (const holder of bundle.roleHolders) {
    const id = typeof holder.ycnGlobalId === "string" ? directoryIds.get(holder.ycnGlobalId) : undefined;
    if (id) {
      holder.directoryPersonId = id;
      linked += 1;
    }
  }
  return linked;
}

/** Total record count across all staged collections (for logging / summaries). */
export function countBundleRecords(bundle: YcnImportBundle): number {
  return YCN_STAGED_KEYS.reduce((sum, key) => sum + bundle[key].length, 0);
}
