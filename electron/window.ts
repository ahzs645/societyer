import { BrowserWindow, dialog, nativeTheme, systemPreferences } from "electron";
import path from "node:path";

import { showDefaultContextMenu } from "./contextMenu.js";
import { resolveResourcePath } from "./assets.js";
import type { DesktopEnvironment } from "./environment.js";
import { makeDesktopLogger } from "./observability.js";
import { SOCIETYER_APP_PROTOCOL } from "./protocol.js";
import { hardenWindowNavigation } from "./shell.js";
import { registerLocalRendererAuthority } from "./ipcAuthority.js";
import { installCameraPermissions } from "./mediaPermissions.js";

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
    minWidth: 360,
    minHeight: 480,
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
  registerLocalRendererAuthority(mainWindow.webContents, environment.isDev
    ? new URL(environment.devServerUrl || "http://127.0.0.1:5173").origin
    : undefined);
  const revokeCameraConsent = installCameraPermissions(mainWindow.webContents.session, mainWindow.webContents,
    { kind: "local", ...(environment.isDev ? { devOrigin: new URL(environment.devServerUrl || "http://127.0.0.1:5173").origin } : {}) },
    async () => {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "question", title: "Camera access", message: "Allow your local Societyer workspace to use the camera?",
        detail: "The camera scans asset tags. Microphone and screen capture stay blocked. Closing this local window ends camera access.",
        buttons: ["Keep camera blocked", "Allow camera"], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (result.response !== 1 || mainWindow.isDestroyed()) return false;
      return process.platform !== "darwin" || await systemPreferences.askForMediaAccess("camera");
    }, () => mainWindow.isVisible());
  // An inactive local renderer must not retain a camera stream while online mode is visible.
  mainWindow.on("hide", () => {
    revokeCameraConsent.reset();
    // The trusted bundled scanner attaches its stream to a video element. Stop
    // those tracks without discarding unsaved local form state when changing mode.
    if (!mainWindow.isDestroyed()) void mainWindow.webContents.executeJavaScript(`
      for (const video of document.querySelectorAll("video")) {
        const stream = video.srcObject;
        if (stream && typeof stream.getTracks === "function") for (const track of stream.getTracks()) track.stop();
      }
    `).catch(() => { /* Closing the renderer already ends its streams. */ });
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
