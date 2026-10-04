import type { PortablePrincipal } from "../portable/ctx";

export type AuthBinding = {
  [key: string]: unknown;
  authSubject?: string;
  authIssuer?: string;
  authProvider?: string;
};

export function normalizeAuthIssuer(issuer: string): string {
  return issuer.trim().replace(/\/$/, "");
}

/** Hosted identities are bound to an issuer and subject, never an email. */
export function matchesAuthBinding(binding: AuthBinding, principal: PortablePrincipal): boolean {
  if (principal.kind !== "user" || binding.authSubject !== principal.subject) return false;
  if (principal.assurance === "trusted-workspace") return true;
  if (!principal.issuer) return false;
  if (binding.authIssuer) {
    return normalizeAuthIssuer(binding.authIssuer) === normalizeAuthIssuer(principal.issuer);
  }
  // Existing Better Auth bindings predate issuer storage. Clerk must never
  // inherit those records even when both providers issue the same subject.
  return principal.authProvider === "better-auth" &&
    (!binding.authProvider || binding.authProvider === "better-auth");
}
