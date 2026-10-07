import JSZip from "jszip";
import { MAX_SETUP_BACKUP_BYTES, validateSetupBackup } from "../../shared/onboardingBackup";

export type ArchiveFile = {
  archivePath?: string;
  fileName: string;
  mimeType?: string;
  provider?: string;
  storageKey?: string;
  documentId?: string;
  versionId?: string;
  sha256?: string;
  bytes?: number;
  status: "included" | "external" | "unavailable";
  reason?: string;
  externalUrl?: string;
};
export type ArchiveManifest = {
  kind: "societyer.workspaceArchive";
  version: 1;
  generatedAtISO: string;
  database: { path: string; sha256: string; bytes: number; kind: string };
  tableCount: number;
  rowCount: number;
  files: ArchiveFile[];
  includedFiles: number;
  externalFiles: number;
  unavailableFiles: number;
  completeStoredFiles: boolean;
};
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
export const hashBytes = async (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map(n => n.toString(16).padStart(2, "0")).join("");
export const safeArchiveName = (name: string) => name.replace(/[\\/\x00-\x1f:*?"<>|]/g, "_").replace(/^\.+/, "_").slice(0, 160) || "document";

export async function buildWorkspaceArchive(database: any, collectFiles: (add: (file: ArchiveFile, blob?: Blob) => Promise<void>) => Promise<void>, onProgress?: (percent: number) => void) {
  const zip = new JSZip();
  const text = JSON.stringify(database);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_SETUP_BACKUP_BYTES) throw new Error("Workspace records exceed the 256 MB restore limit. Split the workspace before exporting a restorable backup.");
  const entries = Object.entries(database.tables ?? {}).filter(([, rows]) => Array.isArray(rows));
  const manifest: ArchiveManifest = {
    kind: "societyer.workspaceArchive", version: 1, generatedAtISO: new Date().toISOString(),
    database: { path: "workspace.json", bytes: bytes.length, sha256: await hashBytes(bytes), kind: database.kind },
    tableCount: entries.length, rowCount: entries.reduce((sum, [, rows]) => sum + (rows as any[]).length, 0),
    files: [], includedFiles: 0, externalFiles: 0, unavailableFiles: 0, completeStoredFiles: true,
  };
  zip.file("workspace.json", bytes, { compression: "DEFLATE", compressionOptions: { level: 1 } });
  let expandedBytes = bytes.length;
  const stored = new Map<string, string>();
  await collectFiles(async (file, blob) => {
    const entry = { ...file };
    if (blob) {
      const data = new Uint8Array(await blob.arrayBuffer());
      const digest = await hashBytes(data);
      if (entry.sha256 && entry.sha256.toLowerCase() !== digest) throw new Error(`Checksum mismatch for ${entry.fileName}.`);
      if (entry.bytes !== undefined && entry.bytes !== data.length) throw new Error(`Incomplete file: ${entry.fileName}.`);
      let path = stored.get(digest);
      if (!path) {
        expandedBytes += data.length;
        if (expandedBytes > MAX_ARCHIVE_BYTES) throw new Error("This archive exceeds the 1 GB device export limit.");
        path = `files/${digest}/${safeArchiveName(entry.fileName)}`;
        zip.file(path, data, { compression: "STORE" });
        stored.set(digest, path);
      }
      Object.assign(entry, { status: "included", archivePath: path, sha256: digest, bytes: data.length });
    } else if (entry.status === "included") throw new Error("An included file has no bytes.");
    manifest.files.push(entry);
  });
  manifest.includedFiles = stored.size;
  manifest.externalFiles = manifest.files.filter(f => f.status === "external").length;
  manifest.unavailableFiles = manifest.files.filter(f => f.status === "unavailable").length;
  manifest.completeStoredFiles = manifest.unavailableFiles === 0;
  zip.file("manifest.json", JSON.stringify(manifest, null, 2), { compression: "DEFLATE" });
  zip.file("RESTORE.txt", "Societyer workspace archive\n\nIn a local workspace, open Settings > Workspace storage > Restore a backup and choose this ZIP. ZIP files also work in organization setup and the Data export preview. Restore replaces the selected device workspace; export its current records first if needed.\n\nworkspace.json contains every exported record table. files/ contains saved originals and uploaded files; manifest.json records their SHA-256 checksums and file references. Embedded source images remain in workspace.json. Files kept only on external services are listed as external references. Any saved file that could not be fetched is marked unavailable; those archives are labelled incomplete.\n\nOrganization exports retain the chosen recovery-secret redaction. They restore records locally, not credentials or a live server. A full device backup can contain several organizations and its retained change journal.\n", { compression: "DEFLATE" });
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip", streamFiles: true }, info => onProgress?.(info.percent));
  return { blob, manifest };
}

/**
 * Cheap check that a chosen file can be a Societyer backup (a ZIP archive or
 * a JSON object), so restore can refuse it before asking the person to
 * confirm replacing their workspace. The full parse still happens on restore.
 */
export async function preflightWorkspaceBackupFile(file: File): Promise<void> {
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("Choose a backup smaller than 1 GB.");
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return;
  if (file.size > MAX_SETUP_BACKUP_BYTES) throw new Error("Workspace JSON backups must be smaller than 256 MB.");
  const text = new TextDecoder().decode(head).replace(/^\uFEFF/, "").trimStart();
  if (!text.startsWith("{")) throw new Error(`"${file.name}" is not readable JSON or a Societyer ZIP backup.`);
}

export async function readWorkspaceArchiveFile(file: File): Promise<{ database: any; manifest?: ArchiveManifest; files: Map<string, Blob> }> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("Choose a backup smaller than 1 GB.");
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    if (file.size > MAX_SETUP_BACKUP_BYTES) throw new Error("Workspace JSON backups must be smaller than 256 MB.");
    try { return { database: JSON.parse(await file.text()), files: new Map() }; }
    catch { throw new Error(`"${file.name}" is not readable JSON or a Societyer ZIP backup.`); }
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files);
  if (names.length > 50_000) throw new Error("The ZIP contains too many files.");
  let expanded = 0;
  for (const name of names) {
    const entry = zip.files[name] as any;
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || (entry.unsafeOriginalName && entry.unsafeOriginalName !== name)) throw new Error("The ZIP contains an invalid file path.");
    const size = entry._data?.uncompressedSize ?? 0;
    expanded += size;
    if (expanded > MAX_ARCHIVE_BYTES) throw new Error("The ZIP expands beyond the 1 GB restore limit.");
  }
  const metadata = zip.file("manifest.json");
  if (!metadata) {
    // Older delivered backups wrapped a single workspace JSON in a ZIP with
    // restore instructions and validation reports, without a file inventory.
    const candidates = names.filter(name => name.endsWith(".json") && !zip.files[name].dir);
    if (candidates.length > 10) throw new Error("The ZIP has no supported Societyer manifest.");
    for (const name of candidates) {
      if ((zip.files[name] as any)._data?.uncompressedSize > MAX_SETUP_BACKUP_BYTES) throw new Error("The ZIP database exceeds 256 MB.");
      let value: any;
      try { value = JSON.parse(await zip.files[name].async("string")); } catch { continue; }
      if (["societyer.localWorkspaceSnapshot", "societyer.workspaceExport"].includes(value?.kind)) {
        archiveDatabaseSnapshot(value);
        return { database: value, files: new Map() };
      }
    }
    throw new Error("The ZIP has no supported Societyer workspace database.");
  }
  if ((metadata as any)._data?.uncompressedSize > 8 * 1024 * 1024) throw new Error("The ZIP manifest is too large.");
  let manifest: ArchiveManifest;
  try { manifest = JSON.parse(await metadata.async("string")); } catch { throw new Error("The ZIP manifest is invalid."); }
  if (manifest.kind !== "societyer.workspaceArchive" || manifest.version !== 1 || manifest.database?.path !== "workspace.json" || !Array.isArray(manifest.files) || manifest.files.length > 50_000) throw new Error("This is not a supported Societyer ZIP backup.");
  const recordFile = zip.file(manifest.database.path);
  if (!recordFile || (recordFile as any)._data?.uncompressedSize > MAX_SETUP_BACKUP_BYTES) throw new Error("The ZIP database is missing or exceeds 256 MB.");
  const records = await recordFile.async("uint8array");
  if (records.length !== manifest.database.bytes || await hashBytes(records) !== manifest.database.sha256) throw new Error("The ZIP database failed its checksum check.");
  const database = JSON.parse(new TextDecoder().decode(records));
  const files = new Map<string, Blob>();
  const verifiedPaths = new Map<string, string>();
  for (const entry of manifest.files) {
    if (!["included", "external", "unavailable"].includes(entry.status) || typeof entry.fileName !== "string") throw new Error("Invalid ZIP file inventory.");
    if (entry.status !== "included") continue;
    if (!entry.archivePath?.startsWith("files/") || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "") || !Number.isSafeInteger(entry.bytes) || entry.bytes! < 0) throw new Error("Invalid ZIP file reference.");
    if (files.has(entry.sha256!)) {
      if (files.get(entry.sha256!)!.size !== entry.bytes || verifiedPaths.get(entry.sha256!) !== entry.archivePath) throw new Error("The ZIP contains inconsistent file aliases.");
      continue;
    }
    const data = await zip.file(entry.archivePath)?.async("uint8array");
    if (!data || data.length !== entry.bytes || await hashBytes(data) !== entry.sha256) throw new Error(`The saved file "${entry.fileName}" failed its checksum check.`);
    files.set(entry.sha256!, new Blob([data as BlobPart], { type: entry.mimeType || "application/octet-stream" }));
    verifiedPaths.set(entry.sha256!, entry.archivePath);
  }
  const rows = Object.values(database.tables ?? {}).filter(Array.isArray) as any[][];
  if (manifest.tableCount !== rows.length || manifest.rowCount !== rows.reduce((sum, table) => sum + table.length, 0) || manifest.includedFiles !== files.size || manifest.unavailableFiles !== manifest.files.filter(f => f.status === "unavailable").length || manifest.externalFiles !== manifest.files.filter(f => f.status === "external").length || manifest.completeStoredFiles !== (manifest.unavailableFiles === 0)) throw new Error("The ZIP inventory does not match its contents.");
  return { database, manifest, files };
}

export function archiveDatabaseSnapshot(database: any) {
  const snapshot = database?.kind === "societyer.workspaceExport" ? {
    kind: "societyer.localWorkspaceSnapshot", exportedAtISO: database.generatedAtISO,
    tables: database.tables, attachments: [], changes: [],
    // An organization export names its organization; open it after restoring.
    ...(typeof database.society?._id === "string" ? { activeSocietyId: database.society._id } : {}),
  } : database;
  validateSetupBackup(snapshot);
  return snapshot;
}
