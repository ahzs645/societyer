import { isBcSociety, type LegalEntityLike } from "./organizationDomain";

export const BC_SOCIETY_PRE_FILL_KINDS = [
  { id: "AnnualReport", label: "Annual report" },
  { id: "ChangeOfDirectors", label: "Change of directors" },
  { id: "ChangeOfAddress", label: "Change of address" },
  { id: "BylawAmendment", label: "Bylaw amendment" },
  { id: "ConstitutionAlteration", label: "Constitution alteration" },
] as const;

export const CRA_PRE_FILL_KINDS = [
  { id: "T3010", label: "T3010 registered charity return" },
  { id: "T2", label: "T2 corporation income tax" },
  { id: "T1044", label: "T1044 NPO information return" },
] as const;

/** Registry aliases share a packet; unsupported routes must never emit BC forms. */
export function bcSocietyPreparationKind(organization: LegalEntityLike, kind: string): string {
  if (!isBcSociety(organization)) throw new Error("BC Societies Online preparation is available only for a BC society. Use the official registry for this entity's jurisdiction.");
  const canonical = kind === "BCSocietyAnnualReport" ? "AnnualReport" : kind;
  if (!BC_SOCIETY_PRE_FILL_KINDS.some(option => option.id === canonical)) throw new Error("Unsupported BC society filing form.");
  return canonical;
}

export function bcSocietyBotKind(organization: LegalEntityLike, kind: string): string {
  const canonical = bcSocietyPreparationKind(organization, kind);
  if (!["AnnualReport", "BylawAmendment", "ChangeOfDirectors"].includes(canonical)) throw new Error("This filing has no preparation assistant. Use Filing pre-fill or the official registry.");
  return canonical;
}

/** Clamp calendar months instead of overflowing an August 31 deadline into March. */
export function filingDueDateMonthsAfter(iso: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("A valid fiscal period end date is required.");
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error("A valid fiscal period end date is required.");
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}
