import { isLocalRuntimeMode } from "./runtimeMode";

/**
 * WHERE THE APP'S DATA LIVES, decided at runtime instead of only at build time.
 *
 * A build can hard-wire this (VITE_RUNTIME_MODE for the Electron/IndexedDB
 * builds, VITE_CONVEX_URL for a server deployment). When neither is set — the
 * static Pages build that the installable PWA is served from — the app has no
 * backend to talk to and no way to guess one, so the first run asks the operator
 * and stores the answer here.
 *
 * Nothing in this module may import `staticRuntime`: `staticRuntime` consumes
 * this file to answer `isLocalDataRuntime()`, so the dependency only runs one
 * way.
 */

const STORAGE_KEY = "societyer:app-runtime";
const DEV_FALLBACK_CONVEX_URL = "http://127.0.0.1:3210";

export type AppRuntimeChoice =
  | { mode: "local"; workspaceId: string; chosenAtISO: string }
  | { mode: "server"; url: string; chosenAtISO: string };

export type AppRuntimeResolution =
  /** `/demo` — the seeded, read-mostly public walkthrough. */
  | { kind: "demo" }
  /** The build pinned a local runtime (Electron, or the IndexedDB e2e harness). */
  | { kind: "builtin-local" }
  /** A browser-local workspace this device opted into during setup. */
  | { kind: "local"; workspaceId: string }
  | { kind: "server"; url: string; source: "stored" | "build" | "dev-fallback" }
  /** No backend is configured and nobody has chosen one yet. */
  | { kind: "unconfigured" };

export function isDemoPath() {
  if (typeof window === "undefined") return false;
  return window.location.pathname === "/demo" || window.location.pathname.startsWith("/demo/");
}

function buildTimeConvexUrl() {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

export function readAppRuntimeChoice(): AppRuntimeChoice | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode browsers can throw on localStorage access. Treat that as
    // "nothing chosen" rather than crashing the whole app at import time.
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.mode === "local" && typeof parsed.workspaceId === "string" && parsed.workspaceId) {
      return { mode: "local", workspaceId: parsed.workspaceId, chosenAtISO: String(parsed.chosenAtISO ?? "") };
    }
    if (parsed?.mode === "server" && typeof parsed.url === "string" && parsed.url) {
      return { mode: "server", url: parsed.url, chosenAtISO: String(parsed.chosenAtISO ?? "") };
    }
  } catch {
    // Corrupt value: fall through and let setup run again.
  }
  return null;
}

export function writeAppRuntimeChoice(choice: AppRuntimeChoice) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
}

export function clearAppRuntimeChoice() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function newLocalWorkspaceId() {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `pwa-${random}`;
}

export function resolveAppRuntime(): AppRuntimeResolution {
  if (isDemoPath()) return { kind: "demo" };
  if (isLocalRuntimeMode()) return { kind: "builtin-local" };

  const stored = readAppRuntimeChoice();
  if (stored?.mode === "local") return { kind: "local", workspaceId: stored.workspaceId };
  if (stored?.mode === "server") return { kind: "server", url: stored.url, source: "stored" };

  const configured = buildTimeConvexUrl();
  if (configured) return { kind: "server", url: configured, source: "build" };

  // `npm run dev` with no env still expects the conventional local backend, so
  // developers don't get bounced into setup on every fresh checkout.
  if (import.meta.env.DEV) {
    return { kind: "server", url: DEV_FALLBACK_CONVEX_URL, source: "dev-fallback" };
  }

  return { kind: "unconfigured" };
}

/** True when this device runs its own browser-local workspace (not the demo). */
export function isBrowserLocalWorkspace() {
  return resolveAppRuntime().kind === "local";
}

export function browserLocalWorkspaceId(): string | null {
  const resolved = resolveAppRuntime();
  return resolved.kind === "local" ? resolved.workspaceId : null;
}

export function appRuntimeNeedsSetup() {
  return resolveAppRuntime().kind === "unconfigured";
}

/** The Convex URL to connect to, for the runtimes that talk to a server. */
export function resolvedConvexUrl(): string {
  const resolved = resolveAppRuntime();
  if (resolved.kind === "server") return resolved.url;
  return buildTimeConvexUrl() ?? DEV_FALLBACK_CONVEX_URL;
}

export function normalizeServerUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter the address of your Societyer backend.");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error(`"${value}" is not a valid address.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The address must start with http:// or https://.");
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

/**
 * Best-effort reachability probe. Convex backends answer `/version`; a failure
 * here is advisory, because a backend can legitimately sit behind a proxy that
 * blocks cross-origin reads while the WebSocket still connects.
 */
export async function probeServerUrl(url: string, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/version`, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false as const, message: `The server answered with ${response.status}.` };
    }
    const version = (await response.text()).trim().slice(0, 40);
    return { ok: true as const, message: version ? `Reachable (backend ${version}).` : "Reachable." };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false as const, message: "No answer within 6 seconds." };
    }
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "The server could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}
