import { MAX_CHUNKED_RECORD_BYTES, MAX_RESTORE_RECORDS, MAX_SETUP_BACKUP_BYTES, V1_BACKUP_RECORD_LIMIT, validateSetupBackup } from "../../shared/onboardingBackup";
import { Sha256 } from "./sha256Stream";
import { openZip, readZipEntryBlob, readZipEntryBytes, readZipEntryChunks, StreamingZipWriter, ZIP32_LIMIT, type ZipReaderEntry } from "./zipStream";

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
/** A records chunk of a version 2 archive: one JSON array of rows of one table. */
export type ArchiveRecordChunk = { path: string; table: string; rows: number; bytes: number; sha256: string };
export type ArchiveManifest = {
  kind: "societyer.workspaceArchive";
  /**
   * 1: every record in one `workspace.json` (at most 256 MB and 200,000 records; every build restores it).
   * 2: records in chunks under `database/` (`database.meta` plus `database.chunks`), for larger workspaces;
   *    builds before chunked backups cannot read it (they could not restore a workspace this size either).
   */
  version: 1 | 2;
  generatedAtISO: string;
  database: { path: string; sha256: string; bytes: number; kind: string; format?: "chunked"; meta?: { path: string; sha256: string; bytes: number }; chunks?: ArchiveRecordChunk[] };
  tableCount: number;
  rowCount: number;
  files: ArchiveFile[];
  includedFiles: number;
  externalFiles: number;
  unavailableFiles: number;
  completeStoredFiles: boolean;
};
/** Largest archive written or restored on a device (expanded size; plain ZIP without ZIP64). */
export const MAX_ARCHIVE_BYTES = Math.min(3.5 * 1024 * 1024 * 1024, ZIP32_LIMIT);
const MAX_ARCHIVE_LABEL = "3.5 GB";
/** Target size of one serialized records chunk (characters before UTF-8 encoding). */
const CHUNK_CHARS = 8 * 1024 * 1024;

export const hashBytes = async (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map(n => n.toString(16).padStart(2, "0")).join("");
export const safeArchiveName = (name: string) => name.replace(/[\\/\x00-\x1f:*?"<>|]/g, "_").replace(/^\.+/, "_").slice(0, 160) || "document";

/**
 * Records to archive, table by table, without one object holding the whole workspace: `rows()` yields
 * batches (a local workspace loads each batch's lazy fields only while it is written).
 */
export type DatabaseSource = {
  /** The snapshot without `tables` (kind, workspace, attachments, change journal, active organization…). */
  meta: Record<string, unknown>;
  tables: Array<{ name: string; rows: () => AsyncIterable<any[]> | Iterable<any[]> }>;
};
export function isDatabaseSource(value: unknown): value is DatabaseSource {
  return Boolean(value && typeof value === "object" && Array.isArray((value as any).tables) && (value as any).meta && typeof (value as any).meta === "object");
}
/** A database object (`{ kind, tables: { name: rows[] }, … }`) as a source. */
export function databaseSource(database: any): DatabaseSource {
  const { tables, ...meta } = database ?? {};
  return {
    meta,
    tables: Object.entries((tables ?? {}) as Record<string, unknown>).filter(([, rows]) => Array.isArray(rows)).map(([name, rows]) => ({ name, rows: () => [rows as any[]] })),
  };
}

type Segment = { blob: Blob; rows: number; bytes: number };
type SerializedTable = { name: string; rows: number; segments: Segment[] };

async function serializeTables(source: DatabaseSource, onRows?: (table: string, rows: any[]) => void, onProgress?: (message: string) => void) {
  const encoder = new TextEncoder();
  const tables: SerializedTable[] = [];
  let rowCount = 0, bytes = 0;
  for (const table of source.tables) {
    const out: SerializedTable = { name: table.name, rows: 0, segments: [] };
    let pieces: string[] = [], chars = 0, segmentRows = 0;
    const flush = () => {
      if (!pieces.length) return;
      const data = encoder.encode(pieces.join(","));
      out.segments.push({ blob: new Blob([data as BlobPart]), rows: segmentRows, bytes: data.length });
      bytes += data.length;
      pieces = []; chars = 0; segmentRows = 0;
    };
    for await (const batch of table.rows() as AsyncIterable<any[]>) {
      onRows?.(table.name, batch);
      for (const row of batch) {
        const json = JSON.stringify(row);
        pieces.push(json);
        chars += json.length + 1;
        segmentRows++;
        out.rows++;
        if (chars >= CHUNK_CHARS) flush();
      }
      onProgress?.(`Records: ${table.name} (${out.rows.toLocaleString("en-CA")})`);
    }
    flush();
    rowCount += out.rows;
    // Brackets and the comma between segments.
    bytes += 2 + Math.max(0, out.segments.length - 1);
    tables.push(out);
  }
  return { tables, rowCount, bytes };
}

export type BuildArchiveOptions = {
  /** 1 or 2 forces a format; "auto" (default) writes version 1 whenever every build could restore it. */
  format?: "auto" | 1 | 2;
  /** Sees every batch of rows as it is written (e.g. to index saved files without keeping the rows). */
  onRows?: (table: string, rows: any[]) => void;
  onStatus?: (message: string) => void;
};

/**
 * Writes a workspace archive. Records are serialized a batch at a time into Blob segments, so no single
 * string or byte array holds the whole workspace; files are added one at a time. A workspace within the
 * version 1 limits gets a version 1 archive (one `workspace.json`, restorable by every build); a larger
 * one gets version 2 (records in checksummed chunks).
 */
export async function buildWorkspaceArchive(database: any, collectFiles: (add: (file: ArchiveFile, blob?: Blob) => Promise<void>) => Promise<void>, onProgress?: (percent: number) => void, options: BuildArchiveOptions = {}) {
  const source = isDatabaseSource(database) ? database : databaseSource(database);
  const kind = String((source.meta as any).kind ?? "societyer.localWorkspaceSnapshot");
  const serialized = await serializeTables(source, options.onRows, options.onStatus);
  const metaJson = JSON.stringify(source.meta);
  const fitsV1 = serialized.bytes + metaJson.length + 64 <= MAX_SETUP_BACKUP_BYTES && serialized.rowCount <= V1_BACKUP_RECORD_LIMIT;
  const version: 1 | 2 = options.format === 1 || options.format === 2 ? options.format : fitsV1 ? 1 : 2;
  if (version === 1 && !fitsV1) throw new Error(`Workspace records exceed the 256 MB / ${V1_BACKUP_RECORD_LIMIT.toLocaleString("en-CA")}-record limit of a single-file backup.`);
  if (serialized.rowCount > MAX_RESTORE_RECORDS) throw new Error(`The workspace has more than ${MAX_RESTORE_RECORDS.toLocaleString("en-CA")} records, more than a device restore accepts. Compact intake runs or split the workspace first.`);
  if (serialized.bytes > MAX_CHUNKED_RECORD_BYTES) throw new Error("Workspace records exceed the 1 GB device backup limit. Compact intake runs or split the workspace first.");
  const zip = new StreamingZipWriter();
  const encoder = new TextEncoder();
  let expandedBytes = 0;
  let database_: ArchiveManifest["database"];
  onProgress?.(0);
  if (version === 1) {
    const sha = new Sha256();
    const head = metaJson === "{}" ? "{" : `${metaJson.slice(0, -1)},`;
    async function* body() {
      yield encoder.encode(`${head}"tables":{`);
      for (const [index, table] of serialized.tables.entries()) {
        yield encoder.encode(`${index ? "," : ""}${JSON.stringify(table.name)}:[`);
        for (const [segmentIndex, segment] of table.segments.entries()) {
          if (segmentIndex) yield encoder.encode(",");
          yield new Uint8Array(await segment.blob.arrayBuffer());
        }
        yield encoder.encode("]");
      }
      yield encoder.encode("}}");
    }
    const entry = await zip.add("workspace.json", body(), { observe: (chunk) => sha.update(chunk) });
    expandedBytes += entry.size;
    database_ = { path: "workspace.json", bytes: entry.size, sha256: sha.hex(), kind };
  } else {
    const metaBytes = encoder.encode(JSON.stringify({ ...source.meta, tableNames: serialized.tables.map((table) => table.name) }));
    const metaEntry = { path: "database/meta.json", bytes: metaBytes.length, sha256: await hashBytes(metaBytes) };
    await zip.add(metaEntry.path, metaBytes);
    const chunks: ArchiveRecordChunk[] = [];
    let written = 0;
    for (const table of serialized.tables) {
      for (const [index, segment] of table.segments.entries()) {
        const body = new Uint8Array(segment.bytes + 2);
        body[0] = 0x5b; // [
        body.set(new Uint8Array(await segment.blob.arrayBuffer()), 1);
        body[body.length - 1] = 0x5d; // ]
        const path = `database/${table.name}/${String(index + 1).padStart(4, "0")}.json`;
        chunks.push({ path, table: table.name, rows: segment.rows, bytes: body.length, sha256: await hashBytes(body) });
        await zip.add(path, body);
        written += body.length;
        onProgress?.(Math.min(60, (written / Math.max(1, serialized.bytes)) * 60));
      }
      if (!table.segments.length) {
        const path = `database/${table.name}/0001.json`;
        const body = encoder.encode("[]");
        chunks.push({ path, table: table.name, rows: 0, bytes: body.length, sha256: await hashBytes(body) });
        await zip.add(path, body);
      }
    }
    expandedBytes += metaBytes.length + chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    database_ = { path: "database/", format: "chunked", bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0), sha256: metaEntry.sha256, kind, meta: metaEntry, chunks };
  }
  serialized.tables.forEach((table) => (table.segments = []));
  const manifest: ArchiveManifest = {
    kind: "societyer.workspaceArchive", version, generatedAtISO: new Date().toISOString(),
    database: database_,
    tableCount: serialized.tables.length, rowCount: serialized.rowCount,
    files: [], includedFiles: 0, externalFiles: 0, unavailableFiles: 0, completeStoredFiles: true,
  };
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
        if (expandedBytes > MAX_ARCHIVE_BYTES) throw new Error(`This archive exceeds the ${MAX_ARCHIVE_LABEL} device export limit.`);
        path = `files/${digest}/${safeArchiveName(entry.fileName)}`;
        await zip.add(path, data, { compress: false });
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
  await zip.add("manifest.json", encoder.encode(JSON.stringify(manifest, null, 2)));
  await zip.add("RESTORE.txt", encoder.encode("Societyer workspace archive\n\nIn a local workspace, open Settings > Workspace storage > Restore a backup and choose this ZIP. ZIP files also work in organization setup and the Data export preview. Restore replaces the selected device workspace; export its current records first if needed.\n\nRecords: workspace.json (version 1 archives) or database/ (version 2: database/meta.json and one or more JSON chunks per table, each with its SHA-256 in manifest.json). files/ contains saved originals and uploaded files; manifest.json records their SHA-256 checksums and file references. Embedded source images remain in the records. Files kept only on external services are listed as external references. Any saved file that could not be fetched is marked unavailable; those archives are labelled incomplete.\n\nOrganization exports retain the chosen recovery-secret redaction. They restore records locally, not credentials or a live server. A full device backup can contain several organizations and its retained change journal.\n"));
  onProgress?.(100);
  const blob = zip.finish();
  return { blob, manifest };
}

/**
 * Cheap check that a chosen file can be a Societyer backup (a ZIP archive or
 * a JSON object), so restore can refuse it before asking the person to
 * confirm replacing their workspace. The full parse still happens on restore.
 */
export async function preflightWorkspaceBackupFile(file: File): Promise<void> {
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error(`Choose a backup smaller than ${MAX_ARCHIVE_LABEL}.`);
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return;
  if (file.size > MAX_SETUP_BACKUP_BYTES) throw new Error("Workspace JSON backups must be smaller than 256 MB.");
  const text = new TextDecoder().decode(head).replace(/^﻿/, "").trimStart();
  if (!text.startsWith("{")) throw new Error(`"${file.name}" is not readable JSON or a Societyer ZIP backup.`);
}

/** Decodes an entry as text while hashing it, without keeping its bytes. */
async function entryText(file: Blob, entry: ZipReaderEntry, sha?: Sha256): Promise<string> {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  for await (const chunk of readZipEntryChunks(file, entry)) {
    sha?.update(chunk);
    size += chunk.length;
    parts.push(decoder.decode(chunk, { stream: true }));
  }
  parts.push(decoder.decode());
  if (size !== entry.size) throw new Error("A ZIP entry is shorter than its recorded size.");
  return parts.join("");
}

export async function readWorkspaceArchiveFile(file: File): Promise<{ database: any; manifest?: ArchiveManifest; files: Map<string, Blob> }> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error(`Choose a backup smaller than ${MAX_ARCHIVE_LABEL}.`);
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    if (file.size > MAX_SETUP_BACKUP_BYTES) throw new Error("Workspace JSON backups must be smaller than 256 MB.");
    try { return { database: JSON.parse(await file.text()), files: new Map() }; }
    catch { throw new Error(`"${file.name}" is not readable JSON or a Societyer ZIP backup.`); }
  }
  let zip: Map<string, ZipReaderEntry>;
  try { zip = await openZip(file); }
  catch { throw new Error(`"${file.name}" is not a readable ZIP backup. The file may be damaged or only partly downloaded.`); }
  const names = [...zip.keys()];
  if (names.length > 50_000) throw new Error("The ZIP contains too many files.");
  let expanded = 0;
  for (const name of names) {
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new Error("The ZIP contains an invalid file path.");
    expanded += zip.get(name)!.size;
    if (expanded > MAX_ARCHIVE_BYTES) throw new Error(`The ZIP expands beyond the ${MAX_ARCHIVE_LABEL} restore limit.`);
  }
  const damaged = (error: unknown): never => {
    if (error instanceof Error && /checksum|exceeds|invalid|missing|inventory|supported/i.test(error.message)) throw error;
    throw new Error(`"${file.name}" is not a readable ZIP backup. The file may be damaged or only partly downloaded.`);
  };
  const metadata = zip.get("manifest.json");
  if (!metadata) {
    // Older delivered backups wrapped a single workspace JSON in a ZIP with
    // restore instructions and validation reports, without a file inventory.
    const candidates = names.filter(name => name.endsWith(".json") && !zip.get(name)!.dir);
    if (candidates.length > 10) throw new Error("The ZIP has no supported Societyer manifest.");
    for (const name of candidates) {
      if (zip.get(name)!.size > MAX_SETUP_BACKUP_BYTES) throw new Error("The ZIP database exceeds 256 MB.");
      let value: any;
      try { value = JSON.parse(await entryText(file, zip.get(name)!)); } catch { continue; }
      if (["societyer.localWorkspaceSnapshot", "societyer.workspaceExport"].includes(value?.kind)) {
        archiveDatabaseSnapshot(value);
        return { database: value, files: new Map() };
      }
    }
    throw new Error("The ZIP has no supported Societyer workspace database.");
  }
  if (metadata.size > 8 * 1024 * 1024) throw new Error("The ZIP manifest is too large.");
  let manifest: ArchiveManifest;
  try { manifest = JSON.parse(await entryText(file, metadata)); } catch { throw new Error("The ZIP manifest is invalid."); }
  if (manifest?.kind !== "societyer.workspaceArchive" || !Array.isArray(manifest.files) || manifest.files.length > 50_000) throw new Error("This is not a supported Societyer ZIP backup.");
  let database: any;
  if (manifest.version === 1) {
    if (manifest.database?.path !== "workspace.json") throw new Error("This is not a supported Societyer ZIP backup.");
    const recordFile = zip.get(manifest.database.path);
    if (!recordFile || recordFile.size > MAX_SETUP_BACKUP_BYTES) throw new Error("The ZIP database is missing or exceeds 256 MB.");
    const sha = new Sha256();
    let text: string;
    try { text = await entryText(file, recordFile, sha); } catch (error) { damaged(error); }
    if (recordFile.size !== manifest.database.bytes || sha.hex() !== manifest.database.sha256) throw new Error("The ZIP database failed its checksum check.");
    database = JSON.parse(text!);
  } else if (manifest.version === 2) {
    database = await readChunkedDatabase(file, zip, manifest).catch(damaged);
  } else throw new Error("This Societyer ZIP backup was written by a newer version. Update Societyer to restore it.");
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
    const zipEntry = zip.get(entry.archivePath);
    let blob: Blob | undefined;
    try { blob = zipEntry ? await readZipEntryBlob(file, zipEntry, entry.mimeType || "application/octet-stream") : undefined; } catch { blob = undefined; }
    // One file at a time: the bytes are hashed and dropped; the kept Blob is a slice of the archive.
    if (!blob || blob.size !== entry.bytes || await hashBytes(await blob.arrayBuffer()) !== entry.sha256) throw new Error(`The saved file "${entry.fileName}" failed its checksum check.`);
    files.set(entry.sha256!, blob);
    verifiedPaths.set(entry.sha256!, entry.archivePath);
  }
  const rows = Object.values(database.tables ?? {}).filter(Array.isArray) as any[][];
  if (manifest.tableCount !== rows.length || manifest.rowCount !== rows.reduce((sum, table) => sum + table.length, 0) || manifest.includedFiles !== files.size || manifest.unavailableFiles !== manifest.files.filter(f => f.status === "unavailable").length || manifest.externalFiles !== manifest.files.filter(f => f.status === "external").length || manifest.completeStoredFiles !== (manifest.unavailableFiles === 0)) throw new Error("The ZIP inventory does not match its contents.");
  return { database, manifest, files };
}

/** Version 2: `database/meta.json` plus checksummed record chunks, parsed one chunk at a time. */
async function readChunkedDatabase(file: Blob, zip: Map<string, ZipReaderEntry>, manifest: ArchiveManifest) {
  const spec = manifest.database;
  if (spec?.format !== "chunked" || !spec.meta || !Array.isArray(spec.chunks)) throw new Error("This is not a supported Societyer ZIP backup.");
  if (spec.chunks.length > 20_000) throw new Error("The ZIP has too many record chunks.");
  const total = spec.chunks.reduce((sum, chunk) => sum + (Number(chunk.bytes) || 0), 0);
  if (total > MAX_CHUNKED_RECORD_BYTES) throw new Error("The ZIP records exceed the 1 GB restore limit.");
  const metaEntry = zip.get(spec.meta.path);
  if (!metaEntry || metaEntry.size !== spec.meta.bytes || metaEntry.size > 64 * 1024 * 1024) throw new Error("The ZIP database is missing or invalid.");
  const metaBytes = await readZipEntryBytes(file, metaEntry);
  if (await hashBytes(metaBytes) !== spec.meta.sha256) throw new Error("The ZIP database failed its checksum check.");
  const { tableNames, ...meta } = JSON.parse(new TextDecoder().decode(metaBytes));
  if (!Array.isArray(tableNames)) throw new Error("The ZIP database is missing or invalid.");
  const tables: Record<string, any[]> = Object.create(null);
  for (const name of tableNames) {
    if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("The ZIP database contains an invalid table name.");
    tables[name] = [];
  }
  let rowCount = 0;
  for (const chunk of spec.chunks) {
    if (typeof chunk?.path !== "string" || !chunk.path.startsWith("database/") || !(chunk.table in tables)) throw new Error("The ZIP database is missing or invalid.");
    const entry = zip.get(chunk.path);
    if (!entry || entry.size !== chunk.bytes) throw new Error("The ZIP database is missing or invalid.");
    const bytes = await readZipEntryBytes(file, entry);
    if (await hashBytes(bytes) !== chunk.sha256) throw new Error("The ZIP database failed its checksum check.");
    const rows = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(rows) || rows.length !== chunk.rows) throw new Error("The ZIP database failed its checksum check.");
    rowCount += rows.length;
    if (rowCount > MAX_RESTORE_RECORDS) throw new Error(`The backup exceeds the ${MAX_RESTORE_RECORDS.toLocaleString("en-CA")}-record device restore limit.`);
    const target = tables[chunk.table];
    for (const row of rows) target.push(row);
  }
  return { ...meta, tables: { ...tables } };
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
