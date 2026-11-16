/**
 * On-device AI: provider kinds, the Settings presets, and model-list parsing.
 * Pure data, safe to import from tests and workers.
 */
import { isLoopbackUrl } from "../../../shared/ai/endpointPolicy";
import { isInternalHostname, isPrivateOrReservedAddress } from "../../../shared/outboundUrlPolicy";

/**
 * `claude-cli` / `codex-cli`: the Claude Code or Codex CLI already signed in on
 * this computer, run by the desktop app's main process with the CLI's own
 * tools turned off. Desktop app only; the conversation goes to Anthropic or
 * OpenAI under the person's own sign-in. To this renderer they look like an
 * OpenAI-compatible server reached through the desktop transport.
 */
export type DeviceAiCliKind = "claude-cli" | "codex-cli";

export type DeviceAiKind = "ollama" | "lmstudio" | "openai-compatible" | "openai" | "openrouter" | DeviceAiCliKind | "none";

/** What the Settings picker shows; llama.cpp is an OpenAI-compatible server. */
export type DeviceAiPreset = "ollama" | "lmstudio" | "llamacpp" | "openai-compatible" | "openai" | "openrouter" | DeviceAiCliKind;

export const DEVICE_AI_CLI_KINDS: readonly DeviceAiCliKind[] = ["claude-cli", "codex-cli"];

export const DEVICE_AI_KINDS: readonly DeviceAiKind[] = ["ollama", "lmstudio", "openai-compatible", "openai", "openrouter", ...DEVICE_AI_CLI_KINDS, "none"];

export type DeviceAiPresetInfo = {
  preset: DeviceAiPreset;
  kind: Exclude<DeviceAiKind, "none">;
  label: string;
  /** Prefilled base URL; empty when the person must type one. */
  baseUrl: string;
  /** Hosted services always need a key; local servers usually do not. */
  keyRequired: boolean;
  /** The address is fixed (hosted services), or there is none (the CLIs). */
  fixedBaseUrl: boolean;
  /** Only the desktop app can run it (the CLIs). */
  desktopOnly: boolean;
};

export const DEVICE_AI_PRESETS: readonly DeviceAiPresetInfo[] = [
  { preset: "ollama", kind: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", keyRequired: false, fixedBaseUrl: false, desktopOnly: false },
  { preset: "lmstudio", kind: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", keyRequired: false, fixedBaseUrl: false, desktopOnly: false },
  { preset: "llamacpp", kind: "openai-compatible", label: "llama.cpp server", baseUrl: "http://127.0.0.1:8080/v1", keyRequired: false, fixedBaseUrl: false, desktopOnly: false },
  { preset: "openai-compatible", kind: "openai-compatible", label: "Other OpenAI-compatible", baseUrl: "", keyRequired: false, fixedBaseUrl: false, desktopOnly: false },
  { preset: "openai", kind: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", keyRequired: true, fixedBaseUrl: true, desktopOnly: false },
  { preset: "openrouter", kind: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyRequired: true, fixedBaseUrl: true, desktopOnly: false },
  { preset: "claude-cli", kind: "claude-cli", label: "Claude Code (your Claude sign-in)", baseUrl: "", keyRequired: false, fixedBaseUrl: true, desktopOnly: true },
  { preset: "codex-cli", kind: "codex-cli", label: "Codex (your ChatGPT sign-in)", baseUrl: "", keyRequired: false, fixedBaseUrl: true, desktopOnly: true },
];

/** The presets this runtime can use: the CLIs only in the desktop app. */
export function devicePresetsFor(desktop: boolean): DeviceAiPresetInfo[] {
  return DEVICE_AI_PRESETS.filter((entry) => desktop || !entry.desktopOnly);
}

export function isCliKind(kind: unknown): kind is DeviceAiCliKind {
  return typeof kind === "string" && (DEVICE_AI_CLI_KINDS as readonly string[]).includes(kind);
}

/** What each CLI is called, whose service it reaches, and which sign-in it uses. */
export const CLI_KIND_INFO: Record<DeviceAiCliKind, { name: string; vendor: string; signIn: string; pathLabel: string }> = {
  "claude-cli": { name: "Claude Code", vendor: "Anthropic", signIn: "Claude", pathLabel: "Claude Code location" },
  "codex-cli": { name: "Codex", vendor: "OpenAI", signIn: "ChatGPT", pathLabel: "Codex location" },
};

/**
 * Whether what this provider is sent leaves the computer: hosted services and
 * the CLIs (which send it to Anthropic or OpenAI). A server address on this
 * computer or the local network keeps it here.
 */
export function deviceAiLeavesComputer(kind: DeviceAiKind, baseUrl: string): boolean {
  if (kind === "none") return false;
  if (isCliKind(kind)) return true;
  return deviceAiKeyRequired(kind, baseUrl);
}

/** The model as people see it: a CLI with no model chosen uses its own default. */
export function deviceAiModelLabel(kind: DeviceAiKind, model: string): string {
  if (!isCliKind(kind)) return model;
  const { name } = CLI_KIND_INFO[kind];
  return model ? `${model} (${name})` : `${name}'s default model`;
}

/** Where requests go, for notices: the server's host, or the CLI's service. */
export function deviceAiDestinationLabel(kind: DeviceAiKind, baseUrl: string): string {
  if (isCliKind(kind)) {
    const info = CLI_KIND_INFO[kind];
    return `${info.vendor} through ${info.name} (your ${info.signIn} sign-in)`;
  }
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

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
  // The CLIs have no address: the desktop app runs them.
  if (isCliKind(kind)) return "";
  if (kind === "openai") return "https://api.openai.com/v1";
  if (kind === "openrouter") return "https://openrouter.ai/api/v1";
  return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * Whether this endpoint needs an API key. Hosted services do; a server on this
 * computer or the local network usually does not (a key is still sent if set).
 */
export function deviceAiKeyRequired(kind: DeviceAiKind, baseUrl: string): boolean {
  if (kind === "none" || isCliKind(kind)) return false;
  if (kind === "openai" || kind === "openrouter") return true;
  if (isLoopbackUrl(baseUrl)) return false;
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
    return !(isPrivateOrReservedAddress(host) || isInternalHostname(host));
  } catch {
    return true;
  }
}

/** Ollama answers model lists at the server root, not under /v1. The CLIs list theirs at /models. */
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
