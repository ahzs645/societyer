import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
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

type GatewayAuthProviders = {
  mode: string;
  microsoft?: { enabled: boolean };
  authenticatorEnrollment?: boolean;
};

export function useGatewayAuthProviders() {
  const { mode } = useAuth();
  const [providers, setProviders] = useState<GatewayAuthProviders | null>(null);
  useEffect(() => {
    if (mode !== "better-auth") return;
    const controller = new AbortController();
    void import("../lib/authClient").then(async ({ authClient }) => {
      if (controller.signal.aborted) return;
      const { data } = await authClient.$fetch<GatewayAuthProviders>("/providers", { signal: controller.signal });
      if (!controller.signal.aborted && data?.mode === "better-auth") setProviders(data);
    }).catch(() => {
      // Email sign-in remains available when provider discovery is unavailable.
    });
    return () => controller.abort();
  }, [mode]);
  return mode === "better-auth" ? providers : null;
}

export function useAuthenticatorEnrollment() {
  const hosted = useAuthCapabilities();
  const gateway = useGatewayAuthProviders();
  return hosted?.authenticatorEnrollment === true || gateway?.authenticatorEnrollment === true;
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
