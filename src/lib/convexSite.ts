import { resolvedConvexUrl } from "./appRuntime";

/** Self-hosted backends serve httpActions on an adjacent port; Convex cloud on `.convex.site`. */
function siteUrlFor(apiUrl: string): string {
  if (apiUrl.includes(":3220")) return apiUrl.replace(":3220", ":3221");
  if (apiUrl.includes(":3210")) return apiUrl.replace(":3210", ":3211");
  if (apiUrl.includes(".convex.cloud")) return apiUrl.replace(".convex.cloud", ".convex.site");
  return apiUrl.replace(/\/+$/, "");
}

/**
 * Base origin for Convex httpAction routes (ai-chat stream, the calendar feed,
 * etc.). Self-hosted backends serve httpActions on an adjacent port (3210→3211,
 * 3220→3221); Convex cloud serves them from the `.convex.site` domain. Falls
 * back to the trimmed API URL for anything else.
 */
export function convexSiteUrl(): string {
  return siteUrlFor(String(import.meta.env.VITE_CONVEX_URL ?? ""));
}

/**
 * Origin serving Convex-hosted sign-in (AUTH_MODE=convex). Follows the server
 * chosen at runtime; VITE_CONVEX_SITE_URL covers custom domains where the
 * HTTP actions origin can't be derived from the API URL.
 */
export function convexAuthSiteUrl(): string {
  const configured = String(import.meta.env.VITE_CONVEX_SITE_URL ?? "").trim();
  return configured ? configured.replace(/\/+$/, "") : siteUrlFor(resolvedConvexUrl());
}
