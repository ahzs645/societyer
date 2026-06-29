/**
 * PORTABLE FUNCTIONS: the courtOrders domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db`. One handler runs on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

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
  return ctx.db
    .query("courtOrders")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function createPortable(ctx: PortableMutationCtx, args: CourtOrderCreateArgs): Promise<string> {
  return ctx.db.insert("courtOrders", args);
}

export async function updatePortable(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: CourtOrderPatch }): Promise<void> {
  await ctx.db.patch(id, patch);
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
