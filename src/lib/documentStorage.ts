import type { DocumentStorageProvider } from "./runtimeMode";
import { getDocumentStorageProvider } from "./runtimeMode";

export type DocumentVersionRef = {
  provider: DocumentStorageProvider;
  key: string;
  fileName: string;
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
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
