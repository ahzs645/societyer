import type { PayrollDeductionInput } from "./payrollDeductions";

export type PayrollTd1Form = "federal" | "BC";
export type PayrollTd1Source = {
  sha256?: string;
  method: "acroform" | "text" | "ocr" | "manual";
  mediaType:
    | "application/pdf"
    | "image/png"
    | "image/jpeg"
    | "image/webp"
    | "text/plain";
  pageCount: number;
};
/** A reviewed import of an employee's existing declaration. This is not an
 * employee-authenticated electronic TD1 signature or a store of the original. */
export type PayrollTd1ReviewedForm = {
  form: PayrollTd1Form;
  /** The withholding year for the amounts reviewed below. */
  year: number;
  sourceFormYear?: number;
  priorYearReviewed?: boolean;
  priorYearReviewReference?: string;
  totalClaimCents: number;
  multipleEmployers: boolean;
  totalIncomeLessThanClaims: boolean;
  additionalTaxCents?: number;
  annualZoneDeductionCents?: number;
  source: PayrollTd1Source;
  signedFormReviewed: boolean;
  fieldsReviewed: boolean;
  residencyConfirmed: "resident";
  reviewReference?: string;
};
export type PayrollTd1ApplyArgs = {
  societyId: string;
  employeeId: string;
  effectiveFrom: string;
  receivedOn: string;
  forms: PayrollTd1ReviewedForm[];
};
export type PayrollTd1Declaration = PayrollTd1ReviewedForm & {
  _id: string;
  societyId: string;
  employeeId: string;
  effectiveFrom: string;
  receivedOn: string;
  recordedByUserId: string;
  recordedAtISO: string;
  contentHash: string;
  sourceKind: "employer_reviewed_import";
  originalStored: false;
  employeeElectronicSignatureCertified: false;
};
export type PayrollTd1Resolved = {
  asOf: string;
  td1: PayrollDeductionInput["td1"] & { declarationReference?: string };
  deductions: NonNullable<PayrollDeductionInput["deductions"]>;
  sourceDeclarations: PayrollTd1Declaration[];
};
export type PayrollTd1Workspace = {
  today: string;
  page: PayrollTd1Declaration[];
  isDone: boolean;
  continueCursor: string;
  resolved: PayrollTd1Resolved;
};
