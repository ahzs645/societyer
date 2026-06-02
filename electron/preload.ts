import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopReadDocumentVersionInput,
  DesktopWriteDocumentVersionInput,
  SocietyerDesktopBridge,
} from "../src/lib/desktopBridge";

const bridge: SocietyerDesktopBridge = {
  chooseWorkspaceDirectory: () => ipcRenderer.invoke("societyer:chooseWorkspaceDirectory"),
  getWorkspaceInfo: () => ipcRenderer.invoke("societyer:getWorkspaceInfo"),
  writeDocumentVersion: (input: DesktopWriteDocumentVersionInput) =>
    ipcRenderer.invoke("societyer:writeDocumentVersion", input),
  readDocumentVersion: (input: DesktopReadDocumentVersionInput) =>
    ipcRenderer.invoke("societyer:readDocumentVersion", input),
  openDocumentVersion: (input: DesktopReadDocumentVersionInput) =>
    ipcRenderer.invoke("societyer:openDocumentVersion", input),
  createBackup: () => ipcRenderer.invoke("societyer:createBackup"),
  checkConnector: (endpoint: string) => ipcRenderer.invoke("societyer:checkConnector", endpoint),
};

contextBridge.exposeInMainWorld("societyerDesktop", bridge);
