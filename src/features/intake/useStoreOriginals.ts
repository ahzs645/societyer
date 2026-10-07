/** After promotion, save the original source files as versions of the source
 * documents the import created, where this runtime stores files: the desktop
 * workspace folder (Electron), the hosted storage provider, or the demo
 * (metadata-only) store. The browser local runtime saves them in the
 * workspace's IndexedDB file store, so they open offline and travel in ZIP backups. */
import { useAction } from "convex/react";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { api } from "@/lib/convexApi";
import { uploadDocumentVersion, usesBrowserWorkspaceFileStore } from "../../lib/documentVersionUpload";
import { getDocumentStorageProvider, isNativeFileStorageEnabled } from "../../lib/runtimeMode";
import { isLocalDataRuntime } from "../../lib/staticRuntime";
import { isDemoMode } from "../../lib/demoMode";
import { getOriginal } from "./originalsCache";

export type SourceDocumentRef = { fileKey: string; documentId: string; name: string; sha256?: string; mimeType?: string };

export function canStoreOriginals(): boolean {
  if (!isNativeFileStorageEnabled()) return false;
  if (isDemoMode()) return true;
  if (getDocumentStorageProvider() === "local-filesystem") return true;
  // The browser local workspace keeps originals in IndexedDB (exported in ZIP backups).
  if (usesBrowserWorkspaceFileStore()) return true;
  return !isLocalDataRuntime();
}

export function useStoreOriginals(allowed: boolean) {
  const createDemoVersion = usePermissionedMutation(api.documentVersions.createDemoVersion, allowed);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordUploadedVersion = usePermissionedMutation(api.documentVersions.recordUploadedVersion, allowed);
  return async (societyId: string, documents: SourceDocumentRef[]): Promise<{ stored: number; missing: number; skipped: boolean; errors: string[] }> => {
    if (!allowed || !canStoreOriginals()) return { stored: 0, missing: 0, skipped: true, errors: [] };
    let stored = 0;
    let missing = 0;
    const errors: string[] = [];
    for (const document of documents) {
      const original = await getOriginal(document.sha256);
      if (!original) {
        missing++;
        continue;
      }
      try {
        const file = new File([original.blob], document.name, { type: document.mimeType ?? original.mimeType ?? original.blob.type ?? "application/octet-stream" });
        await uploadDocumentVersion({ societyId, documentId: document.documentId, file, changeNote: "Original source file from AI intake", createDemoVersion, beginUpload, recordUploadedVersion, completeUpload });
        stored++;
      } catch (error) {
        errors.push(`${document.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { stored, missing, skipped: false, errors };
  };
}
