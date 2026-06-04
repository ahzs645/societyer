import { app } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { pathExists } from "./assets.js";

export type DesktopUpdateStatus = {
  enabled: boolean;
  available: boolean;
  currentVersion: string;
  reason: string;
  feedPath: string;
};

function parseProvider(raw: string) {
  for (const line of raw.split("\n")) {
    const match = line.match(/^provider:\s*(.+)$/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export async function getUpdateStatus(dirname: string): Promise<DesktopUpdateStatus> {
  const feedPath = path.resolve(dirname, "../../app-update.yml");
  const feedExists = await pathExists(feedPath);
  if (!feedExists) {
    return {
      enabled: false,
      available: false,
      currentVersion: app.getVersion(),
      feedPath,
      reason: "Automatic updates are not configured because app-update.yml is missing.",
    };
  }

  const provider = parseProvider(await readFile(feedPath, "utf8"));
  if (!provider) {
    return {
      enabled: false,
      available: false,
      currentVersion: app.getVersion(),
      feedPath,
      reason: "Automatic updates are not configured because app-update.yml has no provider.",
    };
  }

  if (!app.isPackaged) {
    return {
      enabled: false,
      available: true,
      currentVersion: app.getVersion(),
      feedPath,
      reason: "Automatic updates are only enabled for packaged production builds.",
    };
  }

  return {
    enabled: true,
    available: true,
    currentVersion: app.getVersion(),
    feedPath,
    reason: `Update feed configured with ${provider}.`,
  };
}
