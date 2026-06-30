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

export async function getUrlPortable(ctx: PortableQueryCtx, { storageId }: { storageId: string }) {
  return (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(storageId) })).url;
}
