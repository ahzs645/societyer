import path from "node:path";

export function normalizeDesktopProtocolPathname(rawPath: string): string | null {
  const segments: string[] = [];
  for (const segment of rawPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.join("/");
}

export function protocolPathFromUrl(url: URL): string {
  // Preserve the established IndexedDB origin while resolving Vite's relative
  // ./assets imports from societyer-app://index.html correctly.
  if (url.hostname === "index.html") return decodeURIComponent(url.pathname || "/index.html");
  const hostPath = url.hostname ? `/${url.hostname}${url.pathname}` : url.pathname;
  return decodeURIComponent(hostPath);
}

export function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html";
  if (ext === ".js") return "text/javascript";
  if (ext === ".mjs") return "text/javascript";
  if (ext === ".css") return "text/css";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".json") return "application/json";
  if (ext === ".woff") return "font/woff";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}
