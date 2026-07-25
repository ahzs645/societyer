import type { DocumentStorageProvider } from "./runtimeMode";
import { getDocumentStorageProvider } from "./runtimeMode";
import { requireDesktopBridge } from "./desktopBridge";

export type DocumentVersionRef = {
  provider: DocumentStorageProvider;
  key: string;
  fileName: string;
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
};

export type LocalWorkspaceSnapshotReadResult =
  | { status: "missing" }
  | {
      status: "available";
      serializedSnapshot: string;
      exportedAtISO: string;
      tableCount: number;
    }
  | { status: "invalid"; error: string };

export type DocumentDownloadTarget =
  | {
      kind: "url";
      provider: string;
      key: string;
      url: string | null;
      fileName?: string;
      mimeType?: string;
      fileSizeBytes?: number;
    }
  | {
      kind: "local-filesystem";
      provider: "local-filesystem";
      key: string;
      fileName?: string;
      mimeType?: string;
      fileSizeBytes?: number;
    };

export type DocumentStorageAdapter = {
  provider: DocumentStorageProvider;
  createUploadTarget(args: {
    societyId: string;
    documentId: string;
    version: number;
    fileName: string;
    mimeType?: string;
  }): Promise<DocumentVersionRef>;
  getDownloadTarget(ref: DocumentVersionRef): Promise<string>;
};

export function getConfiguredDocumentStorageProvider() {
  return getDocumentStorageProvider();
}

export function localFilesystemStorageUnavailable(): DocumentStorageAdapter {
  return {
    provider: "local-filesystem",
    async createUploadTarget() {
      throw new Error("Local filesystem document storage requires the Electron preload API.");
    },
    async getDownloadTarget() {
      throw new Error("Local filesystem document storage requires the Electron preload API.");
    },
  };
}

export function localFilesystemStorage(): DocumentStorageAdapter {
  return {
    provider: "local-filesystem",
    async createUploadTarget() {
      throw new Error("Local filesystem uploads require file bytes. Use writeLocalDocumentVersion instead.");
    },
    async getDownloadTarget(ref) {
      if (ref.provider !== "local-filesystem") {
        throw new Error(`Cannot open ${ref.provider} document through local filesystem storage.`);
      }
      return `local-file://${encodeURIComponent(ref.key)}`;
    },
  };
}

export async function writeLocalDocumentVersion(args: {
  societyId: string;
  documentId: string;
  version: number;
  file: File;
}): Promise<DocumentVersionRef> {
  const bridge = requireDesktopBridge();
  const bytes = await args.file.arrayBuffer();
  return await bridge.writeDocumentVersion({
    societyId: args.societyId,
    documentId: args.documentId,
    version: args.version,
    fileName: args.file.name,
    mimeType: args.file.type,
    bytes,
  });
}

export async function openLocalDocumentVersion(ref: DocumentVersionRef) {
  if (ref.provider !== "local-filesystem") {
    throw new Error(`Cannot open ${ref.provider} document through local filesystem storage.`);
  }
  await requireDesktopBridge().openDocumentVersion({ key: ref.key });
}

export async function persistLocalWorkspaceSnapshot(serializedSnapshot: string) {
  const bridge = requireDesktopBridge();
  const snapshotBridge = bridge as typeof bridge & {
    persistLocalWorkspaceSnapshot(value: string): Promise<{ path: string }>;
  };
  if (typeof snapshotBridge.persistLocalWorkspaceSnapshot !== "function") {
    throw new Error("Local workspace snapshot persistence requires the current Electron preload API.");
  }
  return await snapshotBridge.persistLocalWorkspaceSnapshot(serializedSnapshot);
}

export async function readLocalWorkspaceSnapshot() {
  const bridge = requireDesktopBridge();
  const snapshotBridge = bridge as typeof bridge & {
    readLocalWorkspaceSnapshot(): Promise<LocalWorkspaceSnapshotReadResult>;
  };
  if (typeof snapshotBridge.readLocalWorkspaceSnapshot !== "function") {
    throw new Error("Reading a local workspace snapshot requires the current Electron preload API.");
  }
  return await snapshotBridge.readLocalWorkspaceSnapshot();
}

export async function openDocumentDownloadTarget(target: DocumentDownloadTarget) {
  if (target.kind === "local-filesystem") {
    await requireDesktopBridge().openDocumentVersion({ key: target.key });
    return;
  }
  if (!target.url) return;
  if (target.url.startsWith("demo://")) return;
  window.open(target.url, "_blank");
}

export function isSimulatedDownloadTarget(target: DocumentDownloadTarget | null | undefined) {
  return target?.kind === "url" && Boolean(target.url?.startsWith("demo://"));
}
