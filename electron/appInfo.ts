import { app } from "electron";
import os from "node:os";

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
};

export function getAppInfo(): DesktopAppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    userDataPath: app.getPath("userData"),
    homePath: os.homedir(),
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
