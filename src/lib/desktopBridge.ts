import type { DocumentVersionRef } from "./documentStorage";

export type DesktopWorkspaceInfo = {
  id: string;
  name?: string;
  rootPath?: string;
  schemaVersion?: number;
  createdAtISO?: string;
  updatedAtISO?: string;
};

export type DesktopWriteDocumentVersionInput = {
  societyId: string;
  documentId: string;
  version: number;
  fileName: string;
  mimeType?: string;
  bytes: ArrayBuffer;
};

export type DesktopReadDocumentVersionInput = {
  key: string;
};

export type DesktopBackupResult = {
  path: string;
  bytes?: number;
};

export type DesktopConnectorHealth = {
  ok: boolean;
  provider?: string;
  message?: string;
};

export type DesktopSetupState = {
  complete: boolean;
};

export type DesktopAppInfo = {
  name: string;
  version: string;
  isPackaged: boolean;
  platform: string;
  arch: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  userDataPath: string;
  homePath: string;
};

export type SocietyerDesktopBridge = {
  chooseWorkspaceDirectory(): Promise<string | null>;
  getWorkspaceInfo(): Promise<DesktopWorkspaceInfo | null>;
  getSetupState(): Promise<DesktopSetupState>;
  setSetupComplete(complete: boolean): Promise<DesktopSetupState>;
  writeDocumentVersion(input: DesktopWriteDocumentVersionInput): Promise<DocumentVersionRef>;
  readDocumentVersion(input: DesktopReadDocumentVersionInput): Promise<ArrayBuffer>;
  openDocumentVersion(input: DesktopReadDocumentVersionInput): Promise<void>;
  createBackup(): Promise<DesktopBackupResult>;
  checkConnector(endpoint: string): Promise<DesktopConnectorHealth>;
  openExternal(url: string): Promise<boolean>;
  getAppInfo(): Promise<DesktopAppInfo>;
  onMenuAction(listener: (action: string) => void): () => void;
};

declare global {
  interface Window {
    societyerDesktop?: SocietyerDesktopBridge;
  }
}

export function getDesktopBridge(): SocietyerDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.societyerDesktop ?? null;
}

export function requireDesktopBridge(): SocietyerDesktopBridge {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error("Electron desktop bridge is not available.");
  }
  return bridge;
}

export function isDesktopBridgeAvailable() {
  return Boolean(getDesktopBridge());
}
