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
  resourcePath: string;
  logDirectory: string;
  runId: string;
  buildCommit: string | null;
  runtimeMode: string;
  documentStorageProvider: string;
  iconPaths: {
    png: string | null;
    icns: string | null;
    ico: string | null;
  };
};

export type DesktopUpdateStatus = {
  status: "disabled" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  enabled: boolean;
  channel: "stable" | "beta" | "nightly";
  currentVersion: string;
  availableVersion?: string;
  downloadedVersion?: string;
  downloadPercent?: number;
  reason?: string;
  error?: string;
  feedPath: string;
};

export type DesktopServiceId =
  | "browser-connectors"
  | "rustfs-s3"
  | "paperless-ngx"
  | "sync-helper"
  | "ai-worker";

export type DesktopServiceConfig = {
  serviceId: DesktopServiceId;
  endpoint?: string;
  enabled?: boolean;
};

export type DesktopServiceStatus = {
  id: DesktopServiceId;
  label: string;
  configured: boolean;
  ok: boolean;
  endpoint?: string;
  message?: string;
};

export type DesktopServiceProfile = {
  id: string;
  name: string;
  kind: "local-only" | "browser-imports" | "rustfs-replication" | "paperless" | "full-assisted";
  services: Record<string, { endpoint?: string; enabled?: boolean }>;
  updatedAtISO: string;
  active: boolean;
};

export type DesktopManagedServiceId =
  | "browser-connectors"
  | "paperless-ngx"
  | "rustfs"
  | "sync-helper"
  | "ai-worker";

export type DesktopManagedServiceStatus = {
  id: DesktopManagedServiceId;
  label: string;
  state:
    | "disabled"
    | "not-installed"
    | "stopped"
    | "starting"
    | "running"
    | "unhealthy"
    | "stopping"
    | "error";
  manageable: boolean;
  message?: string;
  composeFile?: string;
};

export type DesktopSecretKey =
  | "connector-token"
  | "rustfs-access-key"
  | "rustfs-secret-key"
  | "ai-api-key"
  | "sync-token";

export type DesktopSecretStatus = {
  stored: boolean;
};

export type DesktopNativeThemeState = {
  shouldUseDarkColors: boolean;
  themeSource: string;
};

export type DesktopPrintToPdfInput = {
  /** A complete, self-contained HTML document (styles inline, images as data URLs). */
  html: string;
  /** Suggested file name for the written PDF. */
  fileName: string;
};

export type DesktopPrintToPdfResult = {
  /** Absolute path of the PDF that was written. */
  path: string;
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
  readMainLog(maxBytes?: number): Promise<string>;
  logRendererEvent(input: {
    level: "info" | "warn" | "error";
    message: string;
    details?: Record<string, unknown>;
  }): Promise<void>;
  getUpdateState(): Promise<DesktopUpdateStatus>;
  checkForUpdate(): Promise<DesktopUpdateStatus>;
  downloadUpdate(): Promise<DesktopUpdateStatus>;
  installUpdate(): Promise<DesktopUpdateStatus>;
  setUpdateChannel(channel: DesktopUpdateStatus["channel"]): Promise<DesktopUpdateStatus>;
  listServiceStatuses(): Promise<DesktopServiceStatus[]>;
  checkService(serviceId: DesktopServiceId): Promise<DesktopServiceStatus>;
  getServiceConfig(serviceId: DesktopServiceId): Promise<DesktopServiceConfig>;
  saveServiceConfig(config: DesktopServiceConfig): Promise<DesktopServiceConfig>;
  listServiceProfiles(): Promise<DesktopServiceProfile[]>;
  saveServiceProfile(profile: {
    id: string;
    name: string;
    kind?: DesktopServiceProfile["kind"];
  }): Promise<DesktopServiceProfile>;
  activateServiceProfile(id: string): Promise<DesktopServiceProfile>;
  listManagedServiceStatuses(): Promise<DesktopManagedServiceStatus[]>;
  startManagedService(id: DesktopManagedServiceId): Promise<DesktopManagedServiceStatus>;
  stopManagedService(id: DesktopManagedServiceId): Promise<DesktopManagedServiceStatus>;
  openWorkspaceFolder(): Promise<void>;
  openBackupFolder(backupPath?: string): Promise<void>;
  openLogFolder(): Promise<void>;
  getSecret(key: DesktopSecretKey): Promise<string | null>;
  setSecret(key: DesktopSecretKey, value: string): Promise<DesktopSecretStatus>;
  removeSecret(key: DesktopSecretKey): Promise<DesktopSecretStatus>;
  printToPdf(input: DesktopPrintToPdfInput): Promise<DesktopPrintToPdfResult>;
  onNativeThemeChanged(listener: (state: DesktopNativeThemeState) => void): () => void;
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
