/** AI intake on this device: a thin layer over the on-device AI settings
 * (src/lib/localAi). The server, model and optional key are set once in
 * Settings → On-device AI; this file only keeps the per-run intake choices
 * (use AI or not, token budget). Text is PII-redacted (same-length masks)
 * before every call and restricted files are never sent (shared/intake/llm.ts).
 * Requests go through the device transport: a direct fetch in a browser, the
 * desktop main process in the app (which holds the key). */
import { deviceAiReadiness, deviceAiSnapshot, keyStorageLabel as deviceKeyStorageLabel } from "../../lib/localAi/config";
import type { DeviceAiKind } from "../../lib/localAi/models";

export type LocalLlmProvider = Exclude<DeviceAiKind, "none">;
export type LocalLlmConfig = {
  provider: LocalLlmProvider;
  modelId: string;
  /** Host shown in the confirmation and the processing log. */
  host: string;
  budgetTokens: number;
  concurrency: number;
};

export type IntakeLlmPrefs = { enabled: boolean; budgetTokens: number; concurrency: number };

const RUN_PREFS_KEY = "societyer:intake:run-prefs";
const LEGACY_PREFS_KEY = "societyer:intake:llm-prefs";

export const LOCAL_LLM_DEFAULTS: IntakeLlmPrefs = { enabled: false, budgetTokens: 500_000, concurrency: 2 };

function clampBudget(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(10_000, Math.min(number, 20_000_000)) : LOCAL_LLM_DEFAULTS.budgetTokens;
}

/** Per-run intake choices, remembered per browser. */
export function readLlmPrefs(): IntakeLlmPrefs {
  try {
    const raw = window.localStorage.getItem(RUN_PREFS_KEY) ?? window.localStorage.getItem(LEGACY_PREFS_KEY);
    const parsed: Record<string, unknown> = raw ? JSON.parse(raw) : {};
    const concurrency = Number(parsed.concurrency);
    return {
      enabled: parsed.enabled === true,
      budgetTokens: clampBudget(parsed.budgetTokens),
      concurrency: Number.isFinite(concurrency) ? Math.max(1, Math.min(concurrency, 8)) : LOCAL_LLM_DEFAULTS.concurrency,
    };
  } catch {
    return LOCAL_LLM_DEFAULTS;
  }
}

export function writeLlmPrefs(prefs: IntakeLlmPrefs) {
  try {
    window.localStorage.setItem(RUN_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: preferences simply are not remembered.
  }
}

export function keyStorageLabel(): string {
  return deviceKeyStorageLabel();
}

function hostOf(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** The on-device model for this intake run, or why there is none. */
export function deviceIntakeLlm(prefs: IntakeLlmPrefs): { ok: true; config: LocalLlmConfig } | { ok: false; reason: string } {
  const current = deviceAiSnapshot();
  const readiness = deviceAiReadiness(current, "intake");
  if (!readiness.ready) return { ok: false, reason: readiness.reason };
  const { config } = current;
  if (config.kind === "none") return { ok: false, reason: "On-device AI is off." };
  return {
    ok: true,
    config: {
      provider: config.kind,
      modelId: config.model,
      host: hostOf(config.baseUrl),
      budgetTokens: prefs.budgetTokens,
      concurrency: prefs.concurrency,
    },
  };
}

export function providerHost(config: Pick<LocalLlmConfig, "host">): string {
  return config.host;
}
