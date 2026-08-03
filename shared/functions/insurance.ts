/**
 * PORTABLE FUNCTIONS: the insurance domain (list / create / update / remove).
 *
 * Straight CRUD over the `insurancePolicies` table on `ctx.db`. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("insurancePolicies")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function createPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  await requireSocietyMembership(ctx, String(args.societyId));
  for (const documentId of Array.isArray(args.sourceDocumentIds) ? args.sourceDocumentIds : []) {
    await getOwned(ctx, "documents", String(documentId), String(args.societyId));
  }
  const now = new Date().toISOString();
  return await ctx.db.insert("insurancePolicies", {
    ...args,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: { id: string; patch: Record<string, any> },
) {
  const candidate = await ctx.db.get(id, "insurancePolicies");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("insurancePolicies not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "insurancePolicies", id, candidate.societyId);
  for (const documentId of Array.isArray(patch.sourceDocumentIds) ? patch.sourceDocumentIds : []) {
    await getOwned(ctx, "documents", String(documentId), candidate.societyId);
  }
  await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "insurancePolicies");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("insurancePolicies not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "insurancePolicies", id, candidate.societyId);
  await ctx.db.delete(id);
}
