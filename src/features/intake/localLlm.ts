/** Device-local AI provider settings for intake extraction in the local and
 * desktop runtimes. The provider, model and base URL default from the
 * workspace AI settings (aiSettings:getEffective); the API key never leaves
 * this device: Electron keeps it in the OS keychain (safeStorage via the
 * desktop bridge), a browser keeps it only for this tab (sessionStorage).
 * Text is PII-redacted (same-length masks) before every call and restricted
 * files are never sent (shared/intake/llm.ts). */
import { getDesktopBridge } from "../../lib/desktopBridge";

export type LocalLlmProvider = "openai" | "openrouter" | "openai-compatible";
export type LocalLlmConfig = {
  provider: LocalLlmProvider;
  modelId: string;
  baseUrl?: string;
  apiKey: string;
  budgetTokens: number;
  concurrency: number;
};

const PREFS_KEY = "societyer:intake:llm-prefs";
const SESSION_KEY = "societyer:intake:llm-key";

export const LOCAL_LLM_DEFAULTS: Omit<LocalLlmConfig, "apiKey"> = { provider: "openai", modelId: "gpt-4.1-mini", budgetTokens: 500_000, concurrency: 2 };

export function defaultModelFor(provider: LocalLlmProvider): string {
  return provider === "openrouter" ? "openai/gpt-4.1-mini" : "gpt-4.1-mini";
}

export function readLlmPrefs(): Omit<LocalLlmConfig, "apiKey"> & { enabled: boolean } {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const provider: LocalLlmProvider = ["openai", "openrouter", "openai-compatible"].includes(parsed.provider) ? parsed.provider : LOCAL_LLM_DEFAULTS.provider;
    return {
      enabled: parsed.enabled === true,
      provider,
      modelId: typeof parsed.modelId === "string" && parsed.modelId.trim() ? parsed.modelId : defaultModelFor(provider),
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
      budgetTokens: Number.isFinite(parsed.budgetTokens) ? Math.max(10_000, Math.min(parsed.budgetTokens, 20_000_000)) : LOCAL_LLM_DEFAULTS.budgetTokens,
      concurrency: Number.isFinite(parsed.concurrency) ? Math.max(1, Math.min(parsed.concurrency, 8)) : LOCAL_LLM_DEFAULTS.concurrency,
    };
  } catch {
    return { enabled: false, ...LOCAL_LLM_DEFAULTS };
  }
}

/** Preferences (never the key) are remembered per browser. */
export function writeLlmPrefs(prefs: Omit<LocalLlmConfig, "apiKey"> & { enabled: boolean }) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: preferences simply are not remembered.
  }
}

export function keyStorageLabel(): string {
  return getDesktopBridge() ? "the operating system keychain on this computer" : "this browser tab only (cleared when the tab closes)";
}

export async function readLocalApiKey(): Promise<string> {
  const bridge = getDesktopBridge();
  if (bridge) return (await bridge.getSecret("ai-api-key").catch(() => null)) ?? "";
  try {
    return window.sessionStorage.getItem(SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

export async function storeLocalApiKey(value: string) {
  const bridge = getDesktopBridge();
  const key = value.trim();
  if (bridge) {
    if (key) await bridge.setSecret("ai-api-key", key);
    else await bridge.removeSecret("ai-api-key");
    return;
  }
  try {
    if (key) window.sessionStorage.setItem(SESSION_KEY, key);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // The key stays in memory for this run only.
  }
}

export function providerBaseUrl(config: Pick<LocalLlmConfig, "provider" | "baseUrl">): string | undefined {
  if (config.provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (config.provider === "openai-compatible") return config.baseUrl?.trim() || undefined;
  return undefined;
}

export function providerHost(config: Pick<LocalLlmConfig, "provider" | "baseUrl">): string {
  const url = providerBaseUrl(config) ?? "https://api.openai.com/v1";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
