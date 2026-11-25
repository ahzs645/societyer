import { v } from "convex/values";

export const insuranceTermFields = {
  namedInsured: v.optional(v.string()),
  currency: v.optional(v.string()),
  coverholder: v.optional(v.string()),
  brokerCustomerNumber: v.optional(v.string()),
  billingMethod: v.optional(v.string()),
  declaredOperations: v.optional(v.string()),
  grossReceiptsCents: v.optional(v.number()),
  minimumRetainedPremiumPercent: v.optional(v.number()),
};

export const coverageItem = v.object({
  label: v.string(),
  lineId: v.optional(v.string()),
  coverageType: v.optional(v.string()),
  coverageCode: v.optional(v.string()),
  allocatedPremiumCents: v.optional(v.number()),
  limitBasis: v.optional(v.string()),
  currency: v.optional(v.string()),
  effectiveDate: v.optional(v.string()),
  expiryDate: v.optional(v.string()),
  formNumber: v.optional(v.string()),
  coveredClass: v.optional(v.string()),
  limitCents: v.optional(v.number()),
  deductibleCents: v.optional(v.number()),
  summary: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
  citationId: v.optional(v.string()),
});
