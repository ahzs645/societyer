import { createAuthClient } from "better-auth/react";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { convexAuthSiteUrl } from "./convexSite";

/**
 * Better Auth client for the Convex-hosted broker (AUTH_MODE=convex). The app
 * and the deployment's HTTP actions are on different origins, so the session
 * cookie is kept by the cross-domain plugin (localStorage) instead of the browser.
 */
export const authClient = createAuthClient({
  baseURL: convexAuthSiteUrl(),
  plugins: [convexClient(), crossDomainClient()],
});

export type BetterAuthSession = typeof authClient.$Infer.Session;

/** Convex token minted by the deployment's own signer for the current session. */
export async function fetchConvexToken(_forceRefresh?: boolean): Promise<string | null> {
  const result = await authClient.convex.token({ fetchOptions: { throw: false } });
  return result.data?.token ?? null;
}
