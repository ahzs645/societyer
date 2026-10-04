import { validateHostedAuth } from "../../shared/authConfiguration";
import { isLocalDataRuntime } from "./staticRuntime";
import { resolvedConvexUrl } from "./appRuntime";

export type AuthMode = "none" | "better-auth" | "clerk";

export function getAuthMode(): AuthMode {
  if (isLocalDataRuntime()) return "none";
  return validateHostedAuth(import.meta.env, resolvedConvexUrl());
}

export function isBetterAuthMode() {
  return getAuthMode() === "better-auth";
}

export function isNoAuthMode() {
  return getAuthMode() === "none";
}

export function isAuthenticatedAuthMode() {
  return getAuthMode() !== "none";
}
