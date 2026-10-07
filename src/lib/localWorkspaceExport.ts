import { localDataClient } from "./localDataClient";
import { archiveDatabaseSnapshot, buildWorkspaceArchive, readWorkspaceArchiveFile, type ArchiveManifest } from "./workspaceArchive";
import { archiveFileRows, collectWorkspaceFiles, type AttachmentDownload } from "./workspaceArchiveFiles";
import { triggerBlobDownload } from "./zip";
import { isLocalDataRuntime } from "./staticRuntime";
import { preferredRestoredSocietyId } from "./restoredSociety";

type LocalExportCapableClient = {
  exportLocalWorkspaceSnapshotAsync?: () => Promise<unknown>;
  importLocalWorkspaceSnapshot?: (snapshot: any, files?: ReturnType<typeof archiveFileRows>) => Promise<unknown> | unknown;
};

export type WorkspaceBackupSummary = {
  exportedAtISO: string | null;
  tableCount: number;
  rowCount: number;
  attachmentCount: number;
  includedFiles: number;
  unavailableFiles: number;
  externalFiles: number;
  societies: Array<{ _id: string; name: string }>;
  /**
   * Organization to open after the restore: the one that was active when the
   * backup was made, else the first organization that is not the bundled demo.
   */
  preferredSocietyId: string | null;
};

/** Selected-organization key written by `setStoredSocietyId` (hooks/useSociety). */
const SELECTED_SOCIETY_KEY = "societyer.currentSocietyId";

function readSelectedSocietyId(): string | null {
  try { return localStorage.getItem(SELECTED_SOCIETY_KEY); } catch { return null; }
}

export { preferredRestoredSocietyId };

/** Full snapshot of the local workspace, heavy fields included (read back from IndexedDB). */
export async function getLocalWorkspaceSnapshot(): Promise<any> {
  const client = localDataClient as unknown as LocalExportCapableClient;
  const snapshot: any = (await client.exportLocalWorkspaceSnapshotAsync?.()) ?? null;
  // Remember which organization was open so a restore reopens it.
  const activeSocietyId = readSelectedSocietyId();
  if (snapshot && activeSocietyId) snapshot.activeSocietyId = activeSocietyId;
  return snapshot;
}

export function localWorkspaceBackupSupported() {
  const client = localDataClient as unknown as LocalExportCapableClient;
  return isLocalDataRuntime() && typeof client.exportLocalWorkspaceSnapshotAsync === "function";
}

export function localWorkspaceRestoreSupported() {
  const client = localDataClient as unknown as LocalExportCapableClient;
  return isLocalDataRuntime() && typeof client.importLocalWorkspaceSnapshot === "function";
}

export async function downloadLocalWorkspaceSnapshot(filename = defaultBackupFilename()) {
  const snapshot = await getLocalWorkspaceSnapshot();
  if (!snapshot) throw new Error("Local workspace export is unavailable in this runtime.");
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Safari needs the object URL to survive the click before it is torn down.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

export function defaultBackupFilename(now = new Date()) {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `societyer-backup-${stamp}.json`;
}

export async function downloadLocalWorkspaceZip(onProgress?: (message: string) => void) {
  await localDataClient.whenLocalWorkspaceReady?.();
  const snapshot: any = await getLocalWorkspaceSnapshot();
  if (!snapshot) throw new Error("Local workspace export is unavailable in this runtime.");
  const attachments: AttachmentDownload[] = [];
  for (const society of snapshot.tables.societies ?? []) {
    for (const source of ["documentVersions", "documents"] as const) {
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const result: any = await localDataClient.query("exports:exportAttachmentPage", { societyId: society._id, source, paginationOpts: { cursor, numItems: 100 } });
        attachments.push(...result.page);
        cursor = result.isDone ? null : result.continueCursor;
        if (cursor && seen.has(cursor)) throw new Error("The file listing did not advance.");
        if (cursor) seen.add(cursor);
      } while (cursor);
    }
  }
  // Physical local backups also retain detached attachment references.
  const keys = new Set(attachments.map(file => JSON.stringify([file.storageProvider, file.storageKey])));
  for (const ref of snapshot.attachments ?? []) if (!keys.has(JSON.stringify([ref.provider, ref.storageKey]))) attachments.push({ ...ref, storageProvider: ref.provider, id: ref.versionId });
  const result = await buildWorkspaceArchive(snapshot, add => collectWorkspaceFiles(snapshot.tables, attachments, add, (done, total, name) => onProgress?.(`Files ${done} of ${total}: ${name}`)), percent => onProgress?.(`Creating ZIP: ${Math.round(percent)}%`));
  const filename = defaultBackupFilename().replace(/\.json$/, result.manifest.completeStoredFiles ? ".zip" : "-incomplete.zip");
  triggerBlobDownload(result.blob, filename);
  return { filename, manifest: result.manifest };
}

/** Parse and validate a backup file without writing anything. */
export async function readWorkspaceBackupFile(file: File) {
  const archive = await readWorkspaceArchiveFile(file);
  const snapshot = restorableSnapshot(archive);
  backupManifests.set(snapshot, archive.manifest);
  return snapshot;
}
function restorableSnapshot(archive: Awaited<ReturnType<typeof readWorkspaceArchiveFile>>) {
  const snapshot = archiveDatabaseSnapshot(archive.database);
  // Organization exports redact legacy storage IDs. Keep their bundled file
  // references separately so the next full device backup still includes them.
  const references = new Set((snapshot.attachments ?? []).map((ref: any) => JSON.stringify([ref.provider, ref.storageKey])));
  for (const saved of archive.manifest?.files ?? []) {
    if (saved.status !== "included" || !saved.provider || !saved.storageKey) continue;
    const key = JSON.stringify([saved.provider, saved.storageKey]);
    if (references.has(key)) continue;
    references.add(key);
    const stamp = archive.manifest!.generatedAtISO;
    (snapshot.attachments ??= []).push({ key: `backup-file:${key}`, provider: saved.provider, storageKey: saved.storageKey, documentId: saved.documentId, versionId: saved.versionId, fileName: saved.fileName, mimeType: saved.mimeType, sha256: saved.sha256, fileSizeBytes: saved.bytes, createdAtISO: stamp, updatedAtISO: stamp });
  }
  return snapshot;
}
const backupManifests = new WeakMap<object, ArchiveManifest | undefined>();

export function summarizeWorkspaceBackup(snapshot: any): WorkspaceBackupSummary {
  const tables = (snapshot?.tables ?? {}) as Record<string, unknown[]>;
  const entries = Object.entries(tables).filter(([, rows]) => Array.isArray(rows));
  const societies = (Array.isArray(tables.societies) ? tables.societies : []) as Array<Record<string, any>>;
  return {
    exportedAtISO: typeof snapshot?.exportedAtISO === "string" ? snapshot.exportedAtISO : null,
    tableCount: entries.filter(([, rows]) => (rows as unknown[]).length > 0).length,
    rowCount: entries.reduce((total, [, rows]) => total + (rows as unknown[]).length, 0),
    attachmentCount: Array.isArray(snapshot?.attachments) ? snapshot.attachments.length : 0,
    includedFiles: backupManifests.get(snapshot)?.includedFiles ?? 0,
    unavailableFiles: backupManifests.get(snapshot)?.unavailableFiles ?? 0,
    externalFiles: backupManifests.get(snapshot)?.externalFiles ?? 0,
    societies: societies
      .filter((row) => typeof row?._id === "string")
      .map((row) => ({ _id: String(row._id), name: String(row.name ?? "Untitled organization") })),
    preferredSocietyId: preferredRestoredSocietyId(snapshot),
  };
}

export async function importLocalWorkspaceSnapshotFile(file: File) {
  const archive = await readWorkspaceArchiveFile(file);
  const snapshot = restorableSnapshot(archive);
  const client = localDataClient as unknown as LocalExportCapableClient;
  if (!client.importLocalWorkspaceSnapshot) {
    throw new Error("Local workspace import is unavailable in this runtime.");
  }
  await client.importLocalWorkspaceSnapshot(snapshot, archiveFileRows(archive.manifest, archive.files));
  backupManifests.set(snapshot, archive.manifest);
  return snapshot;
}

/**
 * Restore a backup over the current local workspace and report what landed, so
 * the caller can select the restored organization instead of stranding the user
 * on an empty dashboard.
 */
export async function restoreLocalWorkspaceBackup(file: File) {
  const snapshot = await importLocalWorkspaceSnapshotFile(file);
  return summarizeWorkspaceBackup(snapshot);
}
