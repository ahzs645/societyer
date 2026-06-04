import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from "electron";

import type { DesktopEnvironment } from "./environment.js";
import { MENU_ACTION_CHANNEL } from "./ipcChannels.js";
import { makeDesktopLogger } from "./observability.js";
import { openExternal } from "./shell.js";
import { checkForUpdate } from "./updates.js";

const logger = makeDesktopLogger("menu");

export function configureApplicationMenu(environment: DesktopEnvironment) {
  const appName = app.getName() || "Societyer";
  const focusedWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const dispatch = (action: string) => {
    focusedWindow()?.webContents.send(MENU_ACTION_CHANNEL, action);
  };
  const openDocs = () => {
    void openExternal("https://github.com/ahzs645/societyer");
  };
  const checkUpdates = () => {
    void checkForUpdate(environment)
      .then((state) => {
        if (state.status === "available") {
          return dialog.showMessageBox({
            type: "info",
            title: "Update available",
            message: `Societyer ${state.availableVersion ?? "update"} is available.`,
            detail: "Open Desktop diagnostics to download or install updates.",
          });
        }
        if (state.status === "error") {
          return dialog.showMessageBox({
            type: "warning",
            title: "Update check failed",
            message: "Could not check for updates.",
            detail: state.error ?? "An unknown update error occurred.",
          });
        }
        return dialog.showMessageBox({
          type: state.enabled ? "info" : "none",
          title: state.enabled ? "You're up to date" : "Updates unavailable",
          message: state.enabled ? "Societyer is currently up to date." : "Automatic updates are not available right now.",
          detail: state.reason,
        });
      })
      .catch((error) => {
        void logger.error("menu update check failed", error);
      });
  };

  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: appName,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: checkUpdates,
        },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => dispatch("open-settings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        {
          label: "Create Backup",
          accelerator: "CmdOrCtrl+Shift+B",
          click: () => dispatch("create-backup"),
        },
        {
          label: "Export Workspace",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => dispatch("export-workspace"),
        },
        {
          label: "Open Workspace Folder",
          click: () => dispatch("open-workspace"),
        },
        {
          label: "Open Logs Folder",
          click: () => dispatch("open-logs"),
        },
        {
          label: "Check Optional Services",
          click: () => dispatch("check-services"),
        },
        {
          label: "Check for Updates...",
          click: checkUpdates,
        },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Societyer Project",
          click: openDocs,
        },
        {
          label: "Check for Updates...",
          click: checkUpdates,
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
