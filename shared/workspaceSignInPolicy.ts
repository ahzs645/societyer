/**
 * Per-workspace sign-in requirement (table `workspaceSignInPolicies`).
 *
 * The policy is checked against how THIS session authenticated
 * (`principal.sessionEvidence`), never against the login methods an account
 * happens to have linked. See docs/shared-workspaces/architecture.md.
 */
import type { PortablePrincipal } from "./portable/ctx";

export type WorkspaceSignInMethod = "any" | "microsoft";
export type WorkspaceSignInPolicy = {
  requiredMethod: WorkspaceSignInMethod;
  microsoftTenantId?: string;
  microsoftGroupIds?: readonly string[];
  allowedEmailDomains?: readonly string[];
  supportEmail?: string;
};
export type SignInRequirement = "microsoft" | "email-domain";
export type WorkspaceSignInEvaluation = { ok: true } | { ok: false; requirement: SignInRequirement };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Same shape as SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS (shared/authEmailPolicy.ts).
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;

export function normalizeDirectoryId(value: string): string | null {
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

export function normalizeEmailDomain(value: string): string | null {
  const domain = value.trim().toLowerCase();
  return DOMAIN.test(domain) ? domain : null;
}

function emailDomain(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const parts = email.trim().toLowerCase().split("@");
  return parts.length === 2 && parts[0] && !/\s/.test(parts[0]) ? parts[1] : null;
}

export function evaluateWorkspaceSignIn(
  policy: WorkspaceSignInPolicy | null | undefined,
  principal: PortablePrincipal,
  now = Date.now(),
): WorkspaceSignInEvaluation {
  if (!policy) return { ok: true };
  const session = principal.kind === "user" && principal.assurance === "verified-jwt" ? principal : null;
  const microsoft = session?.sessionEvidence?.microsoft;
  if (policy.requiredMethod !== "any") {
    // An unknown method or a policy without tenant/groups can never be met: fail closed.
    const tenant = policy.requiredMethod === "microsoft" ? policy.microsoftTenantId?.toLowerCase() : undefined;
    const groups = (policy.microsoftGroupIds ?? []).map((id) => id.toLowerCase());
    const met = Boolean(tenant && groups.length && microsoft
      && microsoft.tenantId.toLowerCase() === tenant
      && microsoft.groupIds.some((id) => groups.includes(id.toLowerCase()))
      && Number.isFinite(microsoft.expiresAt) && microsoft.expiresAt > now);
    if (!met) return { ok: false, requirement: "microsoft" };
  }
  const domains = policy.allowedEmailDomains ?? [];
  if (domains.length) {
    // Only a verified mailbox counts. A Microsoft session doesn't prove the
    // account's email: with explicit provider linking the two can differ.
    const domain = emailDomain(session?.email);
    if (!domain || session?.emailVerified !== true || !domains.some((allowed) => allowed.toLowerCase() === domain)) {
      return { ok: false, requirement: "email-domain" };
    }
  }
  return { ok: true };
}

export function signInRequirementMessage(requirement: SignInRequirement): string {
  return requirement === "microsoft"
    ? "This workspace requires a Microsoft sign-in from its organization. Sign in with Microsoft to continue."
    : "This workspace only accepts verified email addresses from its approved domains.";
}
