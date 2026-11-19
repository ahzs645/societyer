import { formatAddressText } from "../../../shared/structuredAddress";
import { canonicalizeJurisdictionCode } from "../../../shared/organizationDomain";
import type { AddressRow, IdentifierRow, RegistrationRow } from "./types";

/** Identifier kinds that hold a registry password. Their numbers are never shown. */
export const SECRET_IDENTIFIER_KINDS: ReadonlySet<string> = new Set(["corporation_key", "company_key", "ontario_company_key"]);
/** Identifier kinds the Tax tab shows as the BN and its program accounts. */
export const TAX_IDENTIFIER_KINDS: ReadonlySet<string> = new Set(["business_number", "income_tax", "gst", "pst", "payroll"]);

export function isSecretIdentifier(row: Pick<IdentifierRow, "kind">) {
  return SECRET_IDENTIFIER_KINDS.has(row.kind ?? "");
}

/** The registry's home registration row, when one is recorded. */
export function isHomeRegistration(row: Pick<RegistrationRow, "registrationType">) {
  return row.registrationType === "home";
}

/** Rows without a type are extra-provincial: that was the drawer's default. */
export function isExtraProvincialRegistration(row: Pick<RegistrationRow, "registrationType">) {
  return !row.registrationType || row.registrationType === "extra_provincial";
}

export function isBcJurisdiction(value?: string | null) {
  return canonicalizeJurisdictionCode(value) === "CA-BC";
}

/** The identifier of a kind the profile should show: an active one first. */
export function primaryIdentifier(identifiers: readonly IdentifierRow[], kind: string): IdentifierRow | undefined {
  const rows = identifiers.filter((row) => row.kind === kind);
  return rows.find((row) => row.status === "active") ?? rows.find((row) => row.status !== "inactive") ?? rows[0];
}

export function findCurrentAddress(addresses: readonly AddressRow[], type: string) {
  return addresses.find((row) => row.type === type && row.status === "current")
    ?? addresses.find((row) => row.type === type);
}

export function isAddressPart(value: unknown) {
  if (!value) return false;
  const text = String(value).trim();
  return Boolean(text) && text.toLowerCase() !== "needs review";
}

export function addressLine(row: AddressRow) {
  return [row.unit, row.street, row.city, row.provinceState, row.postalCode, row.country]
    .filter(isAddressPart)
    .join(", ");
}

export function guidedAddressText(row: AddressRow) {
  const part = (value: string | undefined) => (isAddressPart(value) ? String(value) : "");
  return formatAddressText({
    unit: part(row.unit), street: part(row.street), city: part(row.city),
    provinceState: part(row.provinceState), postalCode: part(row.postalCode), country: part(row.country),
  });
}

export function mask(value?: string) {
  const text = String(value ?? "");
  if (text.length <= 4) return "restricted";
  return `**** ${text.slice(-4)}`;
}

export function csv(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

/** The Act's name recorded at setup when "Another Act" was chosen. */
export function setupOtherActName(onboardingAnswersJson?: string): string | undefined {
  if (!onboardingAnswersJson) return undefined;
  try {
    const name: unknown = JSON.parse(onboardingAnswersJson)?.otherActName;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function documentUploadHref(category: string, title: string) {
  return `/app/documents?${new URLSearchParams({ intent: "new", category, title }).toString()}`;
}

export function hasText(value: unknown) {
  return typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;
}

/** "03-31" (or a full date) as "Mar 31". */
export function monthDayLabel(value?: string) {
  const match = /(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return "";
  const date = new Date(Date.UTC(2000, Number(match[1]) - 1, Number(match[2])));
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
