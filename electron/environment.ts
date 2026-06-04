import { app } from "electron";
import os from "node:os";
import path from "node:path";

export type DesktopEnvironment = {
  dirname: string;
  isDev: boolean;
  isPackaged: boolean;
  devServerUrl?: string;
  appName: string;
  appVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  homePath: string;
  userDataPath: string;
  resourcesPath: string;
  appPath: string;
  distIndexPath: string;
  appUpdateYmlPath: string;
  runtimeMode: string;
  documentStorageProvider: string;
};

export function createDesktopEnvironment(dirname: string): DesktopEnvironment {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const isDev = Boolean(devServerUrl || process.env.SOCIETYER_ELECTRON_DEV === "1");
  return {
    dirname,
    isDev,
    isPackaged: app.isPackaged,
    devServerUrl,
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    homePath: os.homedir(),
    userDataPath: app.getPath("userData"),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    distIndexPath: path.resolve(dirname, "../../dist/index.html"),
    appUpdateYmlPath: app.isPackaged
      ? path.join(process.resourcesPath, "app-update.yml")
      : path.resolve(dirname, "../../app-update.yml"),
    runtimeMode: process.env.VITE_RUNTIME_MODE || "electron-local",
    documentStorageProvider: process.env.VITE_DOCUMENT_STORAGE_PROVIDER || "local-filesystem",
  };
}
