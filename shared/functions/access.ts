/**
 * PORTABLE ACCESS CONTROL: role ranking + `requireRole`.
 *
 * `requireRolePortable` is a pure `ctx.db` reader (it only consults the `users`
 * table), so it runs unchanged on hosted Convex, the local Dexie runtime, and
 * the convex-test oracle. This is the seam that lets role-gated mutations be
 * ported to the portable contract: a portable handler calls
 * `requireRolePortable(ctx, ...)` directly, and the Convex `requireRole` wrapper
 * (convex/users.ts) delegates here so live and offline enforce the same rule.
 *
 * STAGE 2 TENANCY PATTERN (keep call sites boring and consistent):
 *   const user = await requireSocietyMembership(ctx, societyId);
 *   const row = await requireOwnedRow<Row>(ctx, "rows", id);
 *   const row = await getOwned<Row>(ctx, "rows", id, societyId);
 *   const child = await getOwnedChild<Child>(
 *     ctx, "children", childId, "parents", "parentId", societyId,
 *   );
 *   const createdByUserId = await principalUserId(ctx, societyId);
 *
 * `getOwned`/`getOwnedChild` deliberately throw the same table-scoped not-found
 * error for missing, wrong-table, and foreign-society IDs. Audit attribution
 * always comes from `principalUserId`; client actor fields are compatibility
 * inputs only and must not be copied into stored audit fields.
 */

import type {
  PortableDoc,
  PortablePrincipal,
  PortableQueryCtx,
  TableName,
} from "../portable/ctx";
import { PORTABLE_ACCESS_ENFORCEMENT } from "../portable/define";

export const ROLES = ["Owner", "Admin", "Director", "Member", "Viewer"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  Owner: 100,
  Admin: 80,
  Director: 60,
  Member: 40,
  Viewer: 20,
};

export function canActAs(actual: Role | undefined | null, required: Role): boolean {
  if (!actual) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export type PortableAuthenticatedPrincipal = Exclude<PortablePrincipal, { kind: "anonymous" }>;

export type PortableUserRow = PortableDoc & {
  societyId: string;
  role?: string;
  status?: string;
  authSubject?: string;
};

export type OwnedPortableRow = PortableDoc & { societyId: string };

export function requireAuthenticated(ctx: PortableQueryCtx): PortableAuthenticatedPrincipal {
  if (ctx.principal.kind === "anonymous") throw new Error("Authentication required.");
  return ctx.principal;
}

/** Resolve a runtime-derived user/service actor against the current user row. */
export async function resolvePrincipalUser(
  ctx: PortableQueryCtx,
  societyId: string,
): Promise<PortableUserRow | null> {
  const principal = ctx.principal;
  if (principal.kind === "anonymous") return null;
  if (principal.societyId && principal.societyId !== societyId) {
    if (principal.kind !== "user" || principal.assurance !== "trusted-workspace") return null;
    const localMemberships = await ctx.db
      .query<PortableUserRow>("users")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return localMemberships.find((user) => user.role === "Owner") ?? localMemberships[0] ?? null;
  }

  const directUserId = principal.kind === "user" ? principal.userId : principal.actorUserId;
  if (directUserId) {
    const direct = await ctx.db.get<PortableUserRow>(directUserId, "users");
    return direct?.societyId === societyId ? direct : null;
  }

  if (principal.kind !== "user") return null;
  const matches = await ctx.db
    .query<PortableUserRow>("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", principal.subject))
    .collect();
  return matches.find((user) => user.societyId === societyId) ?? null;
}

function assertMembershipStatus(user: PortableUserRow): void {
  // Older local/demo rows predate the status field and remain active for
  // compatibility. New rows must be explicitly Active.
  if (user.status && user.status !== "Active") {
    if (user.status === "Disabled") throw new Error("User is disabled.");
    throw new Error("Society membership is not active.");
  }
}

/** Resolve and validate the current principal's membership in one society. */
export async function requireSocietyMembership(
  ctx: PortableQueryCtx,
  societyId: string,
): Promise<PortableUserRow> {
  const user = await resolvePrincipalUser(ctx, societyId);
  if (!user) throw new Error("Society membership not found.");
  assertMembershipStatus(user);
  return user;
}

function ownedRowNotFound(table: TableName): Error {
  return new Error(`${table} not found.`);
}

/** Fetch a same-society row without revealing whether a foreign row exists. */
export async function getOwned<T extends OwnedPortableRow = OwnedPortableRow>(
  ctx: PortableQueryCtx,
  table: TableName,
  id: string,
  societyId: string,
): Promise<T> {
  const row = await ctx.db.get<T>(id, table);
  if (!row || row.societyId !== societyId) throw ownedRowNotFound(table);
  return row;
}

/** Fetch a row, derive its society, and authorize the principal against it. */
export async function requireOwnedRow<T extends OwnedPortableRow = OwnedPortableRow>(
  ctx: PortableQueryCtx,
  table: TableName,
  id: string,
): Promise<T> {
  const row = await ctx.db.get<T>(id, table);
  if (!row || typeof row.societyId !== "string") throw ownedRowNotFound(table);
  try {
    await requireSocietyMembership(ctx, row.societyId);
  } catch {
    throw ownedRowNotFound(table);
  }
  return row;
}

/** Fetch an authenticated global row or a row owned by one of the principal's societies. */
export async function getGlobalOrOwned<T extends PortableDoc = PortableDoc>(
  ctx: PortableQueryCtx,
  table: TableName,
  id: string,
  societyId?: string,
): Promise<T> {
  const row = await ctx.db.get<T>(id, table);
  if (!row) throw ownedRowNotFound(table);
  if (typeof row.societyId !== "string") {
    if (ctx.principal.kind === "anonymous") throw ownedRowNotFound(table);
    return row;
  }
  if (societyId && row.societyId !== societyId) throw ownedRowNotFound(table);
  try {
    await requireSocietyMembership(ctx, row.societyId);
  } catch {
    throw ownedRowNotFound(table);
  }
  return row;
}

/**
 * Fetch a child and verify its parent belongs to the society in the same
 * handler transaction. The child may omit `societyId`; when present it must
 * agree with the parent.
 */
export async function getOwnedChild<
  TChild extends PortableDoc = PortableDoc,
  TParent extends OwnedPortableRow = OwnedPortableRow,
>(
  ctx: PortableQueryCtx,
  childTable: TableName,
  childId: string,
  parentTable: TableName,
  parentIdField: keyof TChild & string,
  societyId: string,
): Promise<TChild> {
  const child = await ctx.db.get<TChild>(childId, childTable);
  const parentId = child?.[parentIdField];
  if (!child || typeof parentId !== "string") throw ownedRowNotFound(childTable);
  const parent = await ctx.db.get<TParent>(parentId, parentTable);
  if (
    !parent ||
    parent.societyId !== societyId ||
    (typeof child.societyId === "string" && child.societyId !== societyId)
  ) {
    throw ownedRowNotFound(childTable);
  }
  return child;
}

async function authorizeUserRole(
  ctx: PortableQueryCtx,
  user: PortableUserRow,
  societyId: string,
  required: Role,
): Promise<{ user: PortableUserRow }> {
  if (user.societyId !== societyId) throw new Error("User is not part of this society.");
  if (!canActAs(user.role as Role, required)) {
    // Preserve the existing stranded-society recovery behavior during Stage 1.
    const peers = await ctx.db
      .query<PortableUserRow>("users")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const hasQualifiedActor = peers.some((peer) => canActAs(peer.role as Role, required));
    if (!hasQualifiedActor) return { user };
    throw new Error(`Role ${required} required — you have ${user.role}.`);
  }
  return { user };
}

async function requireLegacyRole(
  ctx: PortableQueryCtx,
  args: { actingUserId?: string | null; societyId: string; required: Role },
): Promise<{ user: PortableUserRow | null }> {
  if (!args.actingUserId) {
    const firstUser = await ctx.db
      .query<PortableUserRow>("users")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .first();
    if (!firstUser) return { user: null };
    throw new Error(`Role ${args.required} required — no authenticated actor.`);
  }
  const user = await ctx.db.get<PortableUserRow>(args.actingUserId);
  if (!user) throw new Error("Unknown user.");
  return authorizeUserRole(ctx, user, args.societyId, args.required);
}

export async function requirePrincipalRole(
  ctx: PortableQueryCtx,
  args: { actingUserId?: string | null; societyId: string; required: Role },
): Promise<{ user: PortableUserRow | null }> {
  const principalUser = await resolvePrincipalUser(ctx, args.societyId);
  if (principalUser) {
    assertMembershipStatus(principalUser);
    if (args.actingUserId && args.actingUserId !== principalUser._id) {
      throw new Error("Authenticated actor does not match the current principal.");
    }
    return authorizeUserRole(ctx, principalUser, args.societyId, args.required);
  }
  if (ctx.principal.kind !== "anonymous" || PORTABLE_ACCESS_ENFORCEMENT) {
    throw new Error("Society membership not found.");
  }
  // Pre-flip compatibility is reachable only when there is no runtime
  // principal at all. An authenticated-but-unbound or wrong-society principal
  // must never regain authority through a client-supplied actor ID.
  return requireLegacyRole(ctx, args);
}

export async function principalUserId(ctx: PortableQueryCtx, societyId: string): Promise<string> {
  const user = await requireSocietyMembership(ctx, societyId);
  return user._id;
}

export async function requireRolePortable(
  ctx: PortableQueryCtx,
  args: { actingUserId?: string | null; societyId: string; required: Role },
): Promise<{ user: PortableUserRow | null }> {
  return requirePrincipalRole(ctx, args);
}
