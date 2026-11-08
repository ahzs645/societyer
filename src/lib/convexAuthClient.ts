import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { convexAuthSiteUrl } from "./convexSite";
import { createOAuthHandoff } from "../../shared/completeHostedOAuth";

/**
 * Better Auth client for the Convex-hosted broker (AUTH_MODE=convex). The app
 * and the deployment's HTTP actions are on different origins, so the session
 * cookie is kept by the cross-domain plugin (localStorage) instead of the browser.
 */
export const authClient = createAuthClient({
  baseURL: convexAuthSiteUrl(),
  // Renew an active persistent session and recheck it after focus/reconnect.
  sessionOptions: { refetchInterval: 300, refetchOnWindowFocus: true, refetchWhenOffline: false },
  plugins: [convexClient(), crossDomainClient(), twoFactorClient()],
});

export type BetterAuthSession = typeof authClient.$Infer.Session;

export const completeOAuthCallback = createOAuthHandoff({
  verify: async token => (await authClient.crossDomain.oneTimeToken.verify({ token })).data?.session?.token ?? null,
  establishSession: async token => {
    const result = await authClient.getSession({ fetchOptions: { headers: { Authorization: `Bearer ${token}` } } });
    if (!result.data?.session) throw new Error("Your sign-in could not be completed. Please sign in again.");
  },
  refreshSession: () => authClient.updateSession(),
}, { href: () => window.location.href, replace: url => window.history.replaceState({}, "", url) });

/** Convex token minted by the deployment's own signer for the current session. */
export async function fetchConvexToken(_forceRefresh?: boolean): Promise<string | null> {
  const result = await authClient.convex.token({ fetchOptions: { throw: false } });
  return result.data?.token ?? null;
}
