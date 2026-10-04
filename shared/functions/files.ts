/**
 * PORTABLE FUNCTIONS: blob URL resolution.
 *
 * `getUrl` resolves a stored blob reference to a download URL through the
 * injected `ctx.capabilities.storage` (Convex `_storage` on hosted Convex; an
 * inline/null resolver on the local runtime). Upload URL handlers use the same
 * workspace policy and injected storage capability on each runtime. Attaching
 * native blobs remains on Convex.
 */

import type { PortableQueryCtx, PortableMutationCtx } from "../portable/ctx";
import { documentAccessPredicate } from "./documents";
import { requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { uploadPermission, type UploadPurpose } from "./uploadPolicy";

export async function generateUploadUrlPortable(ctx: PortableMutationCtx, args: { societyId: string; purpose?: UploadPurpose }) {
  if (!args.societyId) throw new Error("An authorized workspace is required.");
  await requirePermissionPortable(ctx, args.societyId, uploadPermission(args.purpose));
  return (await ctx.capabilities.storage.createUploadUrl({})).uploadUrl;
}

export async function generateLogoUploadUrlPortable(ctx: PortableMutationCtx, args: { societyId: string }) {
  if (!args.societyId) throw new Error("An authorized workspace is required.");
  await requirePermissionPortable(ctx, args.societyId, "society:write");
  return (await ctx.capabilities.storage.createUploadUrl({})).uploadUrl;
}

export async function getUrlPortable(ctx: PortableQueryCtx, { storageId }: { storageId: string }) {
  if (!storageId.startsWith("data:")) {
    const claims = await ctx.db
      .query<{ _id: string; societyId: string; storageId: string }>("storageOwnership")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .collect();
    const societyId = claims[0]?.societyId;
    if (!societyId || claims.some((claim) => claim.societyId !== societyId)) {
      throw new Error("storageOwnership not found.");
    }
    try {
      await requireSocietyMembership(ctx, societyId);
      const documents = await ctx.db.query("documents").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
      const linked = documents.filter((document) => String(document.storageId ?? "") === storageId);
      if (linked.length) {
        const allows = await documentAccessPredicate(ctx, societyId);
        if (!linked.some((document) => allows(document))) throw new Error("storageOwnership not found.");
      }
      // Unattached document blobs are not downloadable. Branding is a separate,
      // society-wide presentation resource and has an explicit parent reference.
      if (!linked.length) {
        const society = await ctx.db.get(societyId, "societies");
        const brandingIds = [society?.logoStorageId, society?.logoDarkStorageId, society?.letterheadStorageId];
        if (!brandingIds.some((id) => String(id ?? "") === storageId)) throw new Error("storageOwnership not found.");
      }
    } catch {
      throw new Error("storageOwnership not found.");
    }
  }
  return (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(storageId) })).url;
}
