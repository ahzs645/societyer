import { restoredDocumentFile, type OpenableDocument } from "./documentOpen";
import type { DocumentDownloadTarget } from "./documentStorage";
import { requireDesktopBridge } from "./desktopBridge";
import { getRestoredFile } from "./workspaceArchiveFiles";
import { fetchDocumentDownload } from "./documentDownload";
import { assertPreviewSize, readPreviewResponse, verifyPreviewBytes } from "./filePreviewBytes";

export type PreviewDocument = OpenableDocument & { fileSizeBytes?: number };
export type DocumentPreviewAccess = {
  getDownloadTarget: (args: { versionId: string }) => Promise<DocumentDownloadTarget | null>;
  getLegacyUrl: (storageId: string) => Promise<string | null | undefined>;
};

/** Resolve on demand through the same access-checked adapters as downloads. */
export async function readDocumentPreview(doc: PreviewDocument, access: DocumentPreviewAccess, signal: AbortSignal) {
  signal.throwIfAborted();
  if (doc.fileSizeBytes !== undefined) assertPreviewSize(doc.fileSizeBytes);
  const restored = doc.versionOnly ? await getRestoredFile({ versionId: doc.latestVersionId }).catch(() => undefined) : await restoredDocumentFile(doc);
  signal.throwIfAborted();
  if (restored) {
    assertPreviewSize(restored.size);
    return verifyPreviewBytes(await restored.arrayBuffer(), doc.sha256, doc.fileSizeBytes);
  }
  if (doc.latestVersionId) {
    const target = await access.getDownloadTarget({ versionId: doc.latestVersionId });
    signal.throwIfAborted();
    if (target) {
      if (target.fileSizeBytes !== undefined) assertPreviewSize(target.fileSizeBytes);
      const saved = await getRestoredFile({ provider: target.provider, storageKey: target.key }).catch(() => undefined);
      signal.throwIfAborted();
      if (saved) {
        assertPreviewSize(saved.size);
        return verifyPreviewBytes(await saved.arrayBuffer(), doc.sha256, target.fileSizeBytes);
      }
      if (target.kind === "local-filesystem") {
        const bytes = await requireDesktopBridge().readDocumentVersion({ key: target.key });
        signal.throwIfAborted();
        return verifyPreviewBytes(bytes, doc.sha256, target.fileSizeBytes);
      }
      // A version is authoritative: do not silently substitute an external link.
      if (!target.url || target.url.startsWith("demo://")) throw new Error("No stored original is available for this version.");
      return verifyPreviewBytes(await readPreviewResponse(await fetchDocumentDownload(target.url, { signal }), signal), doc.sha256, target.fileSizeBytes);
    }
    throw new Error("This document version is no longer available.");
  }
  const url = doc.storageId ? await access.getLegacyUrl(doc.storageId) : doc.url;
  signal.throwIfAborted();
  if (!url || !/^https?:\/\//i.test(url)) throw new Error("No previewable original is attached to this document.");
  return verifyPreviewBytes(await readPreviewResponse(await fetchDocumentDownload(url, { signal }), signal), doc.sha256, doc.fileSizeBytes);
}
