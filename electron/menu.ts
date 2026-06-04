import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

import { MENU_ACTION_CHANNEL } from "./ipcChannels.js";
import { openExternal } from "./shell.js";

export function configureApplicationMenu() {
  const appName = app.getName() || "Societyer";
  const focusedWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const openDocs = () => {
    void openExternal("https://github.com/ahzs645/societyer");
  };

  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: appName,
      submenu: [
        { role: "about" },
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
          click: () => {
            focusedWindow()?.webContents.send(MENU_ACTION_CHANNEL, "create-backup");
          },
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
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
