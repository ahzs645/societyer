// Operator-only native cache fixture; never included in production deployment.
import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";

export const seedWave = internalMutationGeneric({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    if (process.env.OFFLINE_LOCAL_QUALIFICATION !== "1") throw new Error("Interface fixtures are disabled.");
    if (!(await ctx.db.get(societyId))) throw new Error("Qualification workspace is missing.");
    const existing = await ctx.db.query("waveCacheResources").withIndex("by_society", (q) => q.eq("societyId", societyId)).take(1);
    if (existing.length) return;
    const fetchedAtISO = new Date().toISOString();
    const businessId = "isolated-interface-business";
    const snapshotId = await ctx.db.insert("waveCacheSnapshots", {
      societyId, provider: "wave", businessId, businessName: "Isolated qualification cache", currencyCode: "CAD", fetchedAtISO,
      resourceCountsJson: '{"account":1,"business":1}', resourceTypes: ["account", "business"], structureTypes: [], status: "complete",
    });
    for (const resource of [
      { resourceType: "business", externalId: businessId, label: "Synthetic qualification business", raw: { id: businessId, name: "Synthetic qualification business", currency: { code: "CAD" } } },
      { resourceType: "account", externalId: "isolated-interface-account", label: "Synthetic qualification account", raw: { id: "isolated-interface-account", name: "Synthetic qualification account", type: { name: "ASSET" }, subtype: { name: "CASH_AND_BANK" } } },
    ]) await ctx.db.insert("waveCacheResources", { societyId, snapshotId, provider: "wave", businessId, fetchedAtISO, resourceType: resource.resourceType, externalId: resource.externalId, label: resource.label, searchText: resource.label.toLowerCase(), rawJson: JSON.stringify(resource.raw) });
  },
});
