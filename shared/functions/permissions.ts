/**
 * PORTABLE FUNCTIONS: the current user's role and permissions.
 *
 * The handler reads only the portable users table. Permission expansion is a
 * pure role lookup built on the shared role vocabulary from access.ts.
 */

import type { PortableQueryCtx } from "../portable/ctx";
import type { Role } from "./access";

export const PERMISSIONS = [
  "society:read",
  "society:write",
  "society:update",
  "members:read",
  "members:write",
  "directors:read",
  "directors:write",
  "employees:read",
  "employees:write",
  "committees:read",
  "committees:write",
  "meetings:read",
  "meetings:write",
  "minutes:read",
  "minutes:write",
  "minutes:approve",
  "agendas:read",
  "agendas:write",
  "motions:read",
  "motions:write",
  "proxies:read",
  "proxies:write",
  "conflicts:read",
  "conflicts:write",
  "attestations:read",
  "attestations:write",
  "auditors:read",
  "auditors:write",
  "courtOrders:read",
  "courtOrders:write",
  "filings:read",
  "filings:write",
  "filings:submit",
  "deadlines:read",
  "deadlines:write",
  "commitments:read",
  "commitments:write",
  "financials:read",
  "financials:write",
  "elections:read",
  "elections:write",
  "elections:tally",
  "grants:read",
  "grants:write",
  "documents:read",
  "documents:write",
  "users:read",
  "users:write",
  "tasks:read",
  "tasks:write",
  "exports:read",
  "exports:download",
  "settings:read",
  "settings:write",
  "settings:manage",
  "audit:read",
  "volunteers:read",
  "volunteers:write",
  "communications:read",
  "communications:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_READ: Permission[] = PERMISSIONS.filter((permission) => permission.endsWith(":read"));

export const ROLE_MATRIX: Record<Role, readonly Permission[]> = {
  Owner: PERMISSIONS,
  Admin: PERMISSIONS.filter((permission) => permission !== "settings:manage"),
  Director: [
    ...ALL_READ,
    "meetings:write",
    "minutes:write",
    "agendas:write",
    "documents:write",
    "exports:download",
  ],
  Member: [
    "society:read",
    "members:read",
    "meetings:read",
    "minutes:read",
    "elections:read",
    "documents:read",
    "grants:read",
    "agendas:read",
    "motions:read",
    "volunteers:read",
    "communications:read",
    "tasks:read",
  ],
  Viewer: ALL_READ,
};

export function hasPermission(role: string, permission: Permission): boolean {
  if (!(role in ROLE_MATRIX)) return false;
  return (ROLE_MATRIX[role as Role] as readonly string[]).includes(permission);
}

export function listPermissionsForRole(role: string): readonly Permission[] {
  if (!(role in ROLE_MATRIX)) return [];
  return ROLE_MATRIX[role as Role];
}

export async function myPermissionsPortable(
  ctx: PortableQueryCtx,
  { userId, societyId }: { userId: string; societyId: string },
) {
  const user = await ctx.db.get(userId);
  if (!user || user.societyId !== societyId) return { role: null, permissions: [] };
  return {
    role: user.role,
    permissions: listPermissionsForRole(String(user.role)),
  };
}
