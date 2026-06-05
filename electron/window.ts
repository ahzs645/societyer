import { BrowserWindow, nativeTheme } from "electron";
import path from "node:path";

import { showDefaultContextMenu } from "./contextMenu.js";
import { resolveResourcePath } from "./assets.js";
import type { DesktopEnvironment } from "./environment.js";
import { makeDesktopLogger } from "./observability.js";
import { SOCIETYER_APP_PROTOCOL } from "./protocol.js";
import { hardenWindowNavigation } from "./shell.js";

export type CreateMainWindowOptions = {
  environment: DesktopEnvironment;
};

export async function createMainWindow(options: CreateMainWindowOptions) {
  const appTitle = "Societyer";
  const { environment } = options;
  const logger = makeDesktopLogger("window");
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
    showDefaultContextMenu({ window: mainWindow, webContents: mainWindow.webContents, params });
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
      void logger.warn("main frame failed to load", { errorCode, errorDescription, validatedURL });
    },
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.warn("Societyer Electron render process gone", details);
    void logger.warn("render process gone", details);
  });

  const allowedOrigins: string[] = [];
  if (environment.isDev) {
    const devUrl = environment.devServerUrl || "http://127.0.0.1:5173";
    allowedOrigins.push(new URL(devUrl).origin);
    hardenWindowNavigation(mainWindow, allowedOrigins);
    await mainWindow.loadURL(devUrl);
  } else {
    const appUrl = `${SOCIETYER_APP_PROTOCOL}://index.html`;
    allowedOrigins.push(new URL(appUrl).origin);
    hardenWindowNavigation(mainWindow, allowedOrigins);
    await mainWindow.loadURL(appUrl);
  }

  return mainWindow;
}
