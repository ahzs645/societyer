/**
 * PORTABLE ACCESS CONTROL: role ranking + `requireRole`.
 *
 * `requireRolePortable` is a pure `ctx.db` reader (it only consults the `users`
 * table), so it runs unchanged on hosted Convex, the local Dexie runtime, and
 * the convex-test oracle. This is the seam that lets role-gated mutations be
 * ported to the portable contract: a portable handler calls
 * `requireRolePortable(ctx, ...)` directly, and the Convex `requireRole` wrapper
 * (convex/users.ts) delegates here so live and offline enforce the same rule.
 */

import type {
  PortableDoc,
  PortablePrincipal,
  PortableQueryCtx,
} from "../portable/ctx";

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
  if (principal.societyId && principal.societyId !== societyId) return null;

  const directUserId = principal.kind === "user" ? principal.userId : principal.actorUserId;
  if (directUserId) {
    const direct = await ctx.db.get<PortableUserRow>(directUserId);
    return direct?.societyId === societyId ? direct : null;
  }

  if (principal.kind !== "user") return null;
  const matches = await ctx.db
    .query<PortableUserRow>("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", principal.subject))
    .collect();
  return matches.find((user) => user.societyId === societyId) ?? null;
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
    if (principalUser.status === "Disabled") throw new Error("User is disabled.");
    return authorizeUserRole(ctx, principalUser, args.societyId, args.required);
  }
  // Stage-1 compatibility: anonymous or unresolved principals retain the exact
  // caller-supplied actingUserId path. Stage 2 removes/rejects this fallback.
  return requireLegacyRole(ctx, args);
}

export async function principalUserId(ctx: PortableQueryCtx, societyId: string): Promise<string> {
  const user = await resolvePrincipalUser(ctx, societyId);
  if (!user) throw new Error("No user row resolves for the current principal.");
  return user._id;
}

const LEGACY_COMPATIBILITY_PRINCIPAL: PortablePrincipal = {
  kind: "anonymous",
  runtime: "test",
  assurance: "none",
};

export async function requireRolePortable(
  ctx: PortableQueryCtx,
  args: { actingUserId?: string | null; societyId: string; required: Role },
): Promise<{ user: any | null }> {
  // Compatibility wrapper: existing handlers deliberately enter the new
  // helper's legacy fallback until Stage 2 migrates them family-by-family.
  return requirePrincipalRole(
    { ...ctx, principal: LEGACY_COMPATIBILITY_PRINCIPAL },
    args,
  );
}
