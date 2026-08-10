import { localDataClient } from "./localDataClient";

type LocalExportCapableClient = {
  exportLocalWorkspaceSnapshot?: () => unknown;
  importLocalWorkspaceSnapshot?: (snapshot: any) => Promise<unknown> | unknown;
};

export type WorkspaceBackupSummary = {
  exportedAtISO: string | null;
  tableCount: number;
  rowCount: number;
  attachmentCount: number;
  societies: Array<{ _id: string; name: string }>;
};

export function getLocalWorkspaceSnapshot() {
  const client = localDataClient as unknown as LocalExportCapableClient;
  return client.exportLocalWorkspaceSnapshot?.() ?? null;
}

export function localWorkspaceBackupSupported() {
  const client = localDataClient as unknown as LocalExportCapableClient;
  return typeof client.exportLocalWorkspaceSnapshot === "function";
}

export function localWorkspaceRestoreSupported() {
  const client = localDataClient as unknown as LocalExportCapableClient;
  return typeof client.importLocalWorkspaceSnapshot === "function";
}

export function downloadLocalWorkspaceSnapshot(filename = defaultBackupFilename()) {
  const snapshot = getLocalWorkspaceSnapshot();
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

/** Parse and validate a backup file without writing anything. */
export async function readWorkspaceBackupFile(file: File) {
  let snapshot: any;
  try {
    snapshot = JSON.parse(await file.text());
  } catch {
    throw new Error(`"${file.name}" is not readable JSON. Choose a Societyer backup file.`);
  }
  if (!snapshot || typeof snapshot !== "object" || !snapshot.tables || typeof snapshot.tables !== "object") {
    throw new Error(`"${file.name}" is not a Societyer workspace backup.`);
  }
  return snapshot;
}

export function summarizeWorkspaceBackup(snapshot: any): WorkspaceBackupSummary {
  const tables = (snapshot?.tables ?? {}) as Record<string, unknown[]>;
  const entries = Object.entries(tables).filter(([, rows]) => Array.isArray(rows));
  const societies = (Array.isArray(tables.societies) ? tables.societies : []) as Array<Record<string, any>>;
  return {
    exportedAtISO: typeof snapshot?.exportedAtISO === "string" ? snapshot.exportedAtISO : null,
    tableCount: entries.filter(([, rows]) => (rows as unknown[]).length > 0).length,
    rowCount: entries.reduce((total, [, rows]) => total + (rows as unknown[]).length, 0),
    attachmentCount: Array.isArray(snapshot?.attachments) ? snapshot.attachments.length : 0,
    societies: societies
      .filter((row) => typeof row?._id === "string")
      .map((row) => ({ _id: String(row._id), name: String(row.name ?? "Untitled organization") })),
  };
}

export async function importLocalWorkspaceSnapshotFile(file: File) {
  const snapshot = await readWorkspaceBackupFile(file);
  const client = localDataClient as unknown as LocalExportCapableClient;
  if (!client.importLocalWorkspaceSnapshot) {
    throw new Error("Local workspace import is unavailable in this runtime.");
  }
  await client.importLocalWorkspaceSnapshot(snapshot);
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
