/**
 * PORTABLE FUNCTIONS: blob URL resolution.
 *
 * `getUrl` resolves a stored blob reference to a download URL through the
 * injected `ctx.capabilities.storage` (Convex `_storage` on hosted Convex; an
 * inline/null resolver on the local runtime). Upload-side handlers
 * (generateUploadUrl / generateLogoUploadUrl / attachUploadedFileToDocument)
 * still need the write side of storage and stay on Convex.
 */

import type { PortableQueryCtx } from "../portable/ctx";
import { documentAccessPredicate } from "./documents";
import { requireSocietyMembership } from "./access";

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
