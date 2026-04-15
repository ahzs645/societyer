import { createAuthClient } from "better-auth/react";

const baseURL = import.meta.env.VITE_AUTH_BASE_URL as string | undefined;

export const authClient = createAuthClient(
  baseURL ? { baseURL } : undefined,
);

export type BetterAuthSession = typeof authClient.$Infer.Session;
