import { isLocalRuntimeMode } from "./runtimeMode";

export function isStaticDemoRuntime() {
  if (typeof window === "undefined") return false;
  return window.location.pathname === "/demo" || window.location.pathname.startsWith("/demo/");
}

export function isLocalDataRuntime() {
  return isStaticDemoRuntime() || isLocalRuntimeMode();
}

/**
 * Prefix for app-shell routes built as raw strings (window.open, clipboard
 * links) rather than <Link>, which react-router's basename can't rewrite.
 * Mirrors the `routerBasename` the demo runtime renders the app under.
 */
export function appBasePath() {
  return isStaticDemoRuntime() ? "/demo" : "";
}
