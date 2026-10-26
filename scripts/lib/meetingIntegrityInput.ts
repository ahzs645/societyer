/** Offline export reader. No network, credentials, database clients or extraction. */
import { createHash } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { crc32, openZip, type ZipReaderEntry } from "../../src/lib/zipStream";

export type RecordRow = Record<string, any>;
export type CoverageState = "complete" | "partial" | "unverified" | "missing";
export type TableCoverage = { state: CoverageState; rows: number; fields: "full" | "redacted" | "unknown"; basis: string };
export type IntegrityScope = { kind: "deployment" | "workspaces" | "unknown"; societyIds: string[] };
export type ScopeManifest = {
  kind: "societyer.meetingIntegrityScope";
  version: 1;
  inputSha256: string;
  component: string;
  consistency: "point-in-time" | "non-atomic" | "unknown";
  scope: IntegrityScope;
  tables: Record<string, { complete: boolean; rows: number; fields: "full" | "redacted" | "unknown" }>;
};
export type InputIssue = { code: string; table?: string; rowId?: string; targetTable?: string; targetId?: string; count?: number };
export type IntegrityInput = {
  inputPath: string;
  inputIsDirectory: boolean;
  sha256: string;
  format: "convex-snapshot" | "workspace-export" | "local-workspace" | "table-bundle";
  component: string;
  otherComponents: string[];
  tables: Map<string, RecordRow[]>;
  coverage: Map<string, TableCoverage>;
  scope: IntegrityScope;
  consistency: ScopeManifest["consistency"];
  declaration: "none" | "complete-snapshot-flag" | "hash-bound-manifest";
  issues: InputIssue[];
  attachments: RecordRow[];
  binaryVerification: "not-checked" | "metadata-only" | "checksummed";
  binaryFiles: { inventoryEntries: number; checksummedEntries: number };
  limits: { maxRecordBytes: number; maxRows: number; maxFiles: number };
  verifyUnchanged: () => Promise<boolean>;
};
type Entry = { size: number; bytes: () => Promise<Uint8Array> };
const isObject = (value: unknown): value is RecordRow => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const safeTable = (name: unknown): name is string => typeof name === "string" && /^[_a-zA-Z][_a-zA-Z0-9]*$/.test(name);
const safeEntry = (name: string) => !!name && !name.startsWith("/") && !name.includes("\\") && !name.split("/").some(part => part === ".." || part === ".") && !/[\x00-\x1f]/.test(name);

async function digestFile(file: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

async function directoryFiles(root: string, limit: number): Promise<string[]> {
  const result: string[] = [];
  const walk = async (relative: string) => {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Input directories must not contain symbolic links.");
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        if (!safeEntry(name)) throw new Error("Input directory contains an unsupported path.");
        result.push(name);
        if (result.length > limit) throw new Error("Input exceeds the file-count limit.");
      } else throw new Error("Input directories must contain only regular files and directories.");
    }
  };
  await walk("");
  return result.sort();
}

async function digestDirectory(root: string, limit: number) {
  const digest = createHash("sha256");
  for (const name of await directoryFiles(root, limit)) {
    digest.update(JSON.stringify([name, await digestFile(path.join(root, name))]) + "\n");
  }
  return digest.digest("hex");
}

/** A plain JSON parser must never echo a private line through its SyntaxError. */
function parseJson(bytes: Uint8Array, label: string): any {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "")); }
  catch { throw new Error(`Invalid JSON in ${label}; content omitted.`); }
}

/** Node 20 supports zlib raw inflation; its Web DecompressionStream does not. */
async function zipEntryBytes(file: Blob, entry: ZipReaderEntry, maxBytes: number) {
  if (entry.compressedSize > maxBytes * 1.1 + 65536) throw new Error("A compressed ZIP entry exceeds the configured byte limit.");
  const header = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  if (header.byteLength !== 30 || header.getUint32(0, true) !== 0x04034b50) throw new Error("A ZIP entry header is damaged.");
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  if (start + entry.compressedSize > file.size) throw new Error("A ZIP entry is truncated.");
  const compressed = new Uint8Array(await file.slice(start, start + entry.compressedSize).arrayBuffer());
  let result: Uint8Array;
  if (entry.method === 0) result = compressed;
  else if (entry.method === 8) {
    try { result = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) }); }
    catch { throw new Error("A ZIP entry could not be safely decompressed; content omitted."); }
  } else throw new Error("A ZIP entry uses an unsupported compression method.");
  if (result.length !== entry.size || crc32(result) !== entry.crc) throw new Error("ZIP entry failed its length/checksum check; content omitted.");
  return result;
}

async function checkZipMetadataBounds(file: Blob, maxFiles: number) {
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
  for (let position = tail.length - 22; position >= 0; position--) {
    const end = new DataView(tail.buffer, tail.byteOffset + position);
    if (end.getUint32(0, true) !== 0x06054b50) continue;
    if (end.getUint16(10, true) > maxFiles) throw new Error("Input exceeds the file-count limit.");
    if (end.getUint32(12, true) > 64 * 1024 * 1024) throw new Error("ZIP central-directory metadata exceeds 64 MiB.");
    return;
  }
}

export async function loadIntegrityInput(inputPath: string, options: {
  scopeManifest?: string;
  completeSnapshot?: boolean;
  component?: string;
  verifyFiles?: boolean;
  maxRecordBytes?: number;
  maxRows?: number;
  maxFiles?: number;
} = {}): Promise<IntegrityInput> {
  const root = await realpath(inputPath);
  const original = await lstat(inputPath);
  if (original.isSymbolicLink()) throw new Error("Choose the input file or directory itself, not a symbolic link.");
  if (!original.isFile() && !original.isDirectory()) throw new Error("Input must be a regular JSON/ZIP file or an extracted export directory.");
  const limits = { maxRecordBytes: options.maxRecordBytes ?? 512 * 1024 * 1024, maxRows: options.maxRows ?? 1_000_000, maxFiles: options.maxFiles ?? 50_000 };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error("Input limits must be positive safe integers.");
  const inputIsDirectory = original.isDirectory();
  const fingerprint = () => inputIsDirectory ? digestDirectory(root, limits.maxFiles) : digestFile(root);
  const sha256 = await fingerprint();
  const entries = new Map<string, Entry>();
  if (inputIsDirectory) {
    for (const name of await directoryFiles(root, limits.maxFiles)) {
      const file = path.join(root, name);
      entries.set(name, { size: (await lstat(file)).size, bytes: async () => new Uint8Array(await readFile(file)) });
    }
  } else {
    const file = await openAsBlob(root);
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (signature[0] === 0x50 && signature[1] === 0x4b) {
      await checkZipMetadataBounds(file, limits.maxFiles);
      const zip = await openZip(file);
      if (zip.size > limits.maxFiles) throw new Error("Input exceeds the file-count limit.");
      for (const [name, entry] of zip) {
        if (!safeEntry(name)) throw new Error("ZIP contains an unsafe path; nothing was extracted.");
        if (entry.flags & 1) throw new Error("Encrypted ZIP entries are unsupported.");
        if (entry.dir) continue;
        entries.set(name, { size: entry.size, bytes: () => zipEntryBytes(file, entry, limits.maxRecordBytes) });
      }
    } else entries.set("input.json", { size: file.size, bytes: async () => new Uint8Array(await file.arrayBuffer()) });
  }
  let recordBytes = 0;
  const read = async (name: string, binary = false) => {
    const entry = entries.get(name);
    if (!entry) throw new Error("An export manifest references a missing archive entry.");
    if (!binary) {
      recordBytes += entry.size;
      if (recordBytes > limits.maxRecordBytes) throw new Error("Records exceed the configured byte limit; choose a larger --max-record-mib or a smaller export.");
    }
    // Verification is deliberately bounded too; no unrestricted ZIP expansion.
    if (entry.size > limits.maxRecordBytes) throw new Error("An export entry exceeds the configured byte limit.");
    return entry.bytes();
  };
  const tables = new Map<string, RecordRow[]>();
  const coverage = new Map<string, TableCoverage>();
  const issues: InputIssue[] = [];
  const attachments: RecordRow[] = [];
  let rowsRead = 0;
  const addTable = (name: string, rows: unknown, append = false) => {
    if (!safeTable(name) || !Array.isArray(rows) || !rows.every(isObject)) throw new Error("Unsupported table name or records shape; record content omitted.");
    if (!append && tables.has(name)) throw new Error("Export contains more than one source for a table.");
    rowsRead += rows.length;
    if (rowsRead > limits.maxRows) throw new Error("Export exceeds the configured record-count limit.");
    const all = append ? [...(tables.get(name) ?? []), ...rows] : rows;
    tables.set(name, all);
    coverage.set(name, { state: "unverified", rows: all.length, fields: "unknown", basis: "Present rows do not establish complete table coverage." });
  };
  let format: IntegrityInput["format"] = "table-bundle";
  let scope: IntegrityScope = { kind: "unknown", societyIds: [] };
  let consistency: ScopeManifest["consistency"] = "unknown";
  let declaration: IntegrityInput["declaration"] = "none";
  let binaryVerification: IntegrityInput["binaryVerification"] = "not-checked";
  const binaryFiles = { inventoryEntries: 0, checksummedEntries: 0 };
  const component = options.component ?? "";
  const otherComponents = new Set<string>();
  const nativeEntries = [...entries.keys()].filter(name => /(?:^|\/)\w+\/documents\.jsonl$/.test(name));
  let database: RecordRow | undefined;
  let archive: RecordRow | undefined;
  let prefix = "";
  const archiveManifestNames = [...entries.keys()].filter(name => /(?:^|\/)manifest\.json$/.test(name));
  for (const name of archiveManifestNames) {
    if (entries.get(name)!.size > 16 * 1024 * 1024) throw new Error("Archive manifest exceeds 16 MiB.");
    const candidate = parseJson(await read(name), "archive manifest");
    if (candidate?.kind !== "societyer.workspaceArchive") continue;
    if (archive) throw new Error("Input contains several workspace archives; audit them separately.");
    archive = candidate;
    prefix = name.slice(0, -"manifest.json".length);
  }
  const checked = async (entry: any) => {
    if (!isObject(entry) || typeof entry.path !== "string" || !safeEntry(entry.path)) throw new Error("Archive record manifest contains an invalid path.");
    const bytes = await read(prefix + entry.path);
    if (entry.bytes !== bytes.length || entry.sha256 !== hash(bytes)) throw new Error("Archive record chunk failed its length/checksum check.");
    return bytes;
  };
  if (archive) {
    if (archive.version === 1) database = parseJson(await checked(archive.database), "workspace database");
    else if (archive.version === 2 && archive.database?.format === "chunked" && Array.isArray(archive.database.chunks)) {
      database = parseJson(await checked(archive.database.meta), "workspace metadata");
      if (!isObject(database)) throw new Error("Workspace metadata must be an object.");
      const chunkPaths = new Set<string>();
      for (const chunk of archive.database.chunks) {
        if (!isObject(chunk) || !safeTable(chunk.table) || chunkPaths.has(chunk.path)) throw new Error("Archive chunk inventory is invalid.");
        chunkPaths.add(chunk.path);
        const rows = parseJson(await checked(chunk), "workspace table chunk");
        if (!Array.isArray(rows) || rows.length !== chunk.rows) throw new Error("Archive chunk record count does not match its manifest.");
        addTable(chunk.table, rows, true);
      }
      if (!Array.isArray(database.tableNames) || new Set(database.tableNames).size !== database.tableNames.length || database.tableNames.some((name: string) => !tables.has(name)) || tables.size !== database.tableNames.length) throw new Error("Archive table inventory does not match its chunks.");
    } else throw new Error("Unsupported Societyer archive version.");
  } else if (nativeEntries.length) {
    format = "convex-snapshot";
    for (const name of nativeEntries) {
      const pieces = name.split("/");
      const table = pieces.at(-2)!;
      const entryComponent = pieces.slice(0, -2).join("/");
      if (entryComponent !== component) { otherComponents.add(entryComponent); continue; }
      const bytes = await read(name);
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
      catch { throw new Error(`Invalid UTF-8 in table ${table}; content omitted.`); }
      const rows: RecordRow[] = [];
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        let row: unknown;
        try { row = JSON.parse(line); }
        catch { throw new Error(`Invalid JSONL in table ${table}, line ${index + 1}; content omitted.`); }
        if (!isObject(row)) throw new Error(`Non-object JSONL record in table ${table}, line ${index + 1}.`);
        rows.push(row);
        if (rowsRead + rows.length > limits.maxRows) throw new Error("Export exceeds the configured record-count limit.");
      }
      addTable(table, rows);
    }
    if (!tables.size) throw new Error("No tables found for the selected component. Use the exact archive component prefix.");
  } else {
    const candidates = [...entries.keys()].filter(name => name === "input.json" || /(?:^|\/)(?:workspace|workspace-export)\.json$/.test(name));
    if (candidates.length !== 1) throw new Error("Input must contain one workspace JSON or Convex table/documents.jsonl files.");
    database = parseJson(await read(candidates[0]), "workspace database");
    prefix = candidates[0].slice(0, candidates[0].lastIndexOf("/") + 1);
  }
  if (format !== "convex-snapshot" && !isObject(database)) throw new Error("Workspace database must be an object.");
  if (database) {
    format = database.kind === "societyer.workspaceExport" ? "workspace-export" : database.kind === "societyer.localWorkspaceSnapshot" ? "local-workspace" : "table-bundle";
    if (component) throw new Error("--component applies only to a Convex snapshot.");
    if (database.tables !== undefined) {
      if (!isObject(database.tables) || tables.size) throw new Error("Workspace table map is invalid or duplicated.");
      for (const [name, rows] of Object.entries(database.tables)) addTable(name, rows);
    }
    if (!tables.size) throw new Error("Workspace export contains no record tables (a metadata-only export is insufficient).");
    if (format === "workspace-export") {
      const societyId = database.manifest?.societyId ?? database.society?._id;
      if (typeof societyId === "string") scope = { kind: "workspaces", societyIds: [societyId] };
      consistency = "non-atomic";
      const declared = database.manifest?.tables;
      if (Array.isArray(declared)) for (const item of declared) {
        if (!isObject(item) || !safeTable(item.name)) throw new Error("Workspace export table inventory has an invalid name.");
        const actual = tables.get(item.name);
        if (!actual || !Number.isSafeInteger(item.rowCount) || item.rowCount !== actual.length) {
          issues.push({ code: "workspace_manifest_count_unverified", table: item.name });
          if (actual) coverage.set(item.name, { state: "partial", rows: actual.length, fields: "unknown", basis: "Workspace manifest count is missing or does not match." });
        }
      }
      // Export queries enforce ACLs and may run at different database versions.
      for (const [name, entry] of coverage) if (entry.state === "unverified") coverage.set(name, { ...entry, basis: "Workspace exports can be ACL-filtered and use multiple pagination transactions." });
      const redactedFields = database.manifest?.redactedFields ?? database.validation?.redactedFields;
      if (redactedFields !== undefined && (!Array.isArray(redactedFields) || !redactedFields.every(field => typeof field === "string"))) throw new Error("Workspace redaction inventory is invalid.");
      if (Array.isArray(redactedFields) && redactedFields.length) {
        // The application lists globally stripped fields, not a complete per-
        // table map. Preserve that known limitation for every supplied table.
        for (const [name, entry] of coverage) coverage.set(name, { ...entry, fields: "redacted", basis: "The workspace export declares globally redacted fields; full field coverage cannot be inferred per table." });
      }
    } else if (format === "local-workspace") {
      consistency = "non-atomic";
      scope = { kind: "workspaces", societyIds: (tables.get("societies") ?? []).map(row => row._id).filter((id): id is string => typeof id === "string") };
    }
    if (Array.isArray(database.attachments)) attachments.push(...database.attachments.filter(isObject));
  }
  if (archive) {
    if (archive.tableCount !== tables.size || archive.rowCount !== rowsRead) throw new Error("Workspace archive counts do not match the loaded database.");
    if (!Array.isArray(archive.files)) throw new Error("Archive has no file inventory.");
    binaryVerification = "metadata-only";
    const checkedFiles = new Map<string, string>();
    for (const file of archive.files) {
      if (!isObject(file)) throw new Error("Archive file inventory contains a non-object entry.");
      attachments.push(file);
      binaryFiles.inventoryEntries++;
      const rowId = typeof file.versionId === "string" ? file.versionId : typeof file.documentId === "string" ? file.documentId : undefined;
      if (file.status === "unavailable") issues.push({ code: "archive_file_unavailable", rowId });
      else if (file.status === "included") {
        if (typeof file.archivePath !== "string" || !safeEntry(file.archivePath)) throw new Error("Archive file inventory contains an invalid path.");
        const name = prefix + file.archivePath;
        const entry = entries.get(name);
        if (!entry) issues.push({ code: "archive_file_missing", rowId });
        else if (entry.size !== file.bytes) issues.push({ code: "archive_file_size_mismatch", rowId });
        else if (options.verifyFiles) {
          if (!checkedFiles.has(name)) {
            checkedFiles.set(name, hash(await read(name, true)));
            binaryFiles.checksummedEntries++;
            binaryVerification = "checksummed";
          }
          if (checkedFiles.get(name) !== file.sha256) issues.push({ code: "archive_file_checksum_mismatch", rowId });
        }
      } else if (file.status !== "external") issues.push({ code: "archive_file_status_unknown", rowId });
    }
  }
  const legacyAttachments = entries.get(prefix + "attachment-manifest.json");
  if (!archive && legacyAttachments) {
    const inventory = parseJson(await read(prefix + "attachment-manifest.json"), "attachment manifest");
    if (!Array.isArray(inventory?.files)) throw new Error("Invalid attachment manifest.");
    binaryVerification = "metadata-only";
    for (const file of inventory.files) {
      if (!isObject(file)) throw new Error("Invalid attachment entry.");
      binaryFiles.inventoryEntries++;
      attachments.push({ ...file, versionId: file.source === "documentVersions" ? file.id : undefined });
      if (file.ok !== true) issues.push({ code: file.skipped ? "archive_file_external_or_unavailable" : "archive_file_unavailable", rowId: file.id });
      else if (typeof file.archivePath !== "string" || !safeEntry(file.archivePath)) throw new Error("Invalid attachment path.");
      else if (!entries.has(prefix + file.archivePath)) issues.push({ code: "archive_file_missing", rowId: file.id });
      else if (options.verifyFiles) {
        binaryFiles.checksummedEntries++;
        binaryVerification = "checksummed";
        if (hash(await read(prefix + file.archivePath, true)) !== file.downloadedSha256) issues.push({ code: "archive_file_checksum_mismatch", rowId: file.id });
      }
    }
  }
  if (options.completeSnapshot) {
    if (format !== "convex-snapshot") throw new Error("--complete-snapshot is only valid for an unmodified Convex snapshot, not paginated workspace exports.");
    declaration = "complete-snapshot-flag";
    consistency = "point-in-time";
    scope = { kind: "deployment", societyIds: [] };
    for (const [name, entry] of coverage) coverage.set(name, { ...entry, state: "complete", fields: "full", basis: "Operator declared an unmodified, completed Convex snapshot; present tables only." });
  }
  if (options.scopeManifest) {
    if (options.completeSnapshot) throw new Error("Choose --scope-manifest or --complete-snapshot, not both.");
    if ((await lstat(options.scopeManifest)).size > 16 * 1024 * 1024) throw new Error("Scope manifest exceeds 16 MiB.");
    const declarationBytes = new Uint8Array(await readFile(options.scopeManifest));
    const manifest = parseJson(declarationBytes, "scope manifest") as ScopeManifest;
    if (!isObject(manifest) || manifest.kind !== "societyer.meetingIntegrityScope" || manifest.version !== 1 || manifest.inputSha256 !== sha256 || manifest.component !== component) throw new Error("Scope manifest kind, version, input hash, or component does not match this input.");
    if (!["point-in-time", "non-atomic", "unknown"].includes(manifest.consistency) || !isObject(manifest.scope) || !["deployment", "workspaces", "unknown"].includes(manifest.scope.kind) || !Array.isArray(manifest.scope.societyIds) || !manifest.scope.societyIds.every(id => typeof id === "string") || !isObject(manifest.tables)) throw new Error("Invalid scope/completeness declaration.");
    if (manifest.scope.kind === "workspaces" && !manifest.scope.societyIds.length) throw new Error("A workspace scope must name at least one society ID.");
    scope = manifest.scope;
    consistency = manifest.consistency;
    declaration = "hash-bound-manifest";
    for (const [name, declared] of Object.entries(manifest.tables)) {
      if (!safeTable(name) || !isObject(declared) || typeof declared.complete !== "boolean" || !Number.isSafeInteger(declared.rows) || declared.rows < 0 || !["full", "redacted", "unknown"].includes(declared.fields)) throw new Error("Invalid table completeness declaration.");
      const rows = tables.get(name);
      // An absent table is never silently converted into a complete empty table.
      if (!rows) { issues.push({ code: "declared_table_absent", table: name }); continue; }
      if (rows.length !== declared.rows) throw new Error(`Scope manifest row count differs for table ${name}.`);
      if (coverage.get(name)?.state === "partial" && declared.complete) throw new Error(`Cannot declare table ${name} complete while its export manifest count disagrees.`);
      if (coverage.get(name)?.fields === "redacted" && declared.fields === "full") throw new Error(`Cannot declare table ${name} unredacted while its export declares removed fields.`);
      coverage.set(name, { state: declared.complete ? "complete" : "partial", rows: rows.length, fields: declared.fields, basis: "Hash-bound operator table declaration; not independently checked against the deployment." });
    }
  }
  return { inputPath: root, inputIsDirectory, sha256, format, component, otherComponents: [...otherComponents].sort(), tables, coverage, scope, consistency, declaration, issues, attachments, binaryVerification, binaryFiles, limits, verifyUnchanged: async () => sha256 === await fingerprint() };
}

export function integrityScopeTemplate(input: IntegrityInput): ScopeManifest {
  return { kind: "societyer.meetingIntegrityScope", version: 1, inputSha256: input.sha256, component: input.component, consistency: input.consistency, scope: input.scope, tables: Object.fromEntries([...input.coverage].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => [name, { complete: entry.state === "complete", rows: entry.rows, fields: entry.fields }])) };
}
