import electronUpdater, { type UpdateCheckResult } from "electron-updater";
import { readFile } from "node:fs/promises";

import { readDesktopConfig, updateDesktopConfig } from "./config.js";
import type { DesktopEnvironment } from "./environment.js";
import { pathExists } from "./assets.js";

const { autoUpdater } = electronUpdater;

export type DesktopUpdateChannel = "stable" | "beta" | "nightly";
export type DesktopUpdateStateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopUpdateState = {
  status: DesktopUpdateStateStatus;
  enabled: boolean;
  channel: DesktopUpdateChannel;
  currentVersion: string;
  availableVersion?: string;
  downloadedVersion?: string;
  downloadPercent?: number;
  reason?: string;
  error?: string;
  feedPath: string;
};

let updateState: DesktopUpdateState | null = null;

function parseProvider(raw: string) {
  for (const line of raw.split("\n")) {
    const match = line.match(/^provider:\s*(.+)$/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

async function getConfiguredChannel(): Promise<DesktopUpdateChannel> {
  return (await readDesktopConfig()).updateChannel ?? "stable";
}

async function resolveInitialUpdateState(environment: DesktopEnvironment): Promise<DesktopUpdateState> {
  const channel = await getConfiguredChannel();
  const base = {
    channel,
    currentVersion: environment.appVersion,
    feedPath: environment.appUpdateYmlPath,
  };

  if (!(await pathExists(environment.appUpdateYmlPath))) {
    return {
      ...base,
      status: "disabled",
      enabled: false,
      reason: "Automatic updates are not configured because app-update.yml is missing.",
    };
  }

  const provider = parseProvider(await readFile(environment.appUpdateYmlPath, "utf8"));
  if (!provider) {
    return {
      ...base,
      status: "disabled",
      enabled: false,
      reason: "Automatic updates are not configured because app-update.yml has no provider.",
    };
  }

  if (!environment.isPackaged) {
    return {
      ...base,
      status: "disabled",
      enabled: false,
      reason: "Automatic updates are only enabled for packaged production builds.",
    };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.channel = channel;
  return {
    ...base,
    status: "idle",
    enabled: true,
    reason: `Update feed configured with ${provider}.`,
  };
}

export async function getUpdateState(environment: DesktopEnvironment): Promise<DesktopUpdateState> {
  updateState ??= await resolveInitialUpdateState(environment);
  return updateState;
}

export async function setUpdateChannel(
  environment: DesktopEnvironment,
  channel: DesktopUpdateChannel,
): Promise<DesktopUpdateState> {
  await updateDesktopConfig({ updateChannel: channel });
  if (autoUpdater) autoUpdater.channel = channel;
  updateState = { ...(await resolveInitialUpdateState(environment)), channel };
  return updateState;
}

export async function checkForUpdate(environment: DesktopEnvironment): Promise<DesktopUpdateState> {
  const current = await getUpdateState(environment);
  if (!current.enabled) return current;

  updateState = { ...current, status: "checking", error: undefined };
  try {
    const result: UpdateCheckResult | null = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    updateState = version
      ? { ...updateState, status: "available", availableVersion: version }
      : { ...updateState, status: "idle", reason: "No update is available." };
  } catch (error) {
    updateState = {
      ...updateState,
      status: "error",
      error: error instanceof Error ? error.message : "Update check failed.",
    };
  }
  return updateState;
}

export async function downloadUpdate(environment: DesktopEnvironment): Promise<DesktopUpdateState> {
  const current = await getUpdateState(environment);
  if (!current.enabled || !current.availableVersion) return current;

  updateState = { ...current, status: "downloading", downloadPercent: 0, error: undefined };
  autoUpdater.once("download-progress", (progress) => {
    updateState = {
      ...(updateState ?? current),
      status: "downloading",
      downloadPercent: Math.round(progress.percent),
    };
  });
  try {
    await autoUpdater.downloadUpdate();
    updateState = {
      ...(updateState ?? current),
      status: "downloaded",
      downloadedVersion: current.availableVersion,
      downloadPercent: 100,
    };
  } catch (error) {
    updateState = {
      ...(updateState ?? current),
      status: "error",
      error: error instanceof Error ? error.message : "Update download failed.",
    };
  }
  return updateState;
}

export async function installUpdate(environment: DesktopEnvironment): Promise<DesktopUpdateState> {
  const current = await getUpdateState(environment);
  if (!current.enabled || current.status !== "downloaded") return current;
  autoUpdater.quitAndInstall(false, true);
  return current;
}
