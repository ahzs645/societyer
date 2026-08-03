/**
 * PORTABLE FUNCTIONS: the program statements domain (list / get / create / update / remove).
 *
 * Straight CRUD over `ctx.db`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, principalUserId, requireSocietyMembership } from "./access";

function isoNow() {
  return new Date().toISOString();
}

export interface StatementLine {
  key: string;
  label: string;
  actualCents: number;
  budgetCents: number;
  notes?: string;
}

export interface ProgramStatementCreateArgs {
  societyId: string;
  grantId?: string;
  programName: string;
  funderName?: string;
  priorFiscalYearLabel: string;
  currentFiscalYearLabel: string;
  revenues: StatementLine[];
  expenses: StatementLine[];
  narrative?: string;
  status?: string;
  createdByUserId?: string;
}

export interface ProgramStatementPatch {
  grantId?: string;
  programName?: string;
  funderName?: string;
  priorFiscalYearLabel?: string;
  currentFiscalYearLabel?: string;
  revenues?: StatementLine[];
  expenses?: StatementLine[];
  narrative?: string;
  status?: string;
}

export async function programStatementsList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("programStatements")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function programStatementGet(ctx: PortableQueryCtx, { id }: { id: string }) {
  return requireOwnedRow(ctx, "programStatements", id);
}

export async function programStatementCreate(ctx: PortableMutationCtx, args: ProgramStatementCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.grantId) await getOwned(ctx, "grants", args.grantId, args.societyId);
  const createdByUserId = await principalUserId(ctx, args.societyId);
  if (args.createdByUserId && args.createdByUserId !== createdByUserId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  const now = isoNow();
  return ctx.db.insert("programStatements", {
    ...args,
    createdByUserId,
    status: args.status ?? "Draft",
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function programStatementUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: ProgramStatementPatch }): Promise<void> {
  const authorizedRow = await requireOwnedRow(ctx, "programStatements", id);
  const societyId = String(authorizedRow.societyId);
  if (patch.grantId) await getOwned(ctx, "grants", patch.grantId, societyId);
  await ctx.db.patch(id, { ...patch, updatedAtISO: isoNow() });
}

export async function programStatementRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await requireOwnedRow(ctx, "programStatements", id);
  await ctx.db.delete(id);
}
