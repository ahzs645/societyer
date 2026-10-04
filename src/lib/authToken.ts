import { getAuthMode } from "./authMode";
import { isLocalDataRuntime } from "./staticRuntime";

export type AuthTokenGetter = (forceRefresh?: boolean) => Promise<string | null>;

let tokenGetter: AuthTokenGetter | null = null;

/** Share the active session with HTTP calls that do not use Convex hooks. */
export function registerAuthTokenGetter(getToken: AuthTokenGetter) {
  tokenGetter = getToken;
  return () => {
    if (tokenGetter === getToken) tokenGetter = null;
  };
}

export async function getAuthToken(): Promise<string | null> {
  if (getAuthMode() === "none" || isLocalDataRuntime()) return null;
  const token = await tokenGetter?.();
  if (!token) throw new Error("Sign in again to continue.");
  return token;
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await getAuthToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
