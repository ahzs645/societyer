import { getRuntimeMode, isLocalRuntimeMode } from "./runtimeMode";
import { isBrowserLocalWorkspace, isDemoPath } from "./appRuntime";
import { appRouteBasePath } from "./appRouteHref";

export function isStaticDemoRuntime() {
  return isDemoPath();
}

export function isLocalDataRuntime() {
  return isStaticDemoRuntime() || isLocalRuntimeMode() || isBrowserLocalWorkspace();
}

/**
 * Whether the local data store is the bundled demo (the public /demo walkthrough,
 * or the IndexedDB build the e2e harness runs on), as chosen in
 * createLocalClient (localWorkspaceAdapter.ts). An operator's own workspace —
 * desktop, or a browser-local workspace picked during setup — starts empty and
 * holds real records, so demo seeding or wiping must never run there.
 * Only meaningful when isLocalDataRuntime() is true.
 */
export function isLocalDemoDataRuntime() {
  if (isStaticDemoRuntime()) return true;
  if (getRuntimeMode() === "electron-local") return false;
  return !isBrowserLocalWorkspace();
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
