import { protocol } from "electron";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DesktopEnvironment } from "./environment.js";
import { makeDesktopLogger } from "./observability.js";

export const SOCIETYER_APP_PROTOCOL = "societyer-app";

const logger = makeDesktopLogger("protocol");

export function registerDesktopProtocolPrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SOCIETYER_APP_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function normalizeDesktopProtocolPathname(rawPath: string): string | null {
  const segments: string[] = [];
  for (const segment of rawPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.join("/");
}

export function registerDesktopAppProtocol(environment: DesktopEnvironment) {
  if (environment.isDev) return;
  const distRoot = path.dirname(environment.distIndexPath);
  protocol.handle(SOCIETYER_APP_PROTOCOL, async (request) => {
    const filePath = await resolveProtocolFilePath(distRoot, request.url);
    return new Response(await readFile(filePath), {
      headers: [["content-type", contentTypeFor(filePath)]],
    });
  });
  void logger.info("registered app protocol", { scheme: SOCIETYER_APP_PROTOCOL, distRoot });
}

async function resolveProtocolFilePath(distRoot: string, requestUrl: string) {
  const fallback = path.join(distRoot, "index.html");
  try {
    const url = new URL(requestUrl);
    const normalized = normalizeDesktopProtocolPathname(decodeURIComponent(url.pathname));
    if (normalized === null) return fallback;
    const requested = normalized || "index.html";
    const candidate = path.resolve(distRoot, requested);
    if (!isWithin(candidate, distRoot)) return fallback;
    if (path.extname(candidate) && (await exists(candidate))) return candidate;
    if (await exists(path.join(candidate, "index.html"))) return path.join(candidate, "index.html");
    return fallback;
  } catch {
    return fallback;
  }
}

async function exists(filePath: string) {
  return stat(filePath).then(() => true, () => false);
}

function isWithin(filePath: string, root: string) {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html";
  if (ext === ".js") return "text/javascript";
  if (ext === ".css") return "text/css";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".woff") return "font/woff";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}
