/**
 * PORTABLE FUNCTIONS: the auditors domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db` — runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

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
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("auditorAppointments")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function auditorCreatePortable(ctx: PortableMutationCtx, args: AuditorCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.engagementLetterDocId) {
    await getOwned(ctx, "documents", args.engagementLetterDocId, args.societyId);
  }
  return ctx.db.insert("auditorAppointments", args);
}

export async function auditorUpdatePortable(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: AuditorPatch }): Promise<void> {
  const candidate = await ctx.db.get(id, "auditorAppointments");
  if (!candidate) throw new Error("auditorAppointments not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "auditorAppointments", id, String(candidate.societyId));
  if (patch.engagementLetterDocId) {
    await getOwned(ctx, "documents", patch.engagementLetterDocId, String(candidate.societyId));
  }
  await ctx.db.patch(id, patch);
}

export async function auditorRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  const candidate = await ctx.db.get(id, "auditorAppointments");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "auditorAppointments", id, String(candidate.societyId));
  await ctx.db.delete(id);
}
