/**
 * On-device AI: provider kinds, the Settings presets, and model-list parsing.
 * Pure data, safe to import from tests and workers.
 */
import { isLoopbackUrl } from "../../../shared/ai/endpointPolicy";
import { isInternalHostname, isPrivateOrReservedAddress } from "../../../shared/outboundUrlPolicy";

export type DeviceAiKind = "ollama" | "lmstudio" | "openai-compatible" | "openai" | "openrouter" | "none";

/** What the Settings picker shows; llama.cpp is an OpenAI-compatible server. */
export type DeviceAiPreset = "ollama" | "lmstudio" | "llamacpp" | "openai-compatible" | "openai" | "openrouter";

export const DEVICE_AI_KINDS: readonly DeviceAiKind[] = ["ollama", "lmstudio", "openai-compatible", "openai", "openrouter", "none"];

export type DeviceAiPresetInfo = {
  preset: DeviceAiPreset;
  kind: Exclude<DeviceAiKind, "none">;
  label: string;
  /** Prefilled base URL; empty when the person must type one. */
  baseUrl: string;
  /** Hosted services always need a key; local servers usually do not. */
  keyRequired: boolean;
  /** The address is fixed (hosted services). */
  fixedBaseUrl: boolean;
};

export const DEVICE_AI_PRESETS: readonly DeviceAiPresetInfo[] = [
  { preset: "ollama", kind: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", keyRequired: false, fixedBaseUrl: false },
  { preset: "lmstudio", kind: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", keyRequired: false, fixedBaseUrl: false },
  { preset: "llamacpp", kind: "openai-compatible", label: "llama.cpp server", baseUrl: "http://127.0.0.1:8080/v1", keyRequired: false, fixedBaseUrl: false },
  { preset: "openai-compatible", kind: "openai-compatible", label: "Other OpenAI-compatible", baseUrl: "", keyRequired: false, fixedBaseUrl: false },
  { preset: "openai", kind: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", keyRequired: true, fixedBaseUrl: true },
  { preset: "openrouter", kind: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyRequired: true, fixedBaseUrl: true },
];

export function presetInfo(preset: DeviceAiPreset): DeviceAiPresetInfo {
  return DEVICE_AI_PRESETS.find((entry) => entry.preset === preset) ?? DEVICE_AI_PRESETS[0];
}

export function defaultPresetForKind(kind: DeviceAiKind): DeviceAiPreset {
  if (kind === "none" || kind === "ollama") return "ollama";
  return kind;
}

export function isDeviceAiKind(value: unknown): value is DeviceAiKind {
  return typeof value === "string" && (DEVICE_AI_KINDS as readonly string[]).includes(value);
}

export function isDeviceAiPreset(value: unknown): value is DeviceAiPreset {
  return typeof value === "string" && DEVICE_AI_PRESETS.some((entry) => entry.preset === value);
}

/** The base URL actually used: hosted services ignore what was typed. */
export function effectiveBaseUrl(kind: DeviceAiKind, baseUrl: string): string {
  if (kind === "openai") return "https://api.openai.com/v1";
  if (kind === "openrouter") return "https://openrouter.ai/api/v1";
  return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * Whether this endpoint needs an API key. Hosted services do; a server on this
 * computer or the local network usually does not (a key is still sent if set).
 */
export function deviceAiKeyRequired(kind: DeviceAiKind, baseUrl: string): boolean {
  if (kind === "none") return false;
  if (kind === "openai" || kind === "openrouter") return true;
  if (isLoopbackUrl(baseUrl)) return false;
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
    return !(isPrivateOrReservedAddress(host) || isInternalHostname(host));
  } catch {
    return true;
  }
}

/** Ollama answers model lists at the server root, not under /v1. */
export function modelListPaths(kind: DeviceAiKind): DeviceAiPath[] {
  return kind === "ollama" ? ["/models", "/api/tags"] : ["/models"];
}

/**
 * Request paths the chat client may use. The desktop proxy enforces the same
 * allow-list in the main process. Speech-to-text (`/audio/transcriptions`,
 * `/inference`) goes to its own server through `./transcription.ts`.
 */
export type DeviceAiPath = "/models" | "/chat/completions" | "/api/tags";
export const DEVICE_AI_PATHS: readonly DeviceAiPath[] = ["/models", "/chat/completions", "/api/tags"];

/** `/api/tags` lives at the server origin; everything else under the base URL. */
export function deviceAiUrl(baseUrl: string, path: DeviceAiPath): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (path === "/api/tags") return `${new URL(base).origin}/api/tags`;
  return `${base}${path}`;
}
