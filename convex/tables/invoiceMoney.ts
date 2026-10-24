import { v } from "convex/values";
export const invoiceTaxModeValidator = v.union(v.literal("exclusive"), v.literal("inclusive"));
export const invoiceFxQuoteValidator = v.object({ baseCurrency: v.string(), rateMicros: v.number(), asOfDate: v.string(), source: v.string(), reference: v.optional(v.string()) });
export const invoiceMoneyValidator = v.object({
  taxMode: v.optional(invoiceTaxModeValidator),
  shipping: v.optional(v.object({ amountCents: v.number(), taxRatePercent: v.optional(v.number()), taxLabel: v.optional(v.string()), taxMode: v.optional(invoiceTaxModeValidator) })),
  withholding: v.optional(v.object({ kind: v.union(v.literal("amount"), v.literal("percent")), value: v.number() })),
  fx: v.optional(invoiceFxQuoteValidator),
});
export const invoiceDocumentExtrasValidator = v.object({
  termsAndConditions: v.optional(v.string()), bankDetails: v.optional(v.array(v.object({ label: v.string(), value: v.string() }))), paymentUrl: v.optional(v.string()),
  annexures: v.optional(v.array(v.object({ title: v.string(), columns: v.array(v.string()), rows: v.array(v.array(v.string())) }))),
  attachments: v.optional(v.array(v.object({ name: v.string(), mimeType: v.union(v.literal("application/pdf"), v.literal("image/png"), v.literal("image/jpeg")), dataUrl: v.string() }))),
});
