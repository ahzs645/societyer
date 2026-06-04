import type { DesktopUpdateChannel, DesktopUpdateState } from "./updates.js";

export function createDisabledUpdateState(input: {
  channel: DesktopUpdateChannel;
  currentVersion: string;
  feedPath: string;
  reason: string;
}): DesktopUpdateState {
  return {
    status: "disabled",
    enabled: false,
    channel: input.channel,
    currentVersion: input.currentVersion,
    feedPath: input.feedPath,
    reason: input.reason,
  };
}

export function createIdleUpdateState(input: {
  channel: DesktopUpdateChannel;
  currentVersion: string;
  feedPath: string;
  reason: string;
}): DesktopUpdateState {
  return {
    status: "idle",
    enabled: true,
    channel: input.channel,
    currentVersion: input.currentVersion,
    feedPath: input.feedPath,
    reason: input.reason,
  };
}

export function updateCheckStarted(state: DesktopUpdateState): DesktopUpdateState {
  if (!state.enabled) return state;
  return { ...state, status: "checking", error: undefined };
}

export function updateCheckSucceeded(
  state: DesktopUpdateState,
  availableVersion: string | undefined,
): DesktopUpdateState {
  if (!state.enabled) return state;
  return availableVersion
    ? { ...state, status: "available", availableVersion, error: undefined }
    : {
        ...state,
        status: "idle",
        availableVersion: undefined,
        downloadedVersion: undefined,
        downloadPercent: undefined,
        error: undefined,
        reason: "No update is available.",
      };
}

export function updateCheckFailed(state: DesktopUpdateState, error: string): DesktopUpdateState {
  if (!state.enabled) return state;
  return { ...state, status: "error", error };
}

export function updateDownloadStarted(state: DesktopUpdateState): DesktopUpdateState {
  if (!state.enabled || !state.availableVersion) return state;
  return { ...state, status: "downloading", downloadPercent: 0, error: undefined };
}

export function updateDownloadProgress(state: DesktopUpdateState, percent: number): DesktopUpdateState {
  if (!state.enabled || state.status !== "downloading") return state;
  return { ...state, downloadPercent: Math.max(0, Math.min(100, Math.round(percent))) };
}

export function updateDownloadSucceeded(state: DesktopUpdateState): DesktopUpdateState {
  if (!state.enabled || !state.availableVersion) return state;
  return {
    ...state,
    status: "downloaded",
    downloadedVersion: state.availableVersion,
    downloadPercent: 100,
    error: undefined,
  };
}

export function updateDownloadFailed(state: DesktopUpdateState, error: string): DesktopUpdateState {
  if (!state.enabled) return state;
  return {
    ...state,
    status: state.availableVersion ? "available" : "error",
    downloadPercent: undefined,
    error,
  };
}
