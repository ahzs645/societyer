import { isLocalRuntimeMode } from "./runtimeMode";
import { isBrowserLocalWorkspace, isDemoPath } from "./appRuntime";

export function isStaticDemoRuntime() {
  return isDemoPath();
}

export function isLocalDataRuntime() {
  return isStaticDemoRuntime() || isLocalRuntimeMode() || isBrowserLocalWorkspace();
}

/**
 * Prefix for app-shell routes built as raw strings (window.open, clipboard
 * links) rather than <Link>, which react-router's basename can't rewrite.
 * Mirrors the `routerBasename` the demo runtime renders the app under.
 */
export function appBasePath() {
  return isStaticDemoRuntime() ? "/demo" : "";
}
