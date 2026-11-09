import { getAuthMode } from "./authMode";

/**
 * What the app uses from either Better Auth client. The plugin-specific token
 * call stays behind `fetchConvexToken`; everything else is the shared core API.
 */
export type SessionAuthModule = {
  authClient: Pick<typeof import("./authClient").authClient, "$fetch" | "useSession" | "signIn" | "signUp" | "signOut" | "requestPasswordReset" | "resetPassword" | "sendVerificationEmail" | "twoFactor" | "listAccounts">;
  fetchConvexToken: (forceRefresh?: boolean) => Promise<string | null>;
  completeOAuthCallback?: () => Promise<void>;
  completeSessionHandoff?: () => Promise<void>;
};

/**
 * The Better Auth client for the selected broker: the Node gateway's
 * (`better-auth`) or the Convex deployment's own (`convex`). Loaded lazily so
 * other modes never bundle it into the first page load.
 */
export async function loadSessionAuthClient(): Promise<SessionAuthModule> {
  if (getAuthMode() !== "convex") return import("./authClient");
  const module = await import("./convexAuthClient");
  await module.completeOAuthCallback();
  await module.completeSessionHandoff();
  return module;
}
