import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureAppIdentity } from "./appInfo.js";
import { registerIpc } from "./ipc.js";
import { configureApplicationMenu } from "./menu.js";
import { ensureWorkspace } from "./workspace.js";
import { createMainWindow } from "./window.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL || process.env.SOCIETYER_ELECTRON_DEV === "1");

let mainWindow: BrowserWindow | null = null;

async function openMainWindow() {
  mainWindow = await createMainWindow({
    dirname: __dirname,
    isDev,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

registerIpc(__dirname);

app.whenReady().then(async () => {
  configureAppIdentity();
  configureApplicationMenu();
  await ensureWorkspace();
  await openMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void openMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
