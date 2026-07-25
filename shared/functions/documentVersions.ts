/**
 * PORTABLE FUNCTIONS: the document versions domain.
 *
 * Only the pure `ctx.db` handlers live here. Anything that mints presigned
 * upload URLs (beginUpload), builds storage keys / gates on native file storage
 * (createDemoVersion), or schedules a Paperless mirror (recordUploadedVersion)
 * stays on Convex.
 *
 * Each handler reads/writes exclusively through the portable `ctx.db` contract
 * and runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";

export async function listForDocumentPortable(ctx: PortableQueryCtx, { documentId }: { documentId: string }) {
  const rows = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect();
  return rows.sort((a: any, b: any) => b.version - a.version);
}

export async function latestPortable(ctx: PortableQueryCtx, { documentId }: { documentId: string }) {
  const rows = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect();
  return rows.sort((a: any, b: any) => b.version - a.version)[0] ?? null;
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function rollbackPortable(
  ctx: PortableMutationCtx,
  { versionId, actingUserId }: { versionId: string; actingUserId?: string },
) {
  const v = await ctx.db.get(versionId);
  if (!v) throw new Error("Version not found.");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(v.societyId),
    required: "Admin",
  });
  const siblings = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q) => q.eq("documentId", v.documentId))
    .collect();
  for (const row of siblings) {
    if (row.isCurrent) await ctx.db.patch(row._id, { isCurrent: false });
  }
  await ctx.db.patch(versionId, { isCurrent: true });
  await ctx.db.patch(v.documentId, {
    storageId: undefined,
    fileName: v.fileName,
    mimeType: v.mimeType,
    fileSizeBytes: v.fileSizeBytes,
  });
  await ctx.db.insert("activity", {
    societyId: v.societyId,
    actor: "System",
    entityType: "document",
    subjectId: v.documentId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: v.documentId,
    action: "rolled-back",
    summary: `Rolled back to v${v.version} (${v.fileName})`,
    createdAtISO: new Date().toISOString(),
  });
}
