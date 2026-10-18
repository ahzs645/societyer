/**
 * Whether the configured model calls tools, remembered per server address and
 * model on this device. Learned from the Settings tool test and from the
 * assistant itself (a server that refuses `tools` is marked unsupported).
 * Unknown means "try": the assistant offers tools and falls back without them.
 */
import type { DeviceAiConfig } from "./config";

export type DeviceToolSupport = "unknown" | "supported" | "unsupported";

const STORAGE_KEY = "societyer:local-ai:tool-support";
const MAX_ENTRIES = 40;

let entries: Record<string, Exclude<DeviceToolSupport, "unknown">> | null = null;
const listeners = new Set<() => void>();

function keyFor(config: Pick<DeviceAiConfig, "baseUrl" | "model">): string {
  return `${config.baseUrl}|${config.model}`;
}

function load(): Record<string, Exclude<DeviceToolSupport, "unknown">> {
  if (entries) return entries;
  entries = {};
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (value === "supported" || value === "unsupported") entries[key] = value;
      }
    }
  } catch {
    // Unreadable or no storage: everything is unknown.
  }
  return entries;
}

export function deviceToolSupport(config: Pick<DeviceAiConfig, "baseUrl" | "model">): DeviceToolSupport {
  return load()[keyFor(config)] ?? "unknown";
}

export function rememberDeviceToolSupport(config: Pick<DeviceAiConfig, "baseUrl" | "model">, support: DeviceToolSupport) {
  const current = { ...load() };
  const key = keyFor(config);
  // Re-inserted last, so the oldest entries are the ones dropped.
  delete current[key];
  if (support !== "unknown") current[key] = support;
  const kept = Object.entries(current).slice(-MAX_ENTRIES);
  entries = Object.fromEntries(kept);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Remembered for this page load only.
  }
  for (const listener of listeners) listener();
}

export function subscribeDeviceToolSupport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: forget everything learned. */
export function resetDeviceToolSupportForTests() {
  entries = {};
  for (const listener of listeners) listener();
}
