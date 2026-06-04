import { app } from "electron";
import { getIconPaths, type DesktopIconPaths } from "./assets.js";
import type { DesktopEnvironment } from "./environment.js";

export type DesktopAppInfo = {
  name: string;
  version: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  userDataPath: string;
  homePath: string;
  resourcePath: string;
  logDirectory: string;
  runId: string;
  buildCommit: string | null;
  runtimeMode: string;
  documentStorageProvider: string;
  iconPaths: DesktopIconPaths;
};

export async function getAppInfo(environment: DesktopEnvironment): Promise<DesktopAppInfo> {
  return {
    name: environment.appName,
    version: environment.appVersion,
    isPackaged: environment.isPackaged,
    platform: environment.platform,
    arch: environment.arch,
    electronVersion: environment.electronVersion,
    chromeVersion: environment.chromeVersion,
    nodeVersion: environment.nodeVersion,
    userDataPath: environment.userDataPath,
    homePath: environment.homePath,
    resourcePath: environment.resourcesPath,
    logDirectory: environment.logDirectory,
    runId: environment.runId,
    buildCommit: environment.buildCommit,
    runtimeMode: environment.runtimeMode,
    documentStorageProvider: environment.documentStorageProvider,
    iconPaths: await getIconPaths(environment),
  };
}

export function configureAppIdentity() {
  app.setName("Societyer");
  app.setAboutPanelOptions({
    applicationName: "Societyer",
    applicationVersion: app.getVersion(),
    version: process.env.SOCIETYER_BUILD_COMMIT?.slice(0, 12) || (app.isPackaged ? app.getVersion() : "development"),
    copyright: "Societyer",
  });

  if (process.platform === "win32") {
    app.setAppUserModelId("app.societyer.desktop");
  }
}

export async function configurePlatformAppIdentity(environment: DesktopEnvironment) {
  if (process.platform !== "darwin") return;
  const iconPaths = await getIconPaths(environment);
  if (iconPaths.png && app.dock) app.dock.setIcon(iconPaths.png);
}
