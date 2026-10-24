import { defineTable } from "convex/server";
import { v } from "convex/values";

export const billingPriceTierValidator = v.object({ catalogItemId: v.id("invoiceCatalogItems"), minimumQuantity: v.number(), unitPriceCents: v.number() });
export const invoicePreferenceTables = {
  billingPriceProfiles: defineTable({ societyId: v.id("societies"), priceListId: v.id("invoicePriceLists"), active: v.boolean(), validFrom: v.optional(v.string()), validTo: v.optional(v.string()), tiers: v.array(billingPriceTierValidator), updatedAtISO: v.string() }).index("by_society", ["societyId"]).index("by_society_priceListId", ["societyId", "priceListId"]),
  billingCustomerPricing: defineTable({ societyId: v.id("societies"), partyKey: v.string(), priceListId: v.id("invoicePriceLists"), active: v.boolean(), updatedAtISO: v.string() }).index("by_society", ["societyId"]).index("by_society_partyKey", ["societyId", "partyKey"]),
  billingInvoiceViews: defineTable({ societyId: v.id("societies"), userId: v.id("users"), name: v.string(), config: v.any(), updatedAtISO: v.string() }).index("by_society_userId", ["societyId", "userId"]),
};
