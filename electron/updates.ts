import electronUpdater, { type UpdateCheckResult } from "electron-updater";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { readDesktopConfig, updateDesktopConfig } from "./config.js";
import type { DesktopEnvironment } from "./environment.js";
import { pathExists } from "./assets.js";
import { makeDesktopLogger } from "./observability.js";
import {
  createDisabledUpdateState,
  createIdleUpdateState,
  updateCheckFailed,
  updateCheckStarted,
  updateCheckSucceeded,
  updateDownloadFailed,
  updateDownloadProgress,
  updateDownloadStarted,
  updateDownloadSucceeded,
} from "./updateMachine.js";

const { autoUpdater } = electronUpdater;
const logger = makeDesktopLogger("updates");
const execFileAsync = promisify(execFile);

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

function getUpdaterChannel(channel: DesktopUpdateChannel) {
  // electron-builder names stable metadata latest*.yml; beta/nightly keep their channel names.
  return channel === "stable" ? "latest" : channel;
}

function getUpdaterMetadataFilename(environment: DesktopEnvironment, channel: DesktopUpdateChannel) {
  const platformSuffix =
    environment.platform === "darwin"
      ? "-mac"
      : environment.platform === "linux"
        ? `-linux${environment.arch === "x64" ? "" : `-${environment.arch}`}`
        : "";
  return `${getUpdaterChannel(channel)}${platformSuffix}.yml`;
}

function configureAutoUpdater(channel: DesktopUpdateChannel) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.channel = getUpdaterChannel(channel);
  autoUpdater.allowPrerelease = channel !== "stable";
}

function updaterErrorMessage(
  error: unknown,
  environment: DesktopEnvironment,
  channel: DesktopUpdateChannel,
  action: "check" | "download",
) {
  const detail = error instanceof Error ? error.message : "The updater returned an unknown error.";
  if (action === "check") {
    return `Could not resolve the ${channel} update feed (${getUpdaterMetadataFilename(environment, channel)}). ${detail}`;
  }
  if (environment.platform === "darwin") {
    return `macOS could not download or verify the update. Confirm the installed app and published ZIP are signed with the same Developer ID Application identity. ${detail}`;
  }
  return `Could not download or verify the ${channel} update. ${detail}`;
}

async function getMacSigningIssue(environment: DesktopEnvironment) {
  if (environment.platform !== "darwin") return null;

  const appBundlePath = path.resolve(environment.resourcesPath, "../..");
  try {
    const { stderr } = await execFileAsync(
      "/usr/bin/codesign",
      ["--display", "--verbose=2", appBundlePath],
      { encoding: "utf8" },
    );
    if (!/^Authority=Developer ID Application:/m.test(stderr)) {
      return "Automatic updates are disabled because this macOS app is not signed with a Developer ID Application identity.";
    }
    await execFileAsync(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", appBundlePath],
      { encoding: "utf8" },
    );
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    return `Automatic updates are disabled because the macOS app signature could not be verified.${detail}`;
  }
  return null;
}

async function resolveInitialUpdateState(environment: DesktopEnvironment): Promise<DesktopUpdateState> {
  const channel = await getConfiguredChannel();
  const base = {
    channel,
    currentVersion: environment.appVersion,
    feedPath: environment.appUpdateYmlPath,
  };

  if (!environment.isPackaged) {
    return createDisabledUpdateState({
      ...base,
      reason: "Automatic updates are disabled because this is not a packaged production build.",
    });
  }

  if (!(await pathExists(environment.appUpdateYmlPath))) {
    return createDisabledUpdateState({
      ...base,
      reason: `Automatic updates are disabled because the packaged update configuration is missing at ${environment.appUpdateYmlPath}.`,
    });
  }

  let updateConfiguration: string;
  try {
    updateConfiguration = await readFile(environment.appUpdateYmlPath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    return createDisabledUpdateState({
      ...base,
      reason: `Automatic updates are disabled because ${environment.appUpdateYmlPath} could not be read.${detail}`,
    });
  }

  const provider = parseProvider(updateConfiguration);
  if (!provider) {
    return createDisabledUpdateState({
      ...base,
      reason: `Automatic updates are disabled because ${environment.appUpdateYmlPath} has no publish provider.`,
    });
  }

  const macSigningIssue = await getMacSigningIssue(environment);
  if (macSigningIssue) {
    return createDisabledUpdateState({ ...base, reason: macSigningIssue });
  }

  configureAutoUpdater(channel);
  return createIdleUpdateState({
    ...base,
    reason: `Update feed configured with ${provider}; ${channel} checks ${getUpdaterMetadataFilename(environment, channel)}.`,
  });
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
  configureAutoUpdater(channel);
  updateState = { ...(await resolveInitialUpdateState(environment)), channel };
  return updateState;
}

export async function checkForUpdate(environment: DesktopEnvironment): Promise<DesktopUpdateState> {
  const current = await getUpdateState(environment);
  if (!current.enabled) return current;

  updateState = updateCheckStarted(current);
  await logger.info("checking for updates", { channel: current.channel });
  try {
    const result: UpdateCheckResult | null = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    updateState = updateCheckSucceeded(updateState, version);
  } catch (error) {
    await logger.error("update check failed", error);
    updateState = updateCheckFailed(
      updateState,
      updaterErrorMessage(error, environment, current.channel, "check"),
    );
  }
  return updateState;
}

export async function downloadUpdate(environment: DesktopEnvironment): Promise<DesktopUpdateState> {
  const current = await getUpdateState(environment);
  if (!current.enabled || !current.availableVersion) return current;

  updateState = updateDownloadStarted(current);
  await logger.info("downloading update", { availableVersion: current.availableVersion });
  autoUpdater.once("download-progress", (progress) => {
    updateState = updateDownloadProgress(updateState ?? current, progress.percent);
  });
  try {
    await autoUpdater.downloadUpdate();
    updateState = updateDownloadSucceeded(updateState ?? current);
  } catch (error) {
    await logger.error("update download failed", error);
    updateState = updateDownloadFailed(
      updateState ?? current,
      updaterErrorMessage(error, environment, current.channel, "download"),
    );
  }
  return updateState;
}

export async function installUpdate(environment: DesktopEnvironment): Promise<DesktopUpdateState> {
  const current = await getUpdateState(environment);
  if (!current.enabled || current.status !== "downloaded") return current;
  autoUpdater.quitAndInstall(false, true);
  return current;
}
