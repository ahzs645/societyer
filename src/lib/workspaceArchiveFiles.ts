import { getDesktopBridge } from "./desktopBridge";
import { fetchDocumentDownload, isAuthenticatedDocumentUrl } from "./documentDownload";
import { hashBytes, type ArchiveFile, type ArchiveManifest } from "./workspaceArchive";

export async function getRestoredFile(args: { sha256?: string; provider?: string; storageKey?: string; documentId?: string; versionId?: string }): Promise<Blob | undefined> {
  const { localDataClient } = await import("./localDataClient");
  return localDataClient.readRestoredWorkspaceFile?.(args);
}
export function archiveFileRows(manifest: ArchiveManifest | undefined, files: Map<string, Blob>) {
  const rows = [...files].map(([sha256, blob]) => ({ key: `sha256:${sha256}`, sha256, blob }));
  const references = new Map<string, { key: string; sha256: string }>();
  for (const file of manifest?.files ?? []) if (file.status === "included") {
    const keys = [file.provider && file.storageKey ? JSON.stringify([file.provider, file.storageKey]) : undefined, file.documentId ? `document:${file.documentId}` : undefined, file.versionId ? `version:${file.versionId}` : undefined];
    for (const key of keys) if (key) references.set(key, { key, sha256: file.sha256! });
  }
  return [...rows, ...references.values()];
}
export type OriginalSource = { fileName: string; mimeType: string; sha256: string; parts: Array<{ url: string; bytes: number; sha256: string }> };
export async function loadSourceOriginal(original: OriginalSource) {
  const cached = await getRestoredFile({ sha256: original.sha256 });
  if (cached) return cached;
  const parts: ArrayBuffer[] = [];
  for (const part of original.parts) {
    if (!part.url.startsWith("/test-data/source-record-v3/originals/") || part.url.includes("..")) throw new Error("The source download reference is invalid.");
    const response = await fetch(part.url, { credentials: "same-origin", redirect: "error" });
    if (!response.ok) throw new Error("The original source could not be downloaded.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== part.bytes || await hashBytes(bytes) !== part.sha256) throw new Error("The source download was incomplete. Please try again.");
    parts.push(bytes);
  }
  const blob = new Blob(parts, { type: original.mimeType });
  if (await hashBytes(await blob.arrayBuffer()) !== original.sha256) throw new Error("The source download was incomplete. Please try again.");
  return blob;
}
export type AttachmentDownload = { id?: string; documentId?: string; storageProvider?: string; storageKey?: string; storageId?: string; downloadUrl?: string | null; downloadError?: string; externalUrl?: string; fileName?: string; title?: string; mimeType?: string; fileSizeBytes?: number; sha256?: string };
export async function collectWorkspaceFiles(tables: Record<string, any[]>, attachments: AttachmentDownload[], add: (file: ArchiveFile, blob?: Blob) => Promise<void>, progress?: (done: number, total: number, fileName: string) => void) {
  const { localDataClient } = await import("./localDataClient");
  await localDataClient.whenLocalWorkspaceReady?.();
  const visibleDocuments = new Set((tables.documents ?? []).map(row => row._id));
  const visibleVersions = new Set((tables.documentVersions ?? []).map(row => row._id));
  const listed = new Set(attachments.map(file => JSON.stringify([file.storageProvider, file.storageKey ?? file.storageId])));
  for (const ref of localDataClient.getLocalWorkspaceAttachmentReferences?.() ?? []) {
    if (!(ref.versionId ? visibleVersions.has(ref.versionId) || (ref.versionId === ref.documentId && visibleDocuments.has(ref.documentId)) : visibleDocuments.has(ref.documentId))) continue;
    const key = JSON.stringify([ref.provider, ref.storageKey]);
    if (listed.has(key)) continue;
    listed.add(key);
    attachments.push({ ...ref, id: ref.versionId, storageProvider: ref.provider });
  }
  const originals = new Map<string, { original: OriginalSource; documentId?: string }>();
  const sourceIds = new Set<string>();
  for (const minutes of tables.minutes ?? []) for (const source of minutes.sourceMeetingRecord?.documents ?? []) {
    if (source.originalDownload?.sha256) { originals.set(source.originalDownload.sha256, { original: source.originalDownload, documentId: source.documentId }); if (source.documentId) sourceIds.add(source.documentId); }
  }
  const candidates = [...originals.values()];
  // AI intake source files (browser-only runtime: kept in this device's intake cache, not a file store).
  // Each goes into the backup once, linked to the source document promotion created for it.
  const intakeFiles = new Map<string, { fileName: string; mimeType?: string; documentId?: string; sha256: string; bytes?: number }>();
  for (const row of tables.intakeFiles ?? []) {
    if (!row?.sha256 || originals.has(row.sha256) || row.disposition === "junk" || row.disposition === "excluded") continue;
    const current = intakeFiles.get(row.sha256);
    if (!current || (!current.documentId && row.documentId)) intakeFiles.set(row.sha256, { fileName: row.name, mimeType: row.mimeType, documentId: row.documentId ? String(row.documentId) : undefined, sha256: row.sha256, bytes: row.sizeBytes });
  }
  let done = 0; const total = candidates.length + attachments.length + intakeFiles.size;
  if (intakeFiles.size) {
    const { getCachedOriginal } = await import("../features/intake/originalsCache");
    for (const entry of intakeFiles.values()) {
      progress?.(done++, total, entry.fileName);
      const file: ArchiveFile = { fileName: entry.fileName, mimeType: entry.mimeType, documentId: entry.documentId, sha256: entry.sha256, bytes: entry.bytes, status: "included" };
      const cached = await getCachedOriginal(entry.sha256).catch(() => undefined);
      if (cached) await add(file, cached.blob);
      else await add({ ...file, status: "unavailable", reason: "The intake source file is not cached on this device (the browser cleared it, or the run was made on another device)." });
    }
  }
  for (const { original, documentId } of candidates) {
    progress?.(done, total, original.fileName);
    const file: ArchiveFile = { fileName: original.fileName, mimeType: original.mimeType, documentId, sha256: original.sha256, bytes: original.parts.reduce((sum, p) => sum + p.bytes, 0), status: "included" };
    try { await add(file, await loadSourceOriginal(original)); }
    catch (error) { await add({ ...file, status: "unavailable", reason: error instanceof Error ? error.message : "File could not be read." }); }
    done++;
  }
  for (const attachment of attachments) {
    progress?.(done++, total, attachment.fileName ?? attachment.title ?? "Document");
    const file: ArchiveFile = { fileName: attachment.fileName ?? attachment.title ?? attachment.id ?? "document", mimeType: attachment.mimeType, provider: attachment.storageProvider, storageKey: attachment.storageKey ?? attachment.storageId ?? attachment.downloadUrl ?? undefined, documentId: attachment.documentId, versionId: attachment.id, sha256: attachment.sha256, bytes: attachment.fileSizeBytes, status: "included" };
    // Saved originals cover these external Drive links already.
    if (attachment.storageProvider === "externalUrl" && attachment.documentId && sourceIds.has(attachment.documentId)) continue;
    try {
      let blob = await getRestoredFile({ sha256: file.sha256, provider: file.provider, storageKey: file.storageKey });
      if (!blob && attachment.storageProvider === "externalUrl" && !isAuthenticatedDocumentUrl(attachment.downloadUrl ?? "")) { await add({ ...file, status: "external", externalUrl: attachment.externalUrl ?? attachment.downloadUrl ?? undefined, reason: "File is kept on an external service; its link is retained in the records." }); continue; }
      if (!blob && attachment.storageProvider === "local-filesystem" && attachment.storageKey) {
        const bridge = getDesktopBridge(); if (!bridge) throw new Error("This desktop file is not available on this device.");
        blob = new Blob([await bridge.readDocumentVersion({ key: attachment.storageKey })], { type: file.mimeType });
      }
      if (!blob) {
        if (!attachment.downloadUrl || attachment.downloadUrl.startsWith("demo://")) throw new Error(attachment.downloadError ?? "No saved file bytes are available.");
        const downloadUrl = attachment.storageProvider === "local" ? (() => { const url = new URL(attachment.downloadUrl!, window.location.origin); return `${url.pathname}${url.search}`; })() : attachment.downloadUrl;
        const response = await fetchDocumentDownload(downloadUrl, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`File download failed (${response.status}).`);
        if ((response.headers.get("content-type") ?? "").includes("text/html") && file.mimeType !== "text/html") throw new Error("The file URL returned a page instead of document bytes.");
        blob = await response.blob();
      }
      await add(file, blob);
    } catch (error) { await add({ ...file, status: "unavailable", reason: error instanceof Error ? error.message : "File could not be read." }); }
  }
  progress?.(total, total, "Files ready");
}
