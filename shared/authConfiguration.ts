/**
 * Shared deployment checks: one selected human session broker, plus an internal machine signer.
 * `convex` runs Better Auth inside the Convex deployment itself (no Node auth server).
 */
export type SessionBroker = "none" | "better-auth" | "clerk" | "convex";
export type AuthEnvironment = Record<string, string | undefined>;
export const DEFAULT_AUTH_ISSUER = "http://127.0.0.1:5173";

export function isLocalBackendUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const ipv4 = host.split(".").map(Number);
    const privateIpv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) && ipv4.every((part) => part >= 0 && part <= 255)
      && (ipv4[0] === 10 || (ipv4[0] === 192 && ipv4[1] === 168) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31));
    return ["localhost", "127.0.0.1", "[::1]", "backend", "convex-backend"].includes(host)
      || host.endsWith(".localhost") || host.endsWith(".home")
      || host.endsWith(".local") || host.endsWith(".internal")
      || privateIpv4;
  } catch { return false; }
}

function broker(value: string | undefined): SessionBroker | undefined {
  if (!value) return undefined;
  if (value === "none" || value === "better-auth" || value === "clerk" || value === "convex") return value;
  throw new Error(`Unsupported session broker "${value}". Configure none for local data, or better-auth/clerk/convex for hosted data.`);
}

/** Reject disagreements instead of silently treating a typo/new provider as anonymous mode. */
export function resolveSessionBroker(env: AuthEnvironment): SessionBroker {
  const server = broker(env.AUTH_MODE);
  const browser = broker(env.VITE_AUTH_MODE);
  if (server && browser && server !== browser) throw new Error("AUTH_MODE and VITE_AUTH_MODE must select the same session broker.");
  return server ?? browser ?? "none";
}

export function resolveAuthIssuer(env: AuthEnvironment): string {
  const issuer = env.BETTER_AUTH_BASE_URL ?? env.VITE_AUTH_BASE_URL ?? DEFAULT_AUTH_ISSUER;
  let url: URL;
  try { url = new URL(issuer); } catch { throw new Error("The Better Auth issuer must be an absolute URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("The Better Auth issuer must be an HTTP(S) URL without credentials, query or fragment.");
  }
  if (url.protocol !== "https:" && !isLocalBackendUrl(issuer)) throw new Error("Hosted Better Auth requires an HTTPS issuer.");
  // JWT iss is an exact string, not a normalized URL. Keep all runtimes on the same spelling.
  if (issuer.endsWith("/")) throw new Error("The Better Auth issuer must not have a trailing slash.");
  return issuer;
}

export function validateHostedAuth(env: AuthEnvironment, backendUrl?: string): SessionBroker {
  const mode = resolveSessionBroker(env);
  if (backendUrl && !isLocalBackendUrl(backendUrl) && mode === "none") {
    throw new Error("Hosted resources require a selected Better Auth, Clerk or Convex session broker. Local auth-disabled mode cannot connect to a hosted backend.");
  }
  if (mode === "better-auth") {
    if (backendUrl && !isLocalBackendUrl(backendUrl) && !env.BETTER_AUTH_BASE_URL && !env.VITE_AUTH_BASE_URL) {
      throw new Error("Hosted Better Auth requires an explicitly configured issuer URL.");
    }
    resolveAuthIssuer(env);
    if (env.BETTER_AUTH_BASE_URL && env.VITE_AUTH_BASE_URL && env.BETTER_AUTH_BASE_URL !== env.VITE_AUTH_BASE_URL) {
      throw new Error("The server and browser Better Auth issuer URLs must match exactly.");
    }
  }
  if (mode === "clerk" && env.CLERK_JWT_ISSUER_DOMAIN) resolveClerkIssuer(env);
  return mode;
}

export function authSessionDurationSeconds(env: AuthEnvironment): number {
  const value = Number(env.AUTH_SESSION_MAX_AGE_SECONDS ?? 8 * 60 * 60);
  if (!Number.isInteger(value) || value < 300 || value > 86400) throw new Error("AUTH_SESSION_MAX_AGE_SECONDS must be between 300 and 86400 seconds.");
  return value;
}

/** Exact instance issuer; an issuer is never normalized into another identity key. */
export function resolveClerkIssuer(env: AuthEnvironment): string {
  const issuer = env.CLERK_JWT_ISSUER_DOMAIN?.trim();
  if (!issuer) throw new Error("Clerk mode requires CLERK_JWT_ISSUER_DOMAIN.");
  let url: URL;
  try { url = new URL(issuer); } catch { throw new Error("Clerk issuer must be an HTTPS origin."); }
  if (url.protocol !== "https:" || url.origin !== issuer || url.username || url.password) throw new Error("Clerk issuer must be an exact HTTPS origin without a trailing slash.");
  return issuer;
}

/**
 * Frontend origins allowed to use the Convex-hosted broker, from the Convex
 * deployment's comma-separated SITE_URL. The first is the primary app origin.
 */
export function resolveConvexAuthSiteUrls(env: AuthEnvironment): string[] {
  const values = (env.SITE_URL ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new Error("AUTH_MODE=convex requires SITE_URL (the app's origin, e.g. https://app.example.org) on the Convex deployment.");
  return values.map((value) => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error(`SITE_URL entry "${value}" must be an absolute URL.`); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`SITE_URL entry "${value}" must be an HTTP(S) origin without credentials.`);
    if (url.protocol !== "https:" && !isLocalBackendUrl(value)) throw new Error(`SITE_URL entry "${value}" must use HTTPS outside local development.`);
    return url.origin;
  });
}
