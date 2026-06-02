import { isLocalRuntimeMode } from "./runtimeMode";

export function isStaticDemoRuntime() {
  if (typeof window === "undefined") return false;
  return window.location.pathname === "/demo" || window.location.pathname.startsWith("/demo/");
}

export function isLocalDataRuntime() {
  return isStaticDemoRuntime() || isLocalRuntimeMode();
}
