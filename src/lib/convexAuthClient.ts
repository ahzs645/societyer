import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { convexAuthSiteUrl } from "./convexSite";
import { createOAuthHandoff } from "../../shared/completeHostedOAuth";
import { createHandoffRedeemer, type HandoffFetch } from "./sessionHandoff";
import { rememberStartupWorkspace } from "../auth/startupWorkspace";

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

async function mintConvexToken(): Promise<string | null> {
  const result = await authClient.convex.token({ fetchOptions: { throw: false } });
  return result.data?.token ?? null;
}

/**
 * A token minted while completing the OAuth hand-off, kept for Convex's first
 * connection. Tied to the session it was minted for and short-lived, so it can
 * never be handed to a later sign-in.
 */
let handoffConvexToken: { token: string; sessionToken: string; mintedAt: number } | null = null;
const HANDOFF_TOKEN_TTL_MS = 60_000;

export const completeOAuthCallback = createOAuthHandoff({
  // Redeeming the one-time token stores the session cookie (cross-domain plugin).
  verify: async token => (await authClient.crossDomain.oneTimeToken.verify({ token })).data?.session?.token ?? null,
  // Prove the stored cookie works by minting the Convex token Convex will ask
  // for next. This replaces a second session fetch and takes the token
  // request out of the sign-in chain: the session hook still loads the
  // session on mount, and Convex receives this token straight away.
  establishSession: async sessionToken => {
    const token = await mintConvexToken();
    if (!token) throw new Error("Your sign-in could not be completed. Please sign in again.");
    handoffConvexToken = { token, sessionToken, mintedAt: Date.now() };
  },
  refreshSession: () => authClient.updateSession(),
}, { href: () => window.location.href, replace: url => window.history.replaceState({}, "", url) });

/**
 * Redeems a cross-domain handoff code on `/handoff` (see sessionHandoff.ts). The
 * cross-domain plugin stores the shared session from the response, so the
 * session hook mounts already signed in.
 */
export const completeSessionHandoff = createHandoffRedeemer({
  fetch: authClient.$fetch as unknown as HandoffFetch,
  refreshSession: () => authClient.updateSession(),
  rememberWorkspace: rememberStartupWorkspace,
}, {
  href: () => window.location.href,
  replace: url => window.history.replaceState({}, "", url),
  basePath: import.meta.env.BASE_URL.replace(/\/$/, ""),
});

/** Convex token minted by the deployment's own signer for the current session. */
export async function fetchConvexToken(_forceRefresh?: boolean): Promise<string | null> {
  // Used once, and only while it is fresh and the stored session is still the
  // one it was minted for; otherwise mint as usual.
  const handoff = handoffConvexToken;
  handoffConvexToken = null;
  if (
    handoff &&
    Date.now() - handoff.mintedAt < HANDOFF_TOKEN_TTL_MS &&
    authClient.getCookie().includes(`session_token=${handoff.sessionToken}`)
  ) {
    return handoff.token;
  }
  return mintConvexToken();
}
