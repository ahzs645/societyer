import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureAppIdentity } from "./appInfo.js";
import { createDesktopEnvironment } from "./environment.js";
import { registerIpc } from "./ipc.js";
import { runStartupStage } from "./lifecycle.js";
import { configureApplicationMenu } from "./menu.js";
import { ensureWorkspace } from "./workspace.js";
import { createMainWindow } from "./window.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const environment = createDesktopEnvironment(__dirname);

let mainWindow: BrowserWindow | null = null;

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
    configureAppIdentity();
    configureApplicationMenu();
    await ensureWorkspace();
    await openMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void openMainWindow();
    });
  }),
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
