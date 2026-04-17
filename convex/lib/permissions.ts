import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";

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

type Role = "Owner" | "Admin" | "Director" | "Member" | "Viewer";

const ALL_READ: Permission[] = PERMISSIONS.filter((p) => p.endsWith(":read"));
const ALL_WRITE: Permission[] = PERMISSIONS.filter(
  (p) => p.endsWith(":write") || p.endsWith(":approve") || p.endsWith(":tally") || p.endsWith(":submit") || p.endsWith(":download"),
);

export const ROLE_MATRIX: Record<Role, readonly Permission[]> = {
  Owner: PERMISSIONS,
  Admin: PERMISSIONS.filter((p) => p !== "settings:manage"),
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

function roleHasPermission(role: Role, permission: Permission): boolean {
  return (ROLE_MATRIX[role] as readonly string[]).includes(permission);
}

export async function resolveUserRole(
  ctx: QueryCtx | MutationCtx,
  societyId: Id<"societies">,
  userId: Id<"users">,
): Promise<Role> {
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found." });
  if (user.societyId !== societyId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "User does not belong to this society." });
  }
  return user.role as Role;
}

export function hasPermission(role: string, permission: Permission): boolean {
  if (!(role in ROLE_MATRIX)) return false;
  return roleHasPermission(role as Role, permission);
}

export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  societyId: Id<"societies">,
  userId: Id<"users">,
  permission: Permission,
): Promise<Doc<"users">> {
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found." });
  if (user.societyId !== societyId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "User does not belong to this society." });
  }
  if (!hasPermission(user.role, permission)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `Your role (${user.role}) does not have "${permission}" permission.`,
    });
  }
  return user;
}

export function listPermissionsForRole(role: string): readonly Permission[] {
  if (!(role in ROLE_MATRIX)) return [];
  return ROLE_MATRIX[role as Role];
}
