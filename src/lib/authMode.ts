export type AuthMode = "none" | "better-auth";

export function getAuthMode(): AuthMode {
  return import.meta.env.VITE_AUTH_MODE === "better-auth"
    ? "better-auth"
    : "none";
}

export function isBetterAuthMode() {
  return getAuthMode() === "better-auth";
}

export function isNoAuthMode() {
  return getAuthMode() === "none";
}
