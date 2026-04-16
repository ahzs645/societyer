import { isStaticDemoRuntime } from "./staticRuntime";

const KEY = "societyer.demo";

export function isDemoMode(): boolean {
  if (isStaticDemoRuntime()) return true;
  const url = new URLSearchParams(window.location.search);
  if (url.has("demo")) {
    const v = url.get("demo");
    const on = v !== "0" && v !== "false";
    localStorage.setItem(KEY, on ? "1" : "0");
    return on;
  }
  return localStorage.getItem(KEY) !== "0";
}

export function setDemoMode(on: boolean) {
  if (isStaticDemoRuntime()) return;
  localStorage.setItem(KEY, on ? "1" : "0");
}
