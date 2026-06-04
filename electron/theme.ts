import { BrowserWindow, nativeTheme } from "electron";
import { THEME_CHANGED_CHANNEL } from "./ipcChannels.js";

export function getNativeThemeState() {
  return {
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource,
  };
}

export function registerNativeThemeSync() {
  nativeTheme.on("updated", broadcastNativeTheme);
}

export function broadcastNativeTheme() {
  const state = getNativeThemeState();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(THEME_CHANGED_CHANNEL, state);
  }
}
