import { isStaticDemoRuntime } from "./staticRuntime";

// On/off UI preferences (sidebar sections, AI chat). Connected and local
// workspaces keep them in localStorage. The static demo keeps them for the
// browser session only (sessionStorage), so a shared demo link always starts
// from the defaults but a visitor's toggles still take effect. If storage is
// unavailable the value lives in memory until reload.
const memory = new Map<string, boolean>();

function preferenceStorage(): Storage | null {
  try {
    return isStaticDemoRuntime() ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function readPreferenceFlag(key: string): boolean {
  try {
    const stored = preferenceStorage()?.getItem(key);
    if (stored === "1" || stored === "0") return stored === "1";
  } catch {
    // fall through to the in-memory value
  }
  return memory.get(key) ?? false;
}

export function writePreferenceFlag(key: string, value: boolean): void {
  memory.set(key, value);
  try {
    preferenceStorage()?.setItem(key, value ? "1" : "0");
  } catch {
    // ignore quota / disabled-storage failures; the in-memory value applies
  }
}
