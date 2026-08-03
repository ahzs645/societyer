/**
 * PORTABLE FUNCTIONS: the employees domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db`, mirroring the members template. One handler runs
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

export interface EmployeeCreateArgs {
  societyId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  sinSecretVaultItemId?: string;
  role: string;
  startDate: string;
  endDate?: string;
  employmentType: string;
  annualSalaryCents?: number;
  hourlyWageCents?: number;
  worksafeBCNumber?: string;
  cppExempt: boolean;
  eiExempt: boolean;
  notes?: string;
}

export interface EmployeePatch {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  sinSecretVaultItemId?: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  employmentType?: string;
  annualSalaryCents?: number;
  hourlyWageCents?: number;
  worksafeBCNumber?: string;
  cppExempt?: boolean;
  eiExempt?: boolean;
  notes?: string;
}

export async function employeesList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("employees")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function employeeCreate(ctx: PortableMutationCtx, args: EmployeeCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.sinSecretVaultItemId) {
    await getOwned(ctx, "secretVaultItems", args.sinSecretVaultItemId, args.societyId);
  }
  return ctx.db.insert("employees", args);
}

export async function employeeUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: EmployeePatch }): Promise<void> {
  const candidate = await ctx.db.get(id, "employees");
  if (!candidate) throw new Error("employees not found.");
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "employees", id, String(candidate.societyId));
  if (patch.sinSecretVaultItemId) {
    await getOwned(ctx, "secretVaultItems", patch.sinSecretVaultItemId, String(candidate.societyId));
  }
  await ctx.db.patch(id, patch);
}

export async function employeeRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  const candidate = await ctx.db.get(id, "employees");
  if (!candidate) return;
  await requireSocietyMembership(ctx, String(candidate.societyId));
  await getOwned(ctx, "employees", id, String(candidate.societyId));
  await ctx.db.delete(id);
}
