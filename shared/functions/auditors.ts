/**
 * PORTABLE FUNCTIONS: the auditors domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db` — runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export interface AuditorCreateArgs {
  societyId: string;
  firmName: string;
  engagementType: string;
  fiscalYear: string;
  appointedBy: string;
  appointedAtISO: string;
  engagementLetterDocId?: string;
  independenceAttested: boolean;
  status: string;
  notes?: string;
}

export interface AuditorPatch {
  firmName?: string;
  engagementType?: string;
  fiscalYear?: string;
  appointedBy?: string;
  appointedAtISO?: string;
  engagementLetterDocId?: string;
  independenceAttested?: boolean;
  status?: string;
  notes?: string;
}

export async function auditorsListPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("auditorAppointments")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function auditorCreatePortable(ctx: PortableMutationCtx, args: AuditorCreateArgs): Promise<string> {
  return ctx.db.insert("auditorAppointments", args);
}

export async function auditorUpdatePortable(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: AuditorPatch }): Promise<void> {
  await ctx.db.patch(id, patch);
}

export async function auditorRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
