/**
 * Base origin for Convex httpAction routes (ai-chat stream, the calendar feed,
 * etc.). Self-hosted backends serve httpActions on an adjacent port (3210→3211,
 * 3220→3221); Convex cloud serves them from the `.convex.site` domain. Falls
 * back to the trimmed API URL for anything else.
 */
export function convexSiteUrl(): string {
  const apiUrl = String(import.meta.env.VITE_CONVEX_URL ?? "");
  if (apiUrl.includes(":3220")) return apiUrl.replace(":3220", ":3221");
  if (apiUrl.includes(":3210")) return apiUrl.replace(":3210", ":3211");
  if (apiUrl.includes(".convex.cloud")) return apiUrl.replace(".convex.cloud", ".convex.site");
  return apiUrl.replace(/\/+$/, "");
}
