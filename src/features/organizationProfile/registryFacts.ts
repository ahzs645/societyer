import { JURISDICTION_WORKSPACE_CONFIGS } from "../../../shared/jurisdictionWorkspace";
import { canonicalizeJurisdictionCode } from "../../../shared/organizationDomain";
import { timeZoneAbbreviation } from "../../../shared/timeZones";
import type { AttorneyStatus, PortalAccessEntry, RegistrationRow } from "./types";

/**
 * Registry facts as the Registrations tab shows them: the registration time,
 * the attorney decision, the public record link and the corporation key's
 * custody state. Pure; the cards and the attention list share these.
 */

/** Tag on documents the registry import (or "Record incorporation") uploads. */
export const REGISTRY_IMPORT_TAG = "registry-import";

/** Generic (daylight-neutral) names for Canada's zones, the way registries print them. */
const GENERIC_ZONE_NAMES: Readonly<Record<string, string>> = {
  "America/Vancouver": "PT",
  "America/Edmonton": "MT",
  "America/Regina": "CST",
  "America/Whitehorse": "MT",
  "America/Yellowknife": "MT",
  "America/Iqaluit": "ET",
  "America/Winnipeg": "CT",
  "America/Toronto": "ET",
  "America/Halifax": "AT",
  "America/St_Johns": "NT",
};

/** "13:45" as "1:45 PM"; undefined for anything but a 24-hour HH:mm. */
export function clockLabel(time: string | undefined): string | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time ?? "");
  if (!match) return undefined;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/** A registry time with its zone: "11:59 AM PT". The zone is left off when unknown. */
export function registrationTimeLabel(time: string | undefined, timeZone: string | undefined): string | undefined {
  const clock = clockLabel(time);
  if (!clock) return undefined;
  const zone = timeZone ? GENERIC_ZONE_NAMES[timeZone] ?? timeZoneAbbreviation(timeZone) : "";
  return zone ? `${clock} ${zone}` : clock;
}

/** Each province's or territory's registry zone; federal (Corporations Canada, Ottawa) is Eastern. */
const REGISTRY_ZONES: ReadonlyArray<[prefix: string, zone: string]> = [
  ["CA-BC", "America/Vancouver"], ["CA-AB", "America/Edmonton"], ["CA-SK", "America/Regina"], ["CA-MB", "America/Winnipeg"],
  ["CA-ON", "America/Toronto"], ["CA-QC", "America/Toronto"], ["CA-NB", "America/Halifax"], ["CA-NS", "America/Halifax"],
  ["CA-PE", "America/Halifax"], ["CA-NL", "America/St_Johns"], ["CA-YT", "America/Whitehorse"], ["CA-NT", "America/Yellowknife"],
  ["CA-NU", "America/Iqaluit"], ["CA-FED", "America/Toronto"],
];

/** Option values that name a province ("alberta", "nova_scotia"). */
const PROVINCE_NAME_ZONES: Readonly<Record<string, string>> = {
  alberta: "America/Edmonton", saskatchewan: "America/Regina", manitoba: "America/Winnipeg", quebec: "America/Toronto",
  new_brunswick: "America/Halifax", nova_scotia: "America/Halifax", prince_edward_island: "America/Halifax",
  newfoundland: "America/St_Johns", yukon: "America/Whitehorse", northwest_territories: "America/Yellowknife", nunavut: "America/Iqaluit",
};

/** The zone a registration time is most likely printed in, from the registering jurisdiction. */
export function defaultRegistrationTimeZone(jurisdiction: string | undefined): string {
  const code = canonicalizeJurisdictionCode(jurisdiction);
  if (code === "CA-BC") return "America/Vancouver";
  const match = REGISTRY_ZONES.find(([prefix]) => code === prefix || code.startsWith(`${prefix}-`));
  const named = Object.entries(PROVINCE_NAME_ZONES).find(([name]) => code.toLowerCase().startsWith(name));
  return match?.[1] ?? named?.[1] ?? "America/Toronto";
}

/** Corporations Canada's public record page for a federal corporation number. */
export function cbcaPublicRecordUrl(corporationNumber: string | undefined): string | undefined {
  const digits = String(corporationNumber ?? "").replace(/\D/g, "");
  return digits ? `https://ised-isde.canada.ca/cc/lgcy/fdrlCrpDtls.html?corpId=${digits}&locale=en_CA` : undefined;
}

/**
 * The public record link for a registration: the stored one, or for a CBCA
 * home registration with none stored, the federal search page derived from
 * the corporation number (marked `derived`).
 */
export function publicRecordLink(row: Pick<RegistrationRow, "publicRecordUrl"> | undefined, home?: { federalCbca: boolean; corporationNumber?: string }): { url: string; derived: boolean } | undefined {
  if (row?.publicRecordUrl?.trim()) return { url: row.publicRecordUrl.trim(), derived: false };
  if (!home?.federalCbca) return undefined;
  const url = cbcaPublicRecordUrl(home.corporationNumber);
  return url ? { url, derived: true } : undefined;
}

export const ATTORNEY_STATUS_LABELS: Readonly<Record<AttorneyStatus, string>> = {
  required: "Required",
  not_required: "Not required",
  appointed: "Appointed",
};

/** "Not required: head office is in British Columbia", "Required, none appointed yet", "Appointed". */
export function attorneyLabel(status: AttorneyStatus | undefined, reason?: string): string | undefined {
  if (!status) return undefined;
  if (status === "required") return "Required, none appointed yet";
  if (status === "appointed") return "Appointed";
  const why = reason?.trim();
  return why ? `Not required: ${why[0].toLowerCase()}${why.slice(1)}` : "Not required";
}

/** "Jordan Example · Online Filing Centre access" (the update date is formatted by the caller). */
export function portalAccessLabel(entry: PortalAccessEntry): string {
  return [entry.name.trim(), entry.role?.trim()].filter(Boolean).join(" · ");
}

/** What an extra-provincial registration still lacks: its time, certificate or attorney decision. */
export function registrationGaps(row: Pick<RegistrationRow, "registrationTime" | "certificateDocumentId" | "attorneyStatus">): string[] {
  return [
    row.registrationTime ? "" : "time",
    row.certificateDocumentId ? "" : "certificate",
    row.attorneyStatus ? "" : "attorney decision",
  ].filter(Boolean);
}

/** "a, b and c". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export type CorporationKeyState = "stored" | "reference" | "missing" | "loading";
export type VaultItemSummary = { _id: string; storageMode?: string; hasSecretValue?: boolean };

/**
 * Where the corporation key is kept, never the key: encrypted in Access
 * custody ("stored"), a custody record that only says where it is kept
 * ("reference", what the local runtime writes), or nothing ("missing").
 * A key kept as a restricted identifier (older workspaces) reads as a reference.
 */
export function corporationKeyState(vaultItemId: string | undefined, items: readonly VaultItemSummary[] | undefined, legacyIdentifier = false): CorporationKeyState {
  if (!vaultItemId) return legacyIdentifier ? "reference" : "missing";
  if (items === undefined) return "loading";
  const item = items.find((candidate) => candidate._id === vaultItemId);
  if (!item) return legacyIdentifier ? "reference" : "missing";
  return item.hasSecretValue ? "stored" : "reference";
}

/** Registry portal identifiers a registration's `registryPortalKey` holds ("bc_registry_societies"). */
const REGISTRY_PORTAL_IDS: ReadonlySet<string> = new Set([
  ...JURISDICTION_WORKSPACE_CONFIGS.map((config) => config.module.registryPortalKey),
  "bc_registry_companies",
  "generic_registry",
]);

/**
 * True when a registration's `registryPortalKey` holds something other than a
 * portal identifier: most likely a registry key someone typed in as plain text.
 */
export function isPlainTextPortalKey(value: string | undefined): boolean {
  const text = value?.trim();
  return Boolean(text) && !REGISTRY_PORTAL_IDS.has(text!);
}
