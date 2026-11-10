/** Convex remains the authority for catalog access and the workspace's explicit source choice. */
import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { authorizedQuery, authorizedMutation } from "./lib/authorizedServer";
import { toPortableQueryCtx } from "./lib/portable";
import { requirePermissionPortable } from "../shared/functions/permissions";
import { requireEnabledModule } from "./lib/moduleSettings";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";
import { deploymentCapabilities, PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE } from "../shared/deploymentCapabilities";

export function catalogServiceConfiguration(societyId: string) {
  if (!deploymentCapabilities(process.env).procurementReview) throw new Error(PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE);
  const enabled = (process.env.PROCUREMENT_CATALOG_ALLOWED_WORKSPACES ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const baseUrl = process.env.PROCUREMENT_CATALOG_URL ?? "";
  if (!enabled.includes(societyId)) throw new Error("The catalog service is not enabled for this workspace.");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.origin !== baseUrl || url.username || url.password) throw new Error("The catalog service requires an exact HTTPS origin.");
  return { baseUrl };
}
export const configuration = authorizedQuery("procurementCatalog:configuration", query)({
  args: { societyId: v.id("societies"), preview: v.optional(v.boolean()) },
  returns: v.object({ source: v.union(v.literal("convex"), v.literal("service")), baseUrl: v.union(v.string(), v.null()) }),
  handler: async (ctx, { societyId, preview }) => {
    const society = await requireEnabledModule(ctx, societyId, "procurementReview");
    const source = society.integrationSettings?.procurementCatalogSource ?? "convex";
    if (preview) await requirePermissionPortable(await toPortableQueryCtx(ctx), societyId, "settings:write");
    return { source, baseUrl: source === "service" || preview ? catalogServiceConfiguration(societyId).baseUrl : null };
  },
});
/** Internal because only the Node signer should consume this identity assertion. */
export const authorizeGrant = internalQuery({
  args: { societyId: v.id("societies") },
  returns: v.object({ userId: v.string(), folder: v.string(), baseUrl: v.string() }),
  handler: async (ctx, { societyId }) => {
    const { baseUrl } = catalogServiceConfiguration(societyId);
    const portable = await toPortableQueryCtx(ctx);
    if (portable.principal.kind !== "user" || portable.principal.gatewayService) throw new Error("Sign in to read this workspace's catalog.");
    const user = await requirePermissionPortable(portable, societyId, "documents:read");
    const society = await requireEnabledModule(ctx, societyId, "procurementReview");
    const folder = society.integrationSettings?.procurementReviewFolder;
    if (!folder) throw new Error("Configure a procurement publication folder first.");
    return { userId: user._id, folder: validateWorkspaceProcurementReviewFolder(societyId, folder), baseUrl };
  },
});
export const setSource = authorizedMutation("procurementCatalog:setSource", mutation)({
  args: { societyId: v.id("societies"), source: v.union(v.literal("convex"), v.literal("service")) }, returns: v.null(),
  handler: async (ctx, { societyId, source }) => {
    const society = await requireEnabledModule(ctx, societyId, "procurementReview");
    const folder = society.integrationSettings?.procurementReviewFolder;
    if (source === "service") {
      catalogServiceConfiguration(societyId);
      if (!folder) throw new Error("Configure a publication folder first.");
      const publications = await ctx.db.query("procurementServicePublications").withIndex("by_latest", q => q.eq("societyId", societyId).eq("folder", folder)).order("desc").take(3);
      if (publications.length !== 3 || publications.some(row => !row.parityVerifiedAt || !row.parityReportHash)) throw new Error("Three distinct consecutive publications must pass full parity verification before cutover.");
      const previous = await ctx.db.query("procurementServiceRollouts").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
      // Re-enabling after rollback starts a new fallback period. Repeated saves do not shorten it.
      if (society.integrationSettings?.procurementCatalogSource !== "service" || !previous) {
        const cutoverAt = Date.now(), rollout = { societyId, folder, cutoverAt, fallbackUntil: cutoverAt + 14 * 86400_000, qualificationPublications: publications.map(row => row.publicationId) };
        if (previous) await ctx.db.replace(previous._id, rollout); else await ctx.db.insert("procurementServiceRollouts", rollout);
      }
    }
    await ctx.db.patch(societyId, { integrationSettings: { ...society.integrationSettings!, procurementCatalogSource: source }, updatedAt: Date.now() });
    return null;
  },
});
/** Operator-only receipt ingestion; the publishing CLI verifies it over SSH first. */
export const recordPublication = internalMutation({
  args: { societyId: v.id("societies"), receiptJson: v.string() }, returns: v.null(),
  handler: async (ctx, { societyId, receiptJson }) => {
    catalogServiceConfiguration(societyId);
    if (receiptJson.length > 32_000) throw new Error("Serving receipt exceeds the limit.");
    const receipt = JSON.parse(receiptJson), society = await ctx.db.get(societyId);
    validateWorkspaceProcurementReviewFolder(societyId, receipt.folder);
    if (receipt.schemaVersion !== 1 || receipt.societyId !== societyId || society?.integrationSettings?.procurementReviewFolder !== receipt.folder || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,180}$/.test(receipt.publicationId) || typeof receipt.generation !== "string" || receipt.generation.length > 256 || !/^[a-f0-9]{64}$/.test(receipt.inventoryHash) || !/^[a-f0-9]{64}$/.test(receipt.contentHash) || !Number.isFinite(Date.parse(receipt.publishedAt)) || !Number.isFinite(Date.parse(receipt.activatedAt)) || Date.parse(receipt.activatedAt) > Date.now() + 300_000 || !receipt.counts || Object.keys(receipt.counts).some(key => !["opportunity", "award"].includes(key) || !Number.isSafeInteger(receipt.counts[key]) || receipt.counts[key] < 0)) throw new Error("Invalid scoped service receipt.");
    const prior = await ctx.db.query("procurementServicePublications").withIndex("by_identity", q => q.eq("societyId", societyId).eq("folder", receipt.folder).eq("publicationId", receipt.publicationId)).unique();
    if (prior) { if (prior.receiptJson !== receiptJson) throw new Error("An immutable serving receipt changed."); return null; }
    await ctx.db.insert("procurementServicePublications", { societyId, folder: receipt.folder, publicationId: receipt.publicationId, generation: receipt.generation, inventoryHash: receipt.inventoryHash, receiptJson, publishedAtMs: Date.parse(receipt.publishedAt), activatedAt: Date.parse(receipt.activatedAt) });
    return null;
  },
});
