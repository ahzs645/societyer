import type { DocumentVersionRef } from "./documentStorage";

export type DesktopHostedConfiguration = { origin: string; authenticationOrigins: string[] };
export type DesktopModeState = {
  mode: "local" | "online";
  startupMode: "local" | "online";
  hostedApplication: DesktopHostedConfiguration | null;
  lastError?: string;
};

export type DesktopWorkspaceInfo = {
  id: string;
  name?: string;
  rootPath?: string;
  legacyDexieWorkspace?: boolean;
  schemaVersion?: number;
  createdAtISO?: string;
  updatedAtISO?: string;
};

export type DesktopWriteDocumentVersionInput = {
  societyId: string;
  documentId: string;
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
  | "stt-api-key"
  | "sync-token";

export type DesktopSecretStatus = {
  stored: boolean;
};

/**
 * On-device AI settings kept by the desktop host (never the key). The main
 * process reads these to build every model request itself.
 */
export type DesktopLocalAiConfig = {
  kind: "ollama" | "lmstudio" | "openai-compatible" | "openai" | "openrouter" | "none";
  preset: "ollama" | "lmstudio" | "llamacpp" | "openai-compatible" | "openai" | "openrouter";
  baseUrl: string;
  model: string;
  features: { minutes: boolean; assistant: boolean; intake: boolean };
  minutesChunkChars: number;
  speechToText: { kind: "none" | "openai-compatible" | "whisper-cpp" | "whisperx"; baseUrl: string; model: string };
  /** The on-device assistant's record tools (read by the renderer only). */
  assistantTools: { lookUpRecords: boolean; proposeChanges: boolean };
  updatedAtISO?: string;
};

/** Paths the desktop AI proxy forwards; the main process enforces this list. */
export type DesktopLocalAiPath = "/models" | "/chat/completions" | "/api/tags";

export type DesktopLocalAiRequest = {
  /** Chosen by the renderer so a request can be aborted. */
  requestId: string;
  path: DesktopLocalAiPath;
  method: "GET" | "POST";
  /** JSON request body. */
  body?: string;
  timeoutMs?: number;
};

export type DesktopLocalAiResponse = {
  status: number;
  ok: boolean;
  body: string;
  contentType?: string;
};

export type DesktopLocalAiStreamEvent =
  | { type: "head"; status: number; ok: boolean; contentType?: string }
  | { type: "chunk"; text: string }
  | { type: "end" }
  | { type: "error"; code: "network" | "timeout" | "aborted" | "refused"; message: string };

/**
 * On-device transcription. The renderer copies the recording it already holds
 * to the main process in ordered pieces (no single huge IPC message); the main
 * process keeps it in a private temporary file, optionally prepares it with
 * ffmpeg, sends it to the configured speech-to-text server and deletes it.
 */
export type DesktopTranscriptionUpload = {
  requestId: string;
  fileName: string;
  totalBytes: number;
  /** Byte offset of this piece; 0 starts a new upload. */
  offset: number;
  bytes: ArrayBuffer;
};

export type DesktopTranscriptionRequest = { requestId: string; language?: string };

export type DesktopTranscriptionEvent =
  | { type: "converting" }
  | { type: "part"; index: number; total: number };

export type DesktopTranscriptionResult =
  | {
      ok: true;
      /** One server reply per part, in recording order; `offsetSec` is where the part starts. */
      parts: Array<{ offsetSec: number; body: string }>;
      overlapSec: number;
      /** ffmpeg prepared the audio (16 kHz mono WAV, in parts for long recordings). */
      converted: boolean;
    }
  | { ok: false; code: "status" | "refused" | "network" | "timeout" | "aborted"; status?: number; message: string };

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
  getDesktopMode(): Promise<DesktopModeState>;
  openHostedMode(configuration?: DesktopHostedConfiguration): Promise<DesktopModeState>;
  returnToLocalMode(): Promise<DesktopModeState>;
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
  /** Refuses "ai-api-key" and "stt-api-key": those keys are only read by the main-process AI proxy. */
  getSecret(key: DesktopSecretKey): Promise<string | null>;
  hasSecret(key: DesktopSecretKey): Promise<boolean>;
  getLocalAiConfig(): Promise<DesktopLocalAiConfig>;
  saveLocalAiConfig(config: DesktopLocalAiConfig): Promise<DesktopLocalAiConfig>;
  /** One request to the configured on-device AI server, made by the main process. */
  localAiRequest(input: DesktopLocalAiRequest): Promise<DesktopLocalAiResponse>;
  /** A streamed request; events arrive in order and the promise settles after "end" or "error". */
  localAiStream(input: DesktopLocalAiRequest, onEvent: (event: DesktopLocalAiStreamEvent) => void): Promise<void>;
  /** Also stops a transcription and deletes its temporary file. */
  localAiAbort(requestId: string): Promise<void>;
  localAiTranscriptionUpload(input: DesktopTranscriptionUpload): Promise<{ received: number }>;
  /** Progress events arrive while it runs; settles with the server's replies or a failure. */
  localAiTranscribe(input: DesktopTranscriptionRequest, onEvent: (event: DesktopTranscriptionEvent) => void): Promise<DesktopTranscriptionResult>;
  setSecret(key: DesktopSecretKey, value: string): Promise<DesktopSecretStatus>;
  removeSecret(key: DesktopSecretKey): Promise<DesktopSecretStatus>;
  printToPdf(input: DesktopPrintToPdfInput): Promise<DesktopPrintToPdfResult>;
  /** AI intake: a native folder pick; files are then read on demand by relative path inside it. */
  pickIntakeFolder(): Promise<{ token: string; root: string; files: Array<{ relativePath: string; size: number; modifiedTime?: string }> } | null>;
  readIntakeFile(input: { token: string; relativePath: string }): Promise<ArrayBuffer>;
  /** Legacy .doc/.xls → DOCX/XLSX through LibreOffice when it is installed (null otherwise). */
  convertLegacyDocument(input: { fileName: string; bytes: ArrayBuffer; target: "docx" | "xlsx" }): Promise<ArrayBuffer | null>;
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
