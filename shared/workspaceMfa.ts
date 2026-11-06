export const WORKSPACE_MFA_POLICIES = ["optional", "owners-admins", "everyone"] as const;
export type WorkspaceMfaPolicy = typeof WORKSPACE_MFA_POLICIES[number];

export function workspaceRequiresMfa(policy: unknown, role: string | undefined): boolean {
  return policy === "everyone" || (policy === "owners-admins" && (role === "Owner" || role === "Admin"));
}

export const CLERK_MFA_SESSION_PATH = "/workspace-mfa/clerk-session";
export const CLERK_MFA_PROOF_REFRESH_MS = 60 * 60 * 1000;

export function clerkSecondFactorVerified(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && Number.isSafeInteger(value[1]) && value[1] >= 0;
}
