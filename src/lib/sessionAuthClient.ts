import { getAuthMode } from "./authMode";

/**
 * What the app uses from either Better Auth client. The plugin-specific token
 * call stays behind `fetchConvexToken`; everything else is the shared core API.
 */
export type SessionAuthModule = {
  authClient: Pick<typeof import("./authClient").authClient, "useSession" | "signIn" | "signUp" | "signOut" | "requestPasswordReset" | "resetPassword">;
  fetchConvexToken: () => Promise<string | null>;
};

/**
 * The Better Auth client for the selected broker: the Node gateway's
 * (`better-auth`) or the Convex deployment's own (`convex`). Loaded lazily so
 * other modes never bundle it into the first page load.
 */
export function loadSessionAuthClient(): Promise<SessionAuthModule> {
  return getAuthMode() === "convex"
    ? import("./convexAuthClient")
    : import("./authClient");
}
