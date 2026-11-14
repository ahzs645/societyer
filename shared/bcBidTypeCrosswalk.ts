/**
 * BC Bid renamed its opportunity types when it moved to the current site in
 * 2023, so a notice from April 2015 to December 2022 carries one of 33
 * pre-2023 types (`historicalTypeReferenceId`) and a later one one of 23
 * current types (`opportunityTypeGroupCode`). This maps each pre-2023 type
 * to the current type a reviewer would look for, so one type filter covers
 * both eras.
 *
 * `exact` means the same title under a new code; `close` means the same kind
 * of solicitation under another name (a short-form RFP is still an RFP). The
 * mapping was worked out from the two lists' titles
 * (src/features/procurementReview/data/bc-bid-*-types.json), and
 * scripts/check-bcbid-source-filters.ts checks every code against them.
 * Types left out have no current equivalent (Direct Award, Onboarding …);
 * they stay filterable on their own as pre-2023 types.
 *
 * Shared because the hosted Convex reader runs the same matcher.
 */
export type CrosswalkMatch = "exact" | "close";

export const HISTORICAL_TYPE_PREFIX = "reference-term:BCBID:historical-type:";

/** Pre-2023 type code → its current type. */
export const BC_BID_TYPE_CROSSWALK: Readonly<Record<string, { current: string; match: CrosswalkMatch }>> = {
  ITB: { current: "itb", match: "exact" },
  ITO: { current: "io", match: "exact" },
  SUR: { current: "itq", match: "exact" }, // Invitation to Quote
  ITT: { current: "itt", match: "exact" },
  JSP: { current: "jsrfp", match: "exact" },
  LT: { current: "lt", match: "exact" },
  NOI: { current: "noi", match: "exact" },
  NTV: { current: "ntv", match: "exact" },
  RFI: { current: "rfi", match: "exact" },
  RFIQ: { current: "rfiq", match: "exact" },
  RFP: { current: "rfp", match: "exact" },
  RQU: { current: "rfq", match: "exact" }, // current `rfq` is Request for Qualifications
  RFS: { current: "rfs", match: "exact" },
  RFSQ: { current: "rfsq", match: "exact" },
  RSA: { current: "rfsa", match: "exact" },
  RFT: { current: "Rft", match: "exact" },
  SofW: { current: "sow", match: "exact" },
  RFPS: { current: "rfp", match: "close" }, // Request for Proposal (Short)
  SRFP: { current: "rfp", match: "close" }, // Short-form Request for Proposal
  RFQ: { current: "itq", match: "close" }, // Request for Quotation, not current `rfq`
  NRFP: { current: "np", match: "close" },
  OSNRFP: { current: "np", match: "close" },
  RSO: { current: "rso", match: "close" }, // Standing Offer
  RMSA: { current: "rso", match: "close" }, // Master Standing Agreement
  MSO: { current: "rfsa", match: "close" }, // Corporate Supply Arrangement
  SFS: { current: "sale", match: "close" }, // Surplus for Sale
  REI: { current: "rfi", match: "close" }, // Expressions of Interest
  ROI: { current: "rfi", match: "close" }, // Registration of Interest
};

/** The pre-2023 type code in a `historicalTypeReferenceId` (or a `historicalType` filter); null for anything else. */
export function historicalTypeCode(referenceId: unknown): string | null {
  return typeof referenceId === "string" && referenceId.startsWith(HISTORICAL_TYPE_PREFIX)
    ? referenceId.slice(HISTORICAL_TYPE_PREFIX.length) || null
    : null;
}

/** The current type a pre-2023 type (code or reference id) counts as, if it has one. */
export function currentTypeOf(historical: unknown): string | null {
  const code = historicalTypeCode(historical) ?? (typeof historical === "string" ? historical : null);
  return code && Object.hasOwn(BC_BID_TYPE_CROSSWALK, code) ? BC_BID_TYPE_CROSSWALK[code].current : null;
}

/** The pre-2023 types a current type includes, exact matches first. */
export function historicalTypesOf(current: string): { code: string; match: CrosswalkMatch }[] {
  return Object.entries(BC_BID_TYPE_CROSSWALK)
    .filter(([, entry]) => entry.current === current)
    .map(([code, entry]) => ({ code, match: entry.match }))
    .sort((a, b) => (a.match === b.match ? 0 : a.match === "exact" ? -1 : 1));
}
