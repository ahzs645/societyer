import { validateHostedAuth, type SessionBroker } from "../../shared/authConfiguration";
import { isLocalDataRuntime } from "./staticRuntime";
import { resolvedConvexUrl } from "./appRuntime";

export type AuthMode = SessionBroker;

export function getAuthMode(): AuthMode {
  if (isLocalDataRuntime()) return "none";
  return validateHostedAuth(import.meta.env, resolvedConvexUrl());
}

export function isBetterAuthMode() {
  return getAuthMode() === "better-auth";
}

/** Better Auth sessions, whether served by the Node gateway or by Convex itself. */
export function usesBetterAuthClient(mode: AuthMode = getAuthMode()) {
  return mode === "better-auth" || mode === "convex";
}

export function isNoAuthMode() {
  return getAuthMode() === "none";
}

export function isAuthenticatedAuthMode() {
  return getAuthMode() !== "none";
}
