import { v } from "convex/values";

/** Optional on legacy invoices; an empty registrations array records absence. */
export const invoiceIssuerTaxSnapshotValidator = v.object({
  capturedAtISO: v.string(),
  effectiveDate: v.string(),
  supplierFacts: v.optional(v.object({
    charityRegistrationStatus: v.union(v.literal("registered"), v.literal("not_registered"), v.literal("unknown"), v.literal("conflict")),
    charityRegistrationRevisionId: v.optional(v.string()),
    organizationFactsKey: v.string(),
  })),
  registrations: v.array(v.object({
    taxId: v.string(),
    label: v.string(),
    number: v.string(),
    jurisdiction: v.optional(v.string()),
  })),
});
