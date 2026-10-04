import type { UserIdentity } from "convex/server";
import type { PortablePrincipal } from "../../shared/portable/ctx";
import { resolveAuthIssuer, resolveClerkIssuer, resolveSessionBroker } from "../../shared/authConfiguration";

export function betterAuthIssuer(): string {
  return resolveAuthIssuer(process.env);
}

/** Identity supplied here has already been verified by Convex auth.config. */
export function hostedPrincipal(identity: UserIdentity | null): PortablePrincipal {
  if (!identity) return { kind: "anonymous", runtime: "convex-hosted", assurance: "none" };
  const mode = resolveSessionBroker(process.env);
  const isBetterAuth = identity.issuer === betterAuthIssuer();
  const clerkIssuer = mode === "clerk" ? resolveClerkIssuer(process.env) : undefined;
  const isClerk = Boolean(clerkIssuer && identity.issuer === clerkIssuer);
  // Only the trusted machine signer can bridge the configured human broker.
  // Arbitrary issuer claims and same-email provider accounts convey no rights.
  const bridgeIssuer = isBetterAuth && typeof identity.societyer_auth_issuer === "string"
    ? identity.societyer_auth_issuer : undefined;
  const bridgeProvider = isBetterAuth && typeof identity.societyer_auth_provider === "string"
    ? identity.societyer_auth_provider : undefined;
  if ((!isBetterAuth && !isClerk) || (bridgeIssuer && bridgeIssuer !== (mode === "clerk" ? clerkIssuer : betterAuthIssuer()))
      || (mode === "clerk" && isBetterAuth && !bridgeIssuer)) {
    return { kind: "anonymous", runtime: "convex-hosted", assurance: "none" };
  }
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
