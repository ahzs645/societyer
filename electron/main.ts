import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureAppIdentity, configurePlatformAppIdentity } from "./appInfo.js";
import { createDesktopEnvironment } from "./environment.js";
import { registerIpc } from "./ipc.js";
import { runStartupStage } from "./lifecycle.js";
import { configureApplicationMenu } from "./menu.js";
import { makeDesktopLogger } from "./observability.js";
import { registerDesktopAppProtocol, registerDesktopProtocolPrivileges } from "./protocol.js";
import { registerNativeThemeSync } from "./theme.js";
import { configureUserDataPath } from "./userData.js";
import { ensureWorkspace } from "./workspace.js";
import { createMainWindow } from "./window.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL || process.env.SOCIETYER_ELECTRON_DEV === "1");
const userDataMigration = configureUserDataPath(isDev);
const environment = createDesktopEnvironment(__dirname);
const logger = makeDesktopLogger("main");

let mainWindow: BrowserWindow | null = null;

registerDesktopProtocolPrivileges();

async function openMainWindow() {
  mainWindow = await createMainWindow({
    environment,
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

registerIpc(environment);

app.whenReady().then(() =>
  runStartupStage("bootstrap", async () => {
    await logger.info("bootstrap start", { isDev: environment.isDev, isPackaged: environment.isPackaged });
    if (userDataMigration.migratedFrom) {
      await logger.info("migrated legacy userData", userDataMigration);
    }
    configureAppIdentity();
    await configurePlatformAppIdentity(environment);
    registerDesktopAppProtocol(environment);
    configureApplicationMenu(environment);
    registerNativeThemeSync();
    await ensureWorkspace();
    await openMainWindow();
    await logger.info("main window opened");

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void openMainWindow();
    });
  }),
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
