/**
 * PORTABLE FUNCTIONS: the inspections domain (list / forDocument / create / remove).
 *
 * Straight CRUD over `ctx.db`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export interface InspectionCreateArgs {
  societyId: string;
  documentId?: string;
  inspectorName: string;
  isMember: boolean;
  recordsRequested: string;
  inspectedAtISO: string;
  feeCents?: number;
  copyPages?: number;
  copyFeeCents?: number;
  deliveryMethod: string;
  notes?: string;
}

export async function inspectionsList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("inspections")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function inspectionsForDocument(ctx: PortableQueryCtx, { documentId }: { documentId: string }) {
  return ctx.db
    .query("inspections")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect();
}

export async function inspectionCreate(ctx: PortableMutationCtx, args: InspectionCreateArgs): Promise<string> {
  return ctx.db.insert("inspections", args);
}

export async function inspectionRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
