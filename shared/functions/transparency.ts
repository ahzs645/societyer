/**
 * PORTABLE FUNCTIONS: the transparency domain
 * (listPublications / upsertPublication / removePublication).
 *
 * Reads and writes the `publications` table over `ctx.db`; role gating goes
 * through `requireRolePortable`. Each handler runs unchanged on hosted Convex,
 * the local Dexie runtime, and the convex-test oracle.
 *
 * Server-only handlers stay on Convex (convex/transparency.ts):
 *   - publicCenter (query; createDownloadUrl provider + ctx.storage.getUrl)
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";

export async function listPublicationsPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
): Promise<any[]> {
  return ctx.db
    .query("publications")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function upsertPublicationPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    title: string;
    summary?: string;
    category: string;
    documentId?: string;
    url?: string;
    publishedAtISO?: string;
    status: string;
    reviewStatus?: string;
    approvedByUserId?: string;
    approvedAtISO?: string;
    featured?: boolean;
    actingUserId?: string;
  },
): Promise<any> {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const { id, actingUserId, ...rest } = args;
  if (rest.status === "Published" && rest.reviewStatus !== "Approved") {
    throw new Error("Publication must be reviewed and approved before it goes live.");
  }
  if (id) {
    await ctx.db.patch(id, rest);
    return id;
  }
  const payload: any = {
    ...rest,
    createdAtISO: new Date().toISOString(),
  };
  return await ctx.db.insert("publications", {
    ...payload,
  });
}

export async function removePublicationPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
): Promise<void> {
  const publication: any = await ctx.db.get(id);
  if (!publication) return;
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: publication.societyId,
    required: "Director",
  });
  await ctx.db.delete(id);
}
