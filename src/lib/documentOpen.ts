import { getRestoredFile } from "./workspaceArchiveFiles";
import { openDocumentDownloadTarget, type DocumentDownloadTarget } from "./documentStorage";
import { triggerBlobDownload } from "./zip";

/**
 * Opening a document's file, in order of trust (finding D-02):
 *   1. a saved original restored from a backup (by version, document or SHA), or an AI
 *      intake source file still cached on this device (by SHA),
 *   2. the latest uploaded version,
 *   3. a legacy Convex storage file,
 *   4. the external link (Drive, Paperless, …) as a last resort.
 * Lookups happen on demand, never per rendered row (finding D-21).
 */
export type OpenableDocument = {
  _id: string;
  title?: string;
  fileName?: string;
  mimeType?: string;
  url?: string;
  storageId?: string;
  sha256?: string;
  latestVersionId?: string;
};

export async function restoredDocumentFile(doc: Pick<OpenableDocument, "_id" | "latestVersionId" | "sha256">): Promise<Blob | undefined> {
  try {
    if (doc.latestVersionId) {
      const byVersion = await getRestoredFile({ versionId: doc.latestVersionId });
      if (byVersion) return byVersion;
    }
    const byDocument = await getRestoredFile({ documentId: doc._id });
    if (byDocument) return byDocument;
    if (doc.sha256) {
      const bySha = await getRestoredFile({ sha256: doc.sha256 });
      if (bySha) return bySha;
    }
  } catch {
    // No local workspace (hosted runtime): fall through to remote targets.
  }
  // A source file of an AI intake run, still in this device's intake cache (the browser-only
  // runtime has no file store; promotion links the document to the file by SHA-256).
  if (doc.sha256) {
    try {
      const { getCachedOriginal } = await import("../features/intake/originalsCache");
      const cached = await getCachedOriginal(doc.sha256);
      if (cached) return cached.blob;
    } catch {
      // No IndexedDB (private mode): nothing cached.
    }
  }
  return undefined;
}

export type OpenDocumentResult = "restored" | "version" | "legacy" | "external" | "simulated" | "none";

export async function openDocumentFile(
  doc: OpenableDocument,
  deps: {
    getDownloadTarget: (args: { versionId: string }) => Promise<DocumentDownloadTarget | null>;
    getLegacyUrl?: (storageId: string) => Promise<string | null | undefined>;
  },
): Promise<OpenDocumentResult> {
  const restored = await restoredDocumentFile(doc);
  if (restored) {
    triggerBlobDownload(restored, doc.fileName ?? doc.title ?? "document");
    return "restored";
  }
  if (doc.latestVersionId) {
    const target = await deps.getDownloadTarget({ versionId: doc.latestVersionId });
    if (target?.kind === "url" && target.url?.startsWith("demo://")) return "simulated";
    if (target && (await openDocumentDownloadTarget(target))) return "version";
  }
  if (doc.storageId && deps.getLegacyUrl) {
    const url = await deps.getLegacyUrl(doc.storageId);
    if (url) {
      await openDocumentDownloadTarget({ kind: "url", provider: "convex", key: doc.storageId, url, fileName: doc.fileName });
      return "legacy";
    }
  }
  if (doc.url && /^https?:\/\//i.test(doc.url)) {
    window.open(doc.url, "_blank", "noopener,noreferrer");
    return "external";
  }
  return "none";
}

export function documentHasFile(doc: OpenableDocument) {
  return Boolean(doc.latestVersionId || doc.storageId || doc.url || doc.sha256 || doc.fileName);
}

export function formatBytes(bytes: number | undefined) {
  if (!bytes || !Number.isFinite(bytes)) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
