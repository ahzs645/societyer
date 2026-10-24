import { defineTable } from "convex/server";
import { v } from "convex/values";

export const payrollTd1SourceValidator = v.object({
  sha256: v.optional(v.string()),
  method: v.union(
    v.literal("acroform"),
    v.literal("text"),
    v.literal("ocr"),
    v.literal("manual"),
  ),
  mediaType: v.union(
    v.literal("application/pdf"),
    v.literal("image/png"),
    v.literal("image/jpeg"),
    v.literal("image/webp"),
    v.literal("text/plain"),
  ),
  pageCount: v.number(),
});
export const payrollTd1ReviewedFields = {
  form: v.union(v.literal("federal"), v.literal("BC")),
  year: v.number(),
  sourceFormYear: v.optional(v.number()),
  priorYearReviewed: v.optional(v.boolean()),
  priorYearReviewReference: v.optional(v.string()),
  totalClaimCents: v.number(),
  multipleEmployers: v.boolean(),
  totalIncomeLessThanClaims: v.boolean(),
  additionalTaxCents: v.optional(v.number()),
  annualZoneDeductionCents: v.optional(v.number()),
  source: payrollTd1SourceValidator,
  signedFormReviewed: v.boolean(),
  fieldsReviewed: v.boolean(),
  residencyConfirmed: v.literal("resident"),
  reviewReference: v.optional(v.string()),
};
export const payrollTd1Tables = {
  payrollTd1Declarations: defineTable({
    ...payrollTd1ReviewedFields,
    societyId: v.id("societies"),
    employeeId: v.id("employees"),
    effectiveFrom: v.string(),
    receivedOn: v.string(),
    recordedByUserId: v.string(),
    recordedAtISO: v.string(),
    contentHash: v.string(),
    sourceKind: v.literal("employer_reviewed_import"),
    originalStored: v.literal(false),
    employeeElectronicSignatureCertified: v.literal(false),
  })
    .index("by_society", ["societyId"])
    .index("by_society_employee_effective", [
      "societyId",
      "employeeId",
      "effectiveFrom",
    ])
    .index("by_society_employee_form_year_effective", [
      "societyId",
      "employeeId",
      "form",
      "year",
      "effectiveFrom",
    ])
    .index("by_society_employee_hash", [
      "societyId",
      "employeeId",
      "contentHash",
    ]),
};
