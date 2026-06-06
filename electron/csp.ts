export const DESKTOP_CSP_HEADER =
  "default-src 'self'; " +
  "base-uri 'self'; " +
  "object-src 'none'; " +
  "frame-ancestors 'none'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com data:; " +
  "img-src 'self' data: blob: file: http: https:; " +
  "connect-src 'self' http: https: ws: wss:; " +
  "worker-src 'self' blob:";

export function desktopSecurityHeadersForContentType(contentType: string): [string, string][] {
  const headers: [string, string][] = [
    ["content-type", contentType],
    ["x-content-type-options", "nosniff"],
  ];
  if (contentType === "text/html") {
    headers.push(["content-security-policy", DESKTOP_CSP_HEADER]);
  }
  return headers;
}
