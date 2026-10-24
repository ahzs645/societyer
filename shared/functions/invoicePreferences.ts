import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { cleanBillingPriceProfile, cleanInvoiceListView, type BillingPriceProfile } from "../billingPricing";
import { getOwned, principalUserId, requireSocietyMembership } from "./access";
import { requireFunctionAction } from "./actionPolicy";
import { upsertPriceListPortable } from "./invoices";

export async function collectionPagePortable(ctx: PortableQueryCtx, args: {societyId:string; collection:"templates"|"priceLists"|"repairs"; cursor:string|null}) {
  await requireFunctionAction(ctx,"invoicePreferences:collectionPage","query",args);
  if (!["templates","priceLists","repairs"].includes(args.collection)) throw new Error("Choose a supported invoice collection.");
  const table = ({templates:"invoiceTemplates",priceLists:"invoicePriceLists",repairs:"repairJobs"} as const)[args.collection];
  if (!table) throw new Error("Choose a supported invoice collection.");
  // Templates may contain embedded artwork. Small pages also bound response bytes.
  return ctx.db.query(table).withIndex("by_society",q=>q.eq("societyId",args.societyId)).order("desc").paginate({numItems:4,cursor:args.cursor});
}

export async function savePriceListPortable(ctx: PortableMutationCtx, args: { societyId: string; id?: string; name: string; currency: string; active: boolean; entries: Array<{catalogItemId: string; unitPriceCents: number}>; validFrom?: string; validTo?: string; tiers: BillingPriceProfile["tiers"] }) {
  await requireFunctionAction(ctx, "invoicePreferences:savePriceList", "mutation", args);
  // Validate the companion profile before either record can change in local runtimes.
  const profile = cleanBillingPriceProfile({ priceListId: args.id ?? "new", active: args.active, validFrom: args.validFrom, validTo: args.validTo, tiers: args.tiers });
  for (const itemId of new Set(profile.tiers.map((tier) => tier.catalogItemId))) await getOwned(ctx, "invoiceCatalogItems", itemId, args.societyId);
  const id = await upsertPriceListPortable(ctx, args);
  await saveProfilePortable(ctx, { ...profile, societyId: args.societyId, priceListId: id });
  return id;
}

export async function workspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireFunctionAction(ctx, "invoicePreferences:workspace", "query", { societyId });
  const userId = await principalUserId(ctx, societyId);
  const [profiles, assignments, views] = await Promise.all([
    ctx.db.query("billingPriceProfiles").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("billingCustomerPricing").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("billingInvoiceViews").withIndex("by_society_userId", (q) => q.eq("societyId", societyId).eq("userId", userId)).collect(),
  ]);
  return { profiles, assignments, views };
}
export async function saveProfilePortable(ctx: PortableMutationCtx, args: BillingPriceProfile & { societyId: string }) {
  await requireFunctionAction(ctx, "invoicePreferences:saveProfile", "mutation", args);
  const clean = cleanBillingPriceProfile(args);
  await getOwned(ctx, "invoicePriceLists", clean.priceListId, args.societyId);
  for (const itemId of new Set(clean.tiers.map((tier) => tier.catalogItemId))) await getOwned(ctx, "invoiceCatalogItems", itemId, args.societyId);
  const existing = await ctx.db.query("billingPriceProfiles").withIndex("by_society_priceListId", (q) => q.eq("societyId", args.societyId).eq("priceListId", args.priceListId)).first();
  const fields = { ...clean, societyId: args.societyId, updatedAtISO: new Date().toISOString() };
  if (existing) { await ctx.db.patch(existing._id, fields); return existing._id; }
  return ctx.db.insert("billingPriceProfiles", fields);
}
export async function assignCustomerPortable(ctx: PortableMutationCtx, args: { societyId: string; partyKey: string; priceListId: string | null }) {
  await requireFunctionAction(ctx, "invoicePreferences:assignCustomer", "mutation", args);
  const match = /^(member|organization|org|name):(.+)$/.exec(args.partyKey);
  if (!match || args.partyKey.length > 500) throw new Error("Choose a customer.");
  if (match[1] !== "name") await getOwned(ctx, match[1] === "member" ? "members" : "accountingCounterparties", match[2], args.societyId);
  if (args.priceListId) await getOwned(ctx, "invoicePriceLists", args.priceListId, args.societyId);
  args = { ...args, partyKey: args.partyKey.replace(/^org:/,"organization:") };
  const existing = await ctx.db.query("billingCustomerPricing").withIndex("by_society_partyKey", (q) => q.eq("societyId", args.societyId).eq("partyKey", args.partyKey)).first();
  if (!args.priceListId) { if (existing) await ctx.db.delete(existing._id); return null; }
  const fields = { ...args, priceListId: args.priceListId, active: true, updatedAtISO: new Date().toISOString() };
  if (existing) { await ctx.db.patch(existing._id, fields); return existing._id; }
  return ctx.db.insert("billingCustomerPricing", fields);
}
export async function saveViewPortable(ctx: PortableMutationCtx, args: { societyId: string; id?: string; name: string; config: unknown }) {
  await requireFunctionAction(ctx, "invoicePreferences:saveView", "mutation", args);
  const userId = await principalUserId(ctx, args.societyId), name = args.name.trim();
  if (!name || name.length > 100) throw new Error("Name the view using at most 100 characters.");
  const config = cleanInvoiceListView(args.config);
  if (args.id) {
    const existing = await getOwned(ctx, "billingInvoiceViews", args.id, args.societyId);
    if (existing.userId !== userId) throw new Error("View not found.");
    await ctx.db.patch(args.id, { name, config, updatedAtISO: new Date().toISOString() }); return args.id;
  }
  return ctx.db.insert("billingInvoiceViews", { societyId: args.societyId, userId, name, config, updatedAtISO: new Date().toISOString() });
}
export async function removeViewPortable(ctx: PortableMutationCtx, args: { societyId: string; id: string }) {
  await requireFunctionAction(ctx, "invoicePreferences:removeView", "mutation", args);
  const userId = await principalUserId(ctx, args.societyId), existing = await getOwned(ctx, "billingInvoiceViews", args.id, args.societyId);
  if (existing.userId !== userId) throw new Error("View not found.");
  await ctx.db.delete(args.id); return null;
}
