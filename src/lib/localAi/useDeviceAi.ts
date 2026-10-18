/**
 * React access to the on-device AI settings, plus where they apply.
 *
 * On-device AI is offered in the browser-local workspace and the desktop app.
 * The public demo never contacts a network service, and a server workspace
 * uses the workspace AI provider instead.
 */
import { useEffect, useSyncExternalStore } from "react";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../staticRuntime";
import {
  deviceAiReadiness,
  deviceAiSnapshot,
  loadDeviceAi,
  speechToTextReadiness,
  subscribeDeviceAi,
  type DeviceAiConfig,
  type DeviceAiFeature,
  type DeviceAiState,
} from "./config";
import { deviceToolSupport, subscribeDeviceToolSupport, type DeviceToolSupport } from "./toolSupport";

/** Where the On-device AI card lives (Settings scrolls to it). */
export const DEVICE_AI_SETTINGS_HREF = "/app/settings?section=on-device-ai";

/** True in the browser-local workspace and the desktop app (not the demo, not a server). */
export function deviceAiSupportedHere(): boolean {
  return isLocalDataRuntime() && !isStaticDemoRuntime();
}

export type DeviceAiStatus = DeviceAiState & {
  supported: boolean;
  ready: boolean;
  /** Why it is not ready, when it is not. */
  reason?: string;
};

export function useDeviceAi(feature?: DeviceAiFeature): DeviceAiStatus {
  const supported = deviceAiSupportedHere();
  const snapshot = useSyncExternalStore(subscribeDeviceAi, deviceAiSnapshot, deviceAiSnapshot);
  useEffect(() => {
    if (supported) void loadDeviceAi();
  }, [supported]);
  if (!supported) return { ...snapshot, supported, ready: false, reason: "On-device AI is not available here." };
  const readiness = deviceAiReadiness(snapshot, feature);
  return readiness.ready
    ? { ...snapshot, supported, ready: true }
    : { ...snapshot, supported, ready: false, reason: readiness.reason };
}

/**
 * Where an AI minutes draft can run on this page: the connected server, the
 * on-device model, or nowhere (local workspace without on-device AI, or demo).
 */
export function useAiDraftAvailability() {
  const device = useDeviceAi("minutes");
  const server = !isLocalDataRuntime();
  return {
    server,
    device: device.ready,
    available: server || device.ready,
    deviceModel: device.ready ? device.config.model : undefined,
    /** Offer the Settings link: on-device AI could be set up here. */
    canSetUpDevice: device.supported && !device.ready,
  };
}

/**
 * Whether the on-device assistant can call workspace tools: "Let the
 * assistant look up workspace records" is on, and this model isn't known to
 * refuse tools (an untested model is tried; a refusal is remembered and the
 * assistant falls back to working from pasted text). The assistant's
 * suggestions, placeholder and notices follow (src/features/ai/assistantSuggestions.ts).
 */
export function deviceAssistantToolsAvailable(config: DeviceAiConfig, support: DeviceToolSupport = deviceToolSupport(config)): boolean {
  return config.kind !== "none" && config.features.assistant && config.assistantTools.lookUpRecords && support !== "unsupported";
}

/** What this device's model is known to do with tools, kept current. */
export function useDeviceToolSupport(config: DeviceAiConfig): DeviceToolSupport {
  return useSyncExternalStore(subscribeDeviceToolSupport, () => deviceToolSupport(config), () => deviceToolSupport(config));
}

/** "Transcribe on this device": supported here, and the speech-to-text server is set up. */
export function useDeviceSpeechToText() {
  const supported = deviceAiSupportedHere();
  const snapshot = useSyncExternalStore(subscribeDeviceAi, deviceAiSnapshot, deviceAiSnapshot);
  useEffect(() => {
    if (supported) void loadDeviceAi();
  }, [supported]);
  const readiness = supported ? speechToTextReadiness(snapshot) : { ready: false as const, reason: "On-device speech-to-text is not available here." };
  return {
    supported,
    ready: readiness.ready,
    reason: readiness.ready ? undefined : readiness.reason,
    speech: snapshot.config.speechToText,
  };
}
