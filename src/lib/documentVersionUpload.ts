import { validateUploadMetadata } from "../../shared/storage/uploadVerification";
import { isDemoMode } from "./demoMode";
import { writeLocalDocumentVersion } from "./documentStorage";
import { getDocumentStorageProvider, getRuntimeMode, isNativeFileStorageEnabled } from "./runtimeMode";
import { isLocalDataRuntime } from "./staticRuntime";
import { hashBytes } from "./workspaceArchive";

export const NATIVE_FILE_STORAGE_DISABLED_MESSAGE =
  "Native file storage is disabled on this deployment. Use a document connector (e.g. Paperless) as the source instead of uploading.";

/** The browser local workspace (local-indexeddb runtime or a browser workspace chosen at
 * first run) keeps uploaded bytes in its own IndexedDB file store. Demo and desktop
 * runtimes keep their own storage. */
export function usesBrowserWorkspaceFileStore(): boolean {
  if (!isLocalDataRuntime() || isDemoMode()) return false;
  if (getRuntimeMode() === "electron-local" || getDocumentStorageProvider() === "local-filesystem") return false;
  return isNativeFileStorageEnabled();
}

export async function uploadDocumentVersion({
  societyId,
  documentId,
  file,
  changeNote,
  createDemoVersion,
  beginUpload,
  recordUploadedVersion,
  completeUpload,
}: {
  societyId: any;
  documentId: any;
  file: File;
  changeNote?: string;
  createDemoVersion: (args: any) => Promise<any>;
  beginUpload: (args: any) => Promise<any>;
  recordUploadedVersion: (args: any) => Promise<any>;
  completeUpload?: (args: any) => Promise<any>;
}) {
  if (!isNativeFileStorageEnabled()) {
    throw new Error(NATIVE_FILE_STORAGE_DISABLED_MESSAGE);
  }
  const storageProvider = getDocumentStorageProvider();
  if (storageProvider === "local-filesystem") {
    const ref = await writeLocalDocumentVersion({
      societyId,
      documentId,
      file,
    });
    const recorded = await recordUploadedVersion({
      societyId,
      documentId,
      storageProvider: ref.provider,
      storageKey: ref.key,
      fileName: ref.fileName,
      mimeType: ref.mimeType,
      fileSizeBytes: ref.byteLength ?? file.size,
      sha256: ref.sha256,
      changeNote: changeNote || undefined,
    });
    return { versionId: recorded.versionId, version: recorded.version, provider: ref.provider };
  }

  // Browser local workspace: keep the bytes on this device (IndexedDB) so the
  // file opens offline and travels in ZIP backups.
  if (usesBrowserWorkspaceFileStore()) {
    const { localDataClient } = await import("./localDataClient");
    const save = (localDataClient as { saveLocalWorkspaceFile?: (blob: Blob, sha256: string, references?: string[]) => Promise<void> }).saveLocalWorkspaceFile;
    if (save) {
      const sha256 = await hashBytes(new Uint8Array(await file.arrayBuffer()));
      await save.call(localDataClient, file, sha256);
      const recorded = await recordUploadedVersion({
        societyId,
        documentId,
        storageProvider: "local-indexeddb",
        storageKey: `local-indexeddb:${sha256}:${documentId}`,
        fileName: file.name,
        mimeType: file.type || undefined,
        fileSizeBytes: file.size,
        sha256,
        changeNote: changeNote || undefined,
      });
      await save.call(localDataClient, file, sha256, [`version:${recorded.versionId}`, `document:${documentId}`]);
      return { versionId: recorded.versionId, version: recorded.version, provider: "local-indexeddb" };
    }
  }

  if (isDemoMode()) {
    const recorded = await createDemoVersion({
      societyId,
      documentId,
      fileName: file.name,
      mimeType: file.type,
      fileSizeBytes: file.size,
      changeNote: changeNote || undefined,
    });
    return { versionId: recorded.versionId, version: recorded.version, provider: "demo" };
  }

  validateUploadMetadata({ fileName: file.name, fileSizeBytes: file.size, mimeType: file.type });
  if (!completeUpload) throw new Error("This deployment requires the verified upload flow.");
  const { presigned, uploadHandleId } = await beginUpload({
    societyId,
    documentId,
    fileName: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
  });
  if (presigned.provider === "rustfs" || presigned.provider === "r2") {
    const res = await fetch(presigned.url, {
      method: "PUT",
      headers: presigned.headers ?? (file.type ? { "Content-Type": file.type } : {}),
      body: file,
    });
    if (!res.ok) throw new Error(`${presigned.provider === "r2" ? "R2" : "RustFS"} upload failed (${res.status})`);
  }

  if (!uploadHandleId || !completeUpload) throw new Error("This deployment requires the verified upload flow.");
  await completeUpload({ uploadHandleId });
  const recorded = await recordUploadedVersion({
    uploadHandleId,
    societyId,
    documentId,
    storageProvider: presigned.provider,
    storageKey: presigned.key,
    fileName: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
    changeNote: changeNote || undefined,
  });
  return { versionId: recorded.versionId, version: recorded.version, provider: presigned.provider };
}
