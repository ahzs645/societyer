/**
 * SIGNIFICANT INDIVIDUALS — Transparency Register (pure logic).
 *
 * Models a BC-style Transparency Register of Significant Individuals
 * (the YCN DB_GLOB_TRANSPARENCY_REG + TRANSPARENCY_DUE idea). A significant
 * individual is one who, by ownership / control / influence, must be disclosed
 * on the corporation's transparency register. This module is framework-free
 * (no convex/react imports) and is gated to the corporations track at the call
 * site, but the logic itself is generic.
 *
 * Schema linkage: significant individuals correspond to roleHolders rows with
 * roleType 'controller'. This module deals in the plain disclosure shape rather
 * than the storage row so it can be reused for form metadata and reporting.
 */

export type TaxResidency = "yes" | "no" | "unknown";

export interface SignificantIndividual {
  name: string;
  address?: string;
  dateOfBirth?: string;
  citizenship?: string;
  taxResidentHomeJurisdiction?: TaxResidency;
  /** ISO date the individual became significant. */
  becameSignificantOn: string;
  /** ISO date the individual ceased to be significant, or null/undefined if ongoing. */
  ceasedSignificantOn?: string | null;
  /** The basis for significance (e.g. shareholding, voting control, influence). */
  reason: string;
}

export type SignificanceStatus = "current" | "former" | "upcoming";

/**
 * Derive an individual's significance status relative to a point in time.
 * - 'upcoming' if they have not yet become significant (becameSignificantOn > asOf)
 * - 'former'   if they have ceased (ceasedSignificantOn set and <= asOf)
 * - 'current'  otherwise
 */
export function deriveSignificanceStatus(
  si: SignificantIndividual,
  asOfISO: string,
): SignificanceStatus {
  if (si.becameSignificantOn > asOfISO) {
    return "upcoming";
  }
  if (si.ceasedSignificantOn != null && si.ceasedSignificantOn <= asOfISO) {
    return "former";
  }
  return "current";
}

/** Filter to the individuals who are 'current' as of a point in time. */
export function currentSignificantIndividuals(
  list: SignificantIndividual[],
  asOfISO: string,
): SignificantIndividual[] {
  return list.filter((si) => deriveSignificanceStatus(si, asOfISO) === "current");
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

function isIsoDate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Validate a significant individual disclosure. Requires name, reason, and a
 * well-formed becameSignificantOn ISO date; if a ceasedSignificantOn is present
 * it must not precede becameSignificantOn.
 */
export function validateSignificantIndividual(
  si: SignificantIndividual,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!si.name || si.name.trim() === "") {
    errors.push("name is required");
  }
  if (!si.reason || si.reason.trim() === "") {
    errors.push("reason is required");
  }
  if (!si.becameSignificantOn || si.becameSignificantOn.trim() === "") {
    errors.push("becameSignificantOn is required");
  } else if (!isIsoDate(si.becameSignificantOn)) {
    errors.push("becameSignificantOn must be an ISO date");
  }

  if (si.ceasedSignificantOn != null && si.ceasedSignificantOn.trim() !== "") {
    if (!isIsoDate(si.ceasedSignificantOn)) {
      errors.push("ceasedSignificantOn must be an ISO date");
    } else if (
      si.becameSignificantOn &&
      isIsoDate(si.becameSignificantOn) &&
      si.ceasedSignificantOn < si.becameSignificantOn
    ) {
      errors.push("ceasedSignificantOn must not be before becameSignificantOn");
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * The diligence sub-register: a record of the reasonable steps taken to
 * identify and confirm a significant individual, plus a scheduled review.
 */
export interface SignificanceStep {
  individualName: string;
  stepsNarrative: string;
  stepDate: string;
  nextReviewDate?: string;
}

/** Diligence steps whose scheduled review is due (nextReviewDate set and <= asOf). */
export function reviewsDue(
  steps: SignificanceStep[],
  asOfISO: string,
): SignificanceStep[] {
  return steps.filter(
    (step) => step.nextReviewDate != null && step.nextReviewDate <= asOfISO,
  );
}

/**
 * BC legal-question field metadata for the significant-individual disclosure,
 * usable directly as form labels/help text.
 */
export const SIGNIFICANT_INDIVIDUAL_FIELDS: ReadonlyArray<{
  key: string;
  label: string;
  help: string;
  required: boolean;
}> = [
  {
    key: "name",
    label: "Full legal name",
    help: "The full legal name of the significant individual.",
    required: true,
  },
  {
    key: "address",
    label: "Address",
    help: "The latest known mailing or delivery address of the individual.",
    required: false,
  },
  {
    key: "dateOfBirth",
    label: "Date of birth",
    help: "The individual's date of birth (ISO YYYY-MM-DD).",
    required: false,
  },
  {
    key: "citizenship",
    label: "Citizenship",
    help: "Every country of which the individual is a citizen.",
    required: false,
  },
  {
    key: "taxResidentHomeJurisdiction",
    label: "Tax resident in the home jurisdiction",
    help: "Whether the individual is a tax resident of the corporation's home jurisdiction (yes / no / unknown).",
    required: true,
  },
  {
    key: "becameSignificantOn",
    label: "Date the individual became significant",
    help: "The date the individual most recently became a significant individual (ISO YYYY-MM-DD).",
    required: true,
  },
  {
    key: "ceasedSignificantOn",
    label: "Date the individual ceased to be significant",
    help: "The date the individual ceased to be a significant individual, if applicable (ISO YYYY-MM-DD).",
    required: false,
  },
  {
    key: "reason",
    label: "Reason for significance",
    help: "How the individual meets the test for being a significant individual (e.g. ownership, control, or influence).",
    required: true,
  },
];
