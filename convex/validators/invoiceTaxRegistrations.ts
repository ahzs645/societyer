import { v } from "convex/values";

/** Optional on legacy invoices; an empty registrations array records absence. */
export const invoiceIssuerTaxSnapshotValidator = v.object({
  capturedAtISO: v.string(),
  effectiveDate: v.string(),
  registrations: v.array(v.object({
    taxId: v.string(),
    label: v.string(),
    number: v.string(),
    jurisdiction: v.optional(v.string()),
  })),
});
