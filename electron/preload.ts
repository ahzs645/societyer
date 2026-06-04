import { contextBridge, ipcRenderer } from "electron";
import type * as Electron from "electron";
import type {
  DesktopReadDocumentVersionInput,
  DesktopWriteDocumentVersionInput,
  SocietyerDesktopBridge,
} from "../src/lib/desktopBridge";
import * as IpcChannels from "./ipcChannels.js";

const bridge: SocietyerDesktopBridge = {
  chooseWorkspaceDirectory: () => ipcRenderer.invoke(IpcChannels.CHOOSE_WORKSPACE_DIRECTORY_CHANNEL),
  getWorkspaceInfo: () => ipcRenderer.invoke(IpcChannels.GET_WORKSPACE_INFO_CHANNEL),
  getSetupState: () => ipcRenderer.invoke(IpcChannels.GET_SETUP_STATE_CHANNEL),
  setSetupComplete: (complete: boolean) =>
    ipcRenderer.invoke(IpcChannels.SET_SETUP_COMPLETE_CHANNEL, complete),
  writeDocumentVersion: (input: DesktopWriteDocumentVersionInput) =>
    ipcRenderer.invoke(IpcChannels.WRITE_DOCUMENT_VERSION_CHANNEL, input),
  readDocumentVersion: (input: DesktopReadDocumentVersionInput) =>
    ipcRenderer.invoke(IpcChannels.READ_DOCUMENT_VERSION_CHANNEL, input),
  openDocumentVersion: (input: DesktopReadDocumentVersionInput) =>
    ipcRenderer.invoke(IpcChannels.OPEN_DOCUMENT_VERSION_CHANNEL, input),
  createBackup: () => ipcRenderer.invoke(IpcChannels.CREATE_BACKUP_CHANNEL),
  checkConnector: (endpoint: string) => ipcRenderer.invoke(IpcChannels.CHECK_CONNECTOR_CHANNEL, endpoint),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL_CHANNEL, url),
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.GET_APP_INFO_CHANNEL),
  openWorkspaceFolder: () => ipcRenderer.invoke(IpcChannels.OPEN_WORKSPACE_FOLDER_CHANNEL),
  openBackupFolder: (backupPath?: string) =>
    ipcRenderer.invoke(IpcChannels.OPEN_BACKUP_FOLDER_CHANNEL, backupPath),
  getSecret: (key) => ipcRenderer.invoke(IpcChannels.GET_SECRET_CHANNEL, key),
  setSecret: (key, value) => ipcRenderer.invoke(IpcChannels.SET_SECRET_CHANNEL, { key, value }),
  removeSecret: (key) => ipcRenderer.invoke(IpcChannels.REMOVE_SECRET_CHANNEL, key),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };
    ipcRenderer.on(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
};

contextBridge.exposeInMainWorld("societyerDesktop", bridge);
