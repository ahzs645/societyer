import type { UserIdentity } from "convex/server";
import type { PortablePrincipal, PrincipalSessionEvidence } from "../../shared/portable/ctx";
import { resolveAuthIssuer, resolveClerkIssuer, resolveSessionBroker } from "../../shared/authConfiguration";
import { allowedAuthEmailDomains, authEmailAllowed, manualAuthProvisioningEnabled } from "../../shared/authEmailPolicy";
import { entraSsoRequired, validEntraProof } from "../../shared/hostedMicrosoftSso";

export function betterAuthIssuer(): string {
  return resolveAuthIssuer(process.env);
}

/** Issuer of the Convex-hosted broker: this deployment's HTTP actions origin. */
export function convexHostedIssuer(): string | undefined {
  return process.env.CONVEX_SITE_URL || undefined;
}

/** Identity supplied here has already been verified by Convex auth.config. */
export function hostedPrincipal(identity: UserIdentity | null): PortablePrincipal {
  if (!identity) return { kind: "anonymous", runtime: "convex-hosted", assurance: "none" };
  const mode = resolveSessionBroker(process.env);
  if (mode === "convex") {
    const domains = allowedAuthEmailDomains(process.env);
    const requiresVerifiedEmail = domains.length > 0 || manualAuthProvisioningEnabled(process.env);
    // Custom JWT auth flattens nested object claims into dotted keys. Arrays
    // and scalar values keep their JSON types; this is not the raw JWT shape.
    // https://docs.convex.dev/auth/advanced/custom-jwt#custom-claims
    const entraProof = {
      userId: identity["societyer_entra.userId"],
      tenantId: identity["societyer_entra.tenantId"],
      objectId: identity["societyer_entra.objectId"],
      groupIds: identity["societyer_entra.groupIds"],
      authenticatedAt: identity["societyer_entra.authenticatedAt"],
      expiresAt: identity["societyer_entra.expiresAt"],
    };
    const entraVerified = process.env.SOCIETYER_ENTRA_LOGIN === "1" && validEntraProof(entraProof, {
      tenantId: process.env.MICROSOFT_LOGIN_TENANT_ID ?? "",
      groupIds: (process.env.MICROSOFT_LOGIN_GROUP_IDS ?? "").split(",").map(value => value.trim()),
    }) && entraProof.userId === identity.subject;
    if (!authEmailAllowed(identity.email, domains) || (entraSsoRequired() && !entraVerified)
      || (requiresVerifiedEmail && identity.emailVerified !== true && !entraVerified)) {
      return { kind: "anonymous", runtime: "convex-hosted", assurance: "none" };
    }
    // Only this deployment's own signer is trusted; there is no machine bridge.
    const convexIssuer = convexHostedIssuer();
    if (!convexIssuer || identity.issuer !== convexIssuer) return { kind: "anonymous", runtime: "convex-hosted", assurance: "none" };
    const sessionEvidence = hostedSessionEvidence(identity, entraVerified ? entraProof : undefined);
    return {
      kind: "user",
      runtime: "convex-hosted",
      assurance: "verified-jwt",
      subject: identity.subject,
      issuer: convexIssuer,
      authProvider: "convex",
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email,
      emailVerified: identity.emailVerified,
      ...(identity.societyer_mfa_verified === true ? { secondFactorVerified: true } : {}),
      ...(identity.name ? { name: identity.name } : {}),
      sessionEvidence,
    };
  }
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
    ...(isBetterAuth && !bridgeIssuer && identity.societyer_mfa_verified === true ? { secondFactorVerified: true } : {}),
    ...(isClerk && typeof identity.sid === "string" ? { authSessionId: identity.sid } : {}),
    ...(bridgeIssuer ? { gatewayService: true } : {}),
    ...(identity.name ? { name: identity.name } : {}),
  };
}

/**
 * How this Convex-hosted session authenticated, from deployment-signed claims
 * (flattened to dotted keys, like the Entra proof). Pass `entraProof` only
 * after it validated against this deployment and the JWT subject.
 */
function hostedSessionEvidence(identity: UserIdentity, entraProof?: Record<string, unknown>): PrincipalSessionEvidence {
  const sessionId = identity["societyer_session.id"];
  const createdAt = identity["societyer_session.createdAt"];
  const evidence: PrincipalSessionEvidence = {
    ...(typeof sessionId === "string" && sessionId ? { sessionId } : {}),
    ...(typeof createdAt === "number" && Number.isFinite(createdAt) ? { authenticatedAt: createdAt } : {}),
  };
  if (!entraProof) return evidence;
  const { tenantId, objectId, groupIds, authenticatedAt, expiresAt } = entraProof;
  if (typeof tenantId !== "string" || typeof objectId !== "string" || !Array.isArray(groupIds)
    || typeof authenticatedAt !== "number" || typeof expiresAt !== "number") return evidence;
  const groups = groupIds.filter((id): id is string => typeof id === "string").map((id) => id.toLowerCase());
  return { ...evidence, microsoft: { tenantId: tenantId.toLowerCase(), objectId: objectId.toLowerCase(), groupIds: groups, authenticatedAt, expiresAt } };
}
