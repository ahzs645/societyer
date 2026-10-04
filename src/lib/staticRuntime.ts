import { isLocalRuntimeMode } from "./runtimeMode";
import { isBrowserLocalWorkspace, isDemoPath } from "./appRuntime";
import { appRouteBasePath } from "./appRouteHref";

export function isStaticDemoRuntime() {
  return isDemoPath();
}

export function isLocalDataRuntime() {
  return isStaticDemoRuntime() || isLocalRuntimeMode() || isBrowserLocalWorkspace();
}

/**
 * Prefix for app-shell routes built as raw strings (window.open, clipboard
 * links) rather than <Link>, which react-router's basename can't rewrite.
 * Mirrors BrowserRouter's basename. For window.open or copied links, use
 * appRouteHref/appRouteAbsoluteHref so desktop hash routing is preserved too.
 */
export function appBasePath() {
  return appRouteBasePath();
}
