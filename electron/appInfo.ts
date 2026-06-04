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
    version: app.isPackaged ? app.getVersion() : "development",
    copyright: "Societyer",
  });

  if (process.platform === "win32") {
    app.setAppUserModelId("app.societyer.desktop");
  }
}
