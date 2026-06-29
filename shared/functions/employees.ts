/**
 * PORTABLE FUNCTIONS: the employees domain (list / create / update / remove).
 *
 * Straight CRUD over `ctx.db`, mirroring the members template. One handler runs
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

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
  return ctx.db
    .query("employees")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function employeeCreate(ctx: PortableMutationCtx, args: EmployeeCreateArgs): Promise<string> {
  return ctx.db.insert("employees", args);
}

export async function employeeUpdate(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: EmployeePatch }): Promise<void> {
  await ctx.db.patch(id, patch);
}

export async function employeeRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}
