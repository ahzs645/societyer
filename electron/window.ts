import type * as Electron from "electron";
import { BrowserWindow, Menu, nativeTheme } from "electron";
import path from "node:path";

import { resolveResourcePath } from "./assets.js";
import type { DesktopEnvironment } from "./environment.js";
import { hardenWindowNavigation } from "./shell.js";

export type CreateMainWindowOptions = {
  environment: DesktopEnvironment;
};

export async function createMainWindow(options: CreateMainWindowOptions) {
  const appTitle = "Societyer";
  const { environment } = options;
  const iconPath = await resolveResourcePath(environment, "icon.png");
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f172a" : "#ffffff",
    title: appTitle,
    ...(process.platform === "darwin" || !iconPath ? {} : { icon: iconPath }),
    webPreferences: {
      preload: path.join(environment.dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.webContents.on("context-menu", (event, params) => {
    event.preventDefault();
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion),
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        template.push({ label: "No suggestions", enabled: false });
      }
      template.push({ type: "separator" });
    }

    if (params.mediaType === "image") {
      template.push({
        label: "Copy Image",
        click: () => mainWindow.webContents.copyImageAt(params.x, params.y),
      });
      template.push({ type: "separator" });
    }

    template.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow.setTitle(appTitle);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.setTitle(appTitle);
    if (process.env.SOCIETYER_DESKTOP_SMOKE_PROBE === "1") {
      void mainWindow.webContents
        .executeJavaScript(
          `(async () => Boolean(window.societyerDesktop && window.societyerDesktop.getAppInfo && await window.societyerDesktop.getAppInfo()))()`,
        )
        .then((ok) => {
          console.log(ok ? "SOCIETYER_DESKTOP_SMOKE_PROBE_OK" : "SOCIETYER_DESKTOP_SMOKE_PROBE_FAILED");
        })
        .catch((error) => {
          console.error("SOCIETYER_DESKTOP_SMOKE_PROBE_FAILED", error);
        });
    }
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      console.warn("Societyer Electron main window failed to load", {
        errorCode,
        errorDescription,
        validatedURL,
      });
    },
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.warn("Societyer Electron render process gone", details);
  });

  const allowedOrigins: string[] = [];
  if (environment.isDev) {
    const devUrl = environment.devServerUrl || "http://127.0.0.1:5173";
    allowedOrigins.push(new URL(devUrl).origin);
    hardenWindowNavigation(mainWindow, allowedOrigins);
    await mainWindow.loadURL(devUrl);
  } else {
    hardenWindowNavigation(mainWindow, allowedOrigins);
    await mainWindow.loadFile(environment.distIndexPath);
  }

  return mainWindow;
}
