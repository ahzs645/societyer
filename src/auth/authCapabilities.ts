import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useAuth } from "./AuthProvider";

/**
 * What the Convex-hosted sign-in on this deployment can do (mail delivery,
 * sign-up, allowed email domains). Undefined while loading and outside
 * convex mode. Convex shares the subscription between callers.
 */
export function useAuthCapabilities() {
  const auth = useAuth();
  return useQuery(api.http.authCapabilities, auth.mode === "convex" ? {} : "skip");
}

/**
 * A label naming this instance: the operator's SOCIETYER_AUTH_INSTANCE_NAME,
 * else the email-domain allowlist when it has one domain (the instance then
 * belongs to that organization). Deployments older than `instanceName` just
 * don't send it.
 */
export function authInstanceLabel(
  capabilities: { instanceName?: string; allowedEmailDomains?: readonly string[] } | null | undefined,
): string | null {
  const instanceName = capabilities?.instanceName?.trim();
  if (instanceName) return instanceName;
  const domains = capabilities?.allowedEmailDomains;
  return domains?.length === 1 ? `${domains[0]} workspace` : null;
}

/** "Use your @a.org email" / "Use your @a.org or @b.org email". */
export function authEmailDomainHint(allowedEmailDomains: readonly string[]): string | null {
  if (!allowedEmailDomains.length) return null;
  return `Use your ${allowedEmailDomains.map((domain) => `@${domain}`).join(" or ")} email`;
}
