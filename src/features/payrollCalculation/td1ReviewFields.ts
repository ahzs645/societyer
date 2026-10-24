import type {
  PayrollTd1Form,
  PayrollTd1ParseResult,
} from "../../../shared/payrollTd1";
import type { PayrollTd1ReviewedForm } from "../../../shared/payrollTd1Settings";
export type Td1BooleanReview = "unknown" | "yes" | "no";
export type Td1ReviewDraft = {
  form: PayrollTd1Form;
  enabled: boolean;
  mode: "upload" | "manual";
  parsed?: PayrollTd1ParseResult;
  claim: string;
  multiple: Td1BooleanReview;
  below: Td1BooleanReview;
  additional: string;
  zone: string;
  sourceYear: string;
  sourcePages: string;
  signed: boolean;
  fieldsReviewed: boolean;
  resident: boolean;
  reference: string;
  priorYearReviewed: boolean;
  priorYearReference: string;
};
const money = (value: number | null) =>
  value === null ? "" : (value / 100).toFixed(2);
const flag = (value: boolean | null): Td1BooleanReview =>
  value === null ? "unknown" : value ? "yes" : "no";
export const blankTd1Review = (
  form: PayrollTd1Form,
  year = 2026,
): Td1ReviewDraft => ({
  form,
  enabled: true,
  mode: "upload",
  claim: "",
  multiple: "unknown",
  below: "unknown",
  additional: "",
  zone: "",
  sourceYear: String(year),
  sourcePages: "",
  signed: false,
  fieldsReviewed: false,
  resident: false,
  reference: "",
  priorYearReviewed: false,
  priorYearReference: "",
});
export function parsedTd1Review(result: PayrollTd1ParseResult): Td1ReviewDraft {
  return {
    ...blankTd1Review(result.expectedForm, result.expectedYear),
    parsed: result,
    claim: money(result.fields.totalClaimCents.value),
    multiple: flag(result.fields.multipleEmployers.value),
    below: flag(result.fields.totalIncomeLessThanClaims.value),
    additional: money(result.fields.additionalTaxCents.value),
    zone: money(result.fields.annualZoneDeductionCents.value),
    sourceYear: result.year === null ? "" : String(result.year),
    sourcePages: String(result.source.pageCount),
  };
}
export function reviewedTd1Form(
  draft: Td1ReviewDraft,
  year: number,
): PayrollTd1ReviewedForm {
  const label = draft.form === "federal" ? "Federal TD1" : "BC TD1";
  if (
    draft.mode === "upload" &&
    (!draft.parsed || draft.parsed.status === "blocked")
  )
    throw new Error(
      `${label}: upload a supported form or explicitly use reviewed manual entry.`,
    );
  if (draft.multiple === "unknown" || draft.below === "unknown")
    throw new Error(`${label}: review both declaration flags explicitly.`);
  if (!draft.signed || !draft.fieldsReviewed || !draft.resident)
    throw new Error(
      `${label}: signed-form, field and ordinary-resident reviews are required.`,
    );
  const sourceFormYear = Number(draft.sourceYear);
  if (
    !Number.isInteger(sourceFormYear) ||
    sourceFormYear < 2000 ||
    sourceFormYear > year
  )
    throw new Error(
      `${label}: record the actual source form year no later than the applicable year.`,
    );
  if (
    sourceFormYear !== year &&
    (!draft.priorYearReviewed || !draft.priorYearReference.trim())
  )
    throw new Error(
      `${label}: review prior-year form applicability and current indexed claims.`,
    );
  if (!draft.reference.trim())
    throw new Error(`${label}: retain a meaningful reviewed source reference.`);
  const claimCents = reviewedMoney(draft.claim, `${label} annual claim amount`);
  if (draft.multiple === "yes" && claimCents !== 0)
    throw new Error(
      `${label}: the concurrent-employer declaration requires a reviewed zero total claim.`,
    );
  if (draft.below === "yes" && (claimCents <= 0 || draft.multiple === "yes"))
    throw new Error(
      `${label}: resolve contradictory below-claims and concurrent-employer declarations.`,
    );
  const pageCount = Number(draft.sourcePages);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 20)
    throw new Error(`${label}: record the actual source page count (1–20).`);
  const source =
    draft.mode === "manual"
      ? {
          method: "manual" as const,
          mediaType: "text/plain" as const,
          pageCount,
        }
      : {
          sha256: draft.parsed!.source.sha256,
          method:
            draft.parsed!.source.method === "acroform"
              ? ("acroform" as const)
              : draft.parsed!.source.method === "local_ocr"
                ? ("ocr" as const)
                : draft.parsed!.source.method === "pdf_text"
                  ? ("text" as const)
                  : ("manual" as const),
          mediaType: draft.parsed!.source.mediaType,
          pageCount: draft.parsed!.source.pageCount,
        };
  return {
    form: draft.form,
    year,
    sourceFormYear,
    totalClaimCents: claimCents,
    multipleEmployers: draft.multiple === "yes",
    totalIncomeLessThanClaims: draft.below === "yes",
    ...(draft.form === "federal"
      ? {
          additionalTaxCents: reviewedMoney(
            draft.additional,
            "Federal additional withholding per payment",
          ),
          annualZoneDeductionCents: reviewedMoney(
            draft.zone,
            "Federal annual prescribed-zone claim",
          ),
        }
      : {}),
    source,
    signedFormReviewed: true,
    fieldsReviewed: true,
    residencyConfirmed: "resident",
    reviewReference: draft.reference.trim(),
    ...(sourceFormYear !== year
      ? {
          priorYearReviewed: true,
          priorYearReviewReference: draft.priorYearReference.trim(),
        }
      : {}),
  };
}
function reviewedMoney(raw: string, label: string): number {
  const text = raw.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))
    throw new Error(
      `${label}: enter a nonnegative amount with at most two decimal places.`,
    );
  const cents = Math.round(Number(text.replace(/,/g, "")) * 100);
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000)
    throw new Error(
      `${label}: enter an amount no greater than CAD 10,000,000.00.`,
    );
  return cents;
}
