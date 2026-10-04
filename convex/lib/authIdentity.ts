import type { UserIdentity } from "convex/server";
import type { PortablePrincipal } from "../../shared/portable/ctx";
import { normalizeAuthIssuer } from "../../shared/functions/identity";

export function betterAuthIssuer(): string {
  return process.env.BETTER_AUTH_BASE_URL ?? "http://127.0.0.1:5173";
}

/** Identity supplied here has already been verified by Convex auth.config. */
export function hostedPrincipal(identity: UserIdentity | null): PortablePrincipal {
  if (!identity) return { kind: "anonymous", runtime: "convex-hosted", assurance: "none" };
  const isBetterAuth = normalizeAuthIssuer(identity.issuer) === normalizeAuthIssuer(betterAuthIssuer());
  const clerkIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  const isClerk = Boolean(clerkIssuer &&
    normalizeAuthIssuer(identity.issuer) === normalizeAuthIssuer(clerkIssuer));
  // Only the trusted machine signer may convey an application's stored user
  // binding. An identically named claim in a Clerk token has no authority.
  const bridgeIssuer = isBetterAuth && typeof identity.societyer_auth_issuer === "string"
    ? identity.societyer_auth_issuer : undefined;
  const bridgeProvider = isBetterAuth && typeof identity.societyer_auth_provider === "string"
    ? identity.societyer_auth_provider : undefined;
  return {
    kind: "user",
    runtime: "convex-hosted",
    assurance: "verified-jwt",
    subject: identity.subject,
    issuer: bridgeIssuer || identity.issuer,
    authProvider: bridgeIssuer ? bridgeProvider || bridgeIssuer : isBetterAuth ? "better-auth" : isClerk ? "clerk" : identity.issuer,
    tokenIdentifier: identity.tokenIdentifier,
    email: identity.email,
    emailVerified: identity.emailVerified,
    ...(identity.name ? { name: identity.name } : {}),
  };
}
