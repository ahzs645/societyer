/**
 * PORTABLE FUNCTIONS: the courtOrders domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db`. One handler runs on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

export interface CourtOrderCreateArgs {
  societyId: string;
  title: string;
  orderDate: string;
  court: string;
  fileNumber?: string;
  description: string;
  documentId?: string;
  status: string;
  notes?: string;
}

export interface CourtOrderPatch {
  title?: string;
  orderDate?: string;
  court?: string;
  fileNumber?: string;
  description?: string;
  documentId?: string;
  status?: string;
  notes?: string;
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("courtOrders")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function createPortable(ctx: PortableMutationCtx, args: CourtOrderCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.documentId) await getOwned(ctx, "documents", args.documentId, args.societyId);
  return ctx.db.insert("courtOrders", args);
}

export async function updatePortable(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: CourtOrderPatch }): Promise<void> {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await getOwned(ctx, "courtOrders", id, societyId);
  if (patch.documentId) await getOwned(ctx, "documents", patch.documentId, societyId);
  await ctx.db.patch(id, patch);
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await getOwned(ctx, "courtOrders", id, societyId);
  await ctx.db.delete(id);
}
