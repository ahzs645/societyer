export type AuthMode = "none" | "better-auth" | "clerk";

export function getAuthMode(): AuthMode {
  const mode = import.meta.env.VITE_AUTH_MODE;
  return mode === "better-auth" || mode === "clerk" ? mode : "none";
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
