/**
 * ON-DEVICE AI CONFIGURATION — this computer only.
 *
 * Which model server this device talks to for minutes drafting, the assistant
 * and AI intake in the local and desktop runtimes. It is deliberately NOT part
 * of the workspace: it is never written to `aiProviderSettings`, never synced
 * and never included in a workspace export.
 *
 * - Browser-local workspace: settings in localStorage, the optional API key in
 *   sessionStorage (cleared when the tab closes).
 * - Desktop app: settings in the desktop config file and the key in the OS
 *   keychain (Electron safeStorage). The main process reads both and makes the
 *   requests itself, so the key never reaches this renderer.
 *
 * Older builds kept intake-only preferences under `societyer:intake:llm-prefs`;
 * they are migrated once, with only the intake toggle carried over so meeting
 * data is never sent anywhere the person had not chosen.
 */
import { getDesktopBridge, type DesktopLocalAiConfig } from "../desktopBridge";
import { clampChunkChars, DEFAULT_MINUTES_CHUNK_CHARS } from "../../../shared/ai/minutesDraftChunks";
import { checkDeviceAiBaseUrl } from "../../../shared/ai/endpointPolicy";
import { isSpeechToTextKind, type SpeechToTextKind } from "../../../shared/ai/transcription";
import {
  defaultPresetForKind,
  deviceAiKeyRequired,
  effectiveBaseUrl,
  isDeviceAiKind,
  isDeviceAiPreset,
  presetInfo,
  type DeviceAiKind,
  type DeviceAiPreset,
} from "./models";

export type DeviceAiFeature = "minutes" | "assistant" | "intake";

export type DeviceAiConfig = {
  kind: DeviceAiKind;
  preset: DeviceAiPreset;
  /** Chat base URL, e.g. http://127.0.0.1:11434/v1. */
  baseUrl: string;
  model: string;
  features: Record<DeviceAiFeature, boolean>;
  /** Transcripts longer than this are drafted in parts (small context windows). */
  minutesChunkChars: number;
  /** Speech-to-text server for "Transcribe on this device" (its own address and optional key). */
  speechToText: DeviceSpeechConfig;
  /** What the on-device assistant may do with workspace records (both off by default). */
  assistantTools: DeviceAssistantToolSettings;
  updatedAtISO?: string;
};

/**
 * `lookUpRecords`: offer the read-only agent tools to the model.
 * `proposeChanges`: also offer tools that change records; each change is only
 * proposed in the chat and runs when the person approves it. Needs lookUpRecords.
 */
export type DeviceAssistantToolSettings = { lookUpRecords: boolean; proposeChanges: boolean };

export type DeviceSpeechConfig = { kind: "none" | SpeechToTextKind; baseUrl: string; model: string };

/** Which stored key: the chat model server's, or the speech-to-text server's. */
export type DeviceAiKeySlot = "chat" | "speech";

export const DEVICE_AI_CONFIG_KEY = "societyer:local-ai:config";
const LEGACY_PREFS_KEY = "societyer:intake:llm-prefs";
/** Same session slot older builds used for the intake key. */
const SESSION_KEY_SLOT = "societyer:intake:llm-key";
const SPEECH_SESSION_KEY_SLOT = "societyer:local-ai:stt-key";
const sessionSlot = (slot: DeviceAiKeySlot) => (slot === "speech" ? SPEECH_SESSION_KEY_SLOT : SESSION_KEY_SLOT);
const desktopSecret = (slot: DeviceAiKeySlot) => (slot === "speech" ? "stt-api-key" : "ai-api-key");

export const DEFAULT_DEVICE_AI_CONFIG: DeviceAiConfig = {
  kind: "none",
  preset: "ollama",
  baseUrl: presetInfo("ollama").baseUrl,
  model: "",
  features: { minutes: true, assistant: true, intake: true },
  minutesChunkChars: DEFAULT_MINUTES_CHUNK_CHARS,
  speechToText: { kind: "none", baseUrl: "", model: "" },
  assistantTools: { lookUpRecords: false, proposeChanges: false },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Sanitises anything read from storage (or sent by the desktop host). */
export function parseDeviceAiConfig(raw: unknown): DeviceAiConfig {
  const row = record(raw);
  const kind: DeviceAiKind = isDeviceAiKind(row.kind) ? row.kind : "none";
  const preset: DeviceAiPreset = isDeviceAiPreset(row.preset) ? row.preset : defaultPresetForKind(kind);
  const features = record(row.features);
  const speech = record(row.speechToText);
  const speechKind = isSpeechToTextKind(speech.kind) ? speech.kind : "none";
  const tools = record(row.assistantTools);
  const lookUpRecords = tools.lookUpRecords === true;
  return {
    kind,
    preset,
    baseUrl: effectiveBaseUrl(kind, text(row.baseUrl) || presetInfo(preset).baseUrl),
    model: text(row.model, 300),
    features: {
      minutes: features.minutes !== false,
      assistant: features.assistant !== false,
      intake: features.intake !== false,
    },
    minutesChunkChars: clampChunkChars(row.minutesChunkChars ?? DEFAULT_MINUTES_CHUNK_CHARS),
    speechToText: { kind: speechKind, baseUrl: text(speech.baseUrl).replace(/\/+$/, ""), model: text(speech.model, 300) },
    assistantTools: { lookUpRecords, proposeChanges: lookUpRecords && tools.proposeChanges === true },
    updatedAtISO: text(row.updatedAtISO, 40) || undefined,
  };
}

/** Intake-only preferences from older builds, mapped conservatively. */
export function migrateLegacyIntakePrefs(raw: unknown): DeviceAiConfig | null {
  const row = record(raw);
  if (row.enabled !== true) return null;
  const kind: DeviceAiKind = row.provider === "openrouter" ? "openrouter" : row.provider === "openai-compatible" ? "openai-compatible" : "openai";
  return parseDeviceAiConfig({
    kind,
    preset: defaultPresetForKind(kind),
    baseUrl: text(row.baseUrl),
    model: text(row.modelId, 300),
    // Only intake was opted into; meetings and the assistant stay off.
    features: { minutes: false, assistant: false, intake: true },
  });
}

function readBrowserConfig(): DeviceAiConfig {
  try {
    const stored = window.localStorage.getItem(DEVICE_AI_CONFIG_KEY);
    if (stored) return parseDeviceAiConfig(JSON.parse(stored));
    const legacy = window.localStorage.getItem(LEGACY_PREFS_KEY);
    const migrated = legacy ? migrateLegacyIntakePrefs(JSON.parse(legacy)) : null;
    if (migrated) {
      window.localStorage.setItem(DEVICE_AI_CONFIG_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // Private mode or a corrupt value: start from the defaults.
  }
  return DEFAULT_DEVICE_AI_CONFIG;
}

function toDesktop(config: DeviceAiConfig): DesktopLocalAiConfig {
  return {
    kind: config.kind,
    preset: config.preset,
    baseUrl: config.baseUrl,
    model: config.model,
    features: { ...config.features },
    minutesChunkChars: config.minutesChunkChars,
    speechToText: { ...config.speechToText },
    assistantTools: { ...config.assistantTools },
    updatedAtISO: config.updatedAtISO,
  };
}

// --- In-memory cache shared by every hook and the client --------------------

export type DeviceAiState = {
  config: DeviceAiConfig;
  keyStored: boolean;
  /** A key is stored for the speech-to-text server. */
  speechKeyStored: boolean;
  loaded: boolean;
};

let state: DeviceAiState = { config: DEFAULT_DEVICE_AI_CONFIG, keyStored: false, speechKeyStored: false, loaded: false };
let loading: Promise<DeviceAiState> | null = null;
const listeners = new Set<() => void>();

function publish(next: DeviceAiState) {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeDeviceAi(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function deviceAiSnapshot(): DeviceAiState {
  return state;
}

function browserKey(slot: DeviceAiKeySlot = "chat"): string {
  try {
    return window.sessionStorage.getItem(sessionSlot(slot)) ?? "";
  } catch {
    return "";
  }
}

/** Loads settings once (desktop: from the main process). Safe to call often. */
export function loadDeviceAi(force = false): Promise<DeviceAiState> {
  if (state.loaded && !force) return Promise.resolve(state);
  if (loading && !force) return loading;
  loading = (async () => {
    const bridge = getDesktopBridge();
    if (bridge?.getLocalAiConfig) {
      const [config, keyStored, speechKeyStored] = await Promise.all([
        bridge.getLocalAiConfig().then(parseDeviceAiConfig).catch(() => DEFAULT_DEVICE_AI_CONFIG),
        bridge.hasSecret("ai-api-key").catch(() => false),
        bridge.hasSecret("stt-api-key").catch(() => false),
      ]);
      publish({ config, keyStored, speechKeyStored, loaded: true });
    } else if (typeof window !== "undefined") {
      publish({ config: readBrowserConfig(), keyStored: Boolean(browserKey()), speechKeyStored: Boolean(browserKey("speech")), loaded: true });
    } else {
      publish({ ...state, loaded: true });
    }
    loading = null;
    return state;
  })();
  return loading;
}

export async function saveDeviceAiConfig(next: DeviceAiConfig): Promise<DeviceAiConfig> {
  const config = parseDeviceAiConfig({ ...next, updatedAtISO: new Date().toISOString() });
  const bridge = getDesktopBridge();
  if (bridge?.saveLocalAiConfig) {
    const saved = parseDeviceAiConfig(await bridge.saveLocalAiConfig(toDesktop(config)));
    // The desktop host forgets a key when its address moves to another server.
    const [keyStored, speechKeyStored] = await Promise.all([
      bridge.hasSecret("ai-api-key").catch(() => false),
      bridge.hasSecret("stt-api-key").catch(() => false),
    ]);
    publish({ config: saved, keyStored, speechKeyStored, loaded: true });
    return saved;
  }
  const previousOrigin = originOf(state.config.baseUrl);
  const previousSpeechOrigin = originOf(state.config.speechToText.baseUrl);
  try {
    window.localStorage.setItem(DEVICE_AI_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Not remembered beyond this page load.
  }
  // A key typed for one server is never sent to a different one.
  if (previousOrigin !== originOf(config.baseUrl)) clearBrowserKey("chat");
  if (previousSpeechOrigin !== originOf(config.speechToText.baseUrl)) clearBrowserKey("speech");
  publish({ config, keyStored: Boolean(browserKey()), speechKeyStored: Boolean(browserKey("speech")), loaded: true });
  return config;
}

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function clearBrowserKey(slot: DeviceAiKeySlot) {
  try {
    window.sessionStorage.removeItem(sessionSlot(slot));
  } catch {
    // Nothing stored.
  }
}

export async function storeDeviceAiKey(value: string, slot: DeviceAiKeySlot = "chat"): Promise<void> {
  const key = value.trim();
  const bridge = getDesktopBridge();
  if (bridge) {
    if (key) await bridge.setSecret(desktopSecret(slot), key);
    else await bridge.removeSecret(desktopSecret(slot));
  } else {
    try {
      if (key) window.sessionStorage.setItem(sessionSlot(slot), key);
      else window.sessionStorage.removeItem(sessionSlot(slot));
    } catch {
      // Kept nowhere: the next request goes without a key.
    }
  }
  publish(slot === "speech" ? { ...state, speechKeyStored: Boolean(key) } : { ...state, keyStored: Boolean(key) });
}

/**
 * The key for a direct browser request. The desktop app never exposes the key
 * to the renderer, so this is always empty there (the main process adds it).
 */
export function browserDeviceAiKey(slot: DeviceAiKeySlot = "chat"): string {
  return getDesktopBridge() ? "" : browserKey(slot);
}

export function keyStorageLabel(): string {
  return getDesktopBridge() ? "the operating system keychain on this computer" : "this browser tab only (cleared when the tab closes)";
}

export type DeviceAiReadiness = { ready: true } | { ready: false; reason: string };

/** Whether the saved settings are complete enough to send a request. */
export function deviceAiReadiness(current: DeviceAiState, feature?: DeviceAiFeature): DeviceAiReadiness {
  const { config, keyStored } = current;
  if (config.kind === "none") return { ready: false, reason: "On-device AI is off." };
  if (feature && !config.features[feature]) return { ready: false, reason: "On-device AI is turned off for this feature." };
  const address = checkDeviceAiBaseUrl(config.baseUrl);
  if (!address.ok) return { ready: false, reason: address.message };
  if (!config.model) return { ready: false, reason: "Choose a model in Settings." };
  if (deviceAiKeyRequired(config.kind, config.baseUrl) && !keyStored) return { ready: false, reason: "Add the API key in Settings." };
  return { ready: true };
}

/** Whether "Transcribe on this device" can send a request with the saved settings. */
export function speechToTextReadiness(current: DeviceAiState): DeviceAiReadiness {
  const speech = current.config.speechToText;
  if (speech.kind === "none") return { ready: false, reason: "On-device speech-to-text is off." };
  const address = checkDeviceAiBaseUrl(speech.baseUrl);
  if (!address.ok) return { ready: false, reason: address.message };
  if (deviceAiKeyRequired("openai-compatible", speech.baseUrl) && !current.speechKeyStored) {
    return { ready: false, reason: "Add the speech-to-text API key in Settings." };
  }
  return { ready: true };
}

/** Test seam: replace the cached state without touching storage. */
export function setDeviceAiStateForTests(next: DeviceAiState) {
  publish(next);
}
