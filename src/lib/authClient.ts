import { createAuthClient } from "better-auth/react";
import { jwtClient, twoFactorClient } from "better-auth/client/plugins";

const baseURL = import.meta.env.VITE_AUTH_BASE_URL as string | undefined;

export const authClient = createAuthClient({ baseURL, plugins: [jwtClient(), twoFactorClient()] });

export type BetterAuthSession = typeof authClient.$Infer.Session;

/** Convex token from the gateway's JWT plugin. */
export async function fetchConvexToken(): Promise<string | null> {
  const result = await authClient.token();
  return result.data?.token ?? null;
}
