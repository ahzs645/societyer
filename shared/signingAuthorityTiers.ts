/**
 * A17: signing-authority amount tiers ("one signature up to $5,000; two
 * signatures for $5,001–$9,999; board approval above $10,000").
 *
 * Pure normalizer + validator shared by the evidence register, import and UI.
 */

export type SigningAuthorityTier = {
  minCents?: number;
  maxCents?: number;
  signaturesRequired: number;
  roles?: string[];
  notes?: string;
};

function cents(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(number)) throw new Error("Signing tier amounts must be numbers (cents).");
  if (number < 0) throw new Error("Signing tier amounts cannot be negative.");
  return Math.round(number);
}

/** Normalize and validate tiers; returns undefined for an empty list. */
export function normalizeSigningAuthorityTiers(value: unknown): SigningAuthorityTier[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error("Signing tiers must be a list.");
  const tiers = value.map((raw: any, index) => {
    const signaturesRequired = Number(raw?.signaturesRequired);
    if (!Number.isInteger(signaturesRequired) || signaturesRequired < 0) throw new Error(`Signing tier ${index + 1}: signatures required must be a whole number.`);
    const minCents = cents(raw?.minCents);
    const maxCents = cents(raw?.maxCents);
    if (minCents != null && maxCents != null && minCents > maxCents) throw new Error(`Signing tier ${index + 1}: minimum is above maximum.`);
    const roles = Array.isArray(raw?.roles) ? raw.roles.map((role: unknown) => String(role ?? "").trim()).filter(Boolean) : undefined;
    const notes = String(raw?.notes ?? "").trim() || undefined;
    const tier: SigningAuthorityTier = { signaturesRequired };
    if (minCents != null) tier.minCents = minCents;
    if (maxCents != null) tier.maxCents = maxCents;
    if (roles?.length) tier.roles = roles;
    if (notes) tier.notes = notes;
    return tier;
  }).sort((a, b) => (a.minCents ?? 0) - (b.minCents ?? 0));
  for (let index = 1; index < tiers.length; index += 1) {
    const previous = tiers[index - 1];
    if (previous.maxCents == null || (tiers[index].minCents ?? 0) <= previous.maxCents) throw new Error("Signing tiers overlap; give each tier a distinct amount range.");
  }
  return tiers.length ? tiers : undefined;
}

/** The tier that governs an amount, if any. */
export function signingTierForAmount(tiers: SigningAuthorityTier[] | undefined, amountCents: number): SigningAuthorityTier | undefined {
  return (tiers ?? []).find((tier) => (tier.minCents ?? 0) <= amountCents && (tier.maxCents == null || amountCents <= tier.maxCents));
}
