import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local") });

type Attachment = {
  source: "documents" | "documentVersions";
  id: string;
  documentId: string;
  version?: number;
  title?: string;
  category?: string;
  storageProvider?: string;
  storageId?: string;
  storageKey?: string;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  sha256?: string;
  externalUrl?: string;
  downloadUrl?: string | null;
};

type AttachmentResult = Attachment & {
  archivePath?: string;
  downloadedBytes?: number;
  downloadedSha256?: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

const api = anyApi as any;
const url = process.env.CONVEX_SELF_HOSTED_URL ?? process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
if (!url) {
  throw new Error("Set VITE_CONVEX_URL, CONVEX_SELF_HOSTED_URL, or CONVEX_URL before exporting.");
}

const client = new ConvexHttpClient(url);
const society = await findSociety();
const tables = exportTables();
const includeRecoverySecrets = process.argv.includes("--include-secrets");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputRoot = path.resolve(argValue("--out-dir") ?? "tmp/exports", `${slug(society.name)}-${stamp}`);
const attachmentsRoot = path.join(outputRoot, "attachments");
mkdirSync(attachmentsRoot, { recursive: true });

const workspace = await exportWorkspace();
const workspacePath = path.join(outputRoot, "workspace-export.json");
writeFileSync(workspacePath, JSON.stringify(workspace, null, 2));

const attachments = await listAttachments();
const attachmentResults = await downloadAttachments(attachments);
const attachmentManifest = summarizeAttachments(attachmentResults);
const attachmentManifestPath = path.join(outputRoot, "attachment-manifest.json");
writeFileSync(attachmentManifestPath, JSON.stringify(attachmentManifest, null, 2));

const zipPath = `${outputRoot}.zip`;
zipDirectory(outputRoot, zipPath);

const zipSize = statSync(zipPath).size;
console.log(
  JSON.stringify(
    {
      ok: attachmentManifest.failed === 0,
      society: society.name,
      societyId: society._id,
      outputRoot,
      zipPath,
      zipBytes: zipSize,
      zipMiB: roundMiB(zipSize),
      workspaceJsonBytes: statSync(workspacePath).size,
      workspaceJsonMiB: roundMiB(statSync(workspacePath).size),
      tableCount: workspace.manifest.tableCount,
      nonEmptyTableCount: workspace.validation.nonEmptyTableCount,
      totalRows: workspace.manifest.totalRows,
      attachments: {
        discovered: attachmentManifest.discovered,
        downloaded: attachmentManifest.downloaded,
        skipped: attachmentManifest.skipped,
        failed: attachmentManifest.failed,
        expectedBytes: attachmentManifest.expectedBytes,
        downloadedBytes: attachmentManifest.downloadedBytes,
        downloadedMiB: roundMiB(attachmentManifest.downloadedBytes),
      },
    },
    null,
    2,
  ),
);

async function findSociety() {
  const societies = await client.query(api.society.list, {});
  const id = argValue("--society-id");
  const name = argValue("--society-name") ?? "Over the Edge";
  const match = id
    ? societies.find((row: any) => row._id === id)
    : societies.find((row: any) => String(row.name).toLowerCase().includes(name.toLowerCase()));
  if (!match) throw new Error(`Society not found: ${id ?? name}`);
  return match;
}

async function exportWorkspace() {
  const exportedTables: Record<string, Array<Record<string, unknown>>> = {};
  const summaries: Array<{ name: string; rowCount: number; exportable: boolean }> = [];
  let totalRows = 0;
  for (const table of tables) {
    const rows = await fetchTableRows(table);
    exportedTables[table] = rows;
    summaries.push({ name: table, rowCount: rows.length, exportable: true });
    totalRows += rows.length;
  }

  return {
    kind: "societyer.workspaceExport",
    version: 2,
    generatedAtISO: new Date().toISOString(),
    society: exportedTables.societies?.[0] ?? society,
    manifest: {
      societyId: society._id,
      societyName: society.name,
      tableCount: tables.length,
      exportedTableCount: Object.keys(exportedTables).length,
      totalRows,
      redactedFields: includeRecoverySecrets ? ["storageId"] : ["secretEncrypted", "tokenHash", "storageId"],
      recoverySecretsIncluded: includeRecoverySecrets,
      binaryFilesIncluded: true,
      attachmentManifest: "attachment-manifest.json",
      attachmentDirectory: "attachments/",
      tables: summaries,
    },
    validation: {
      ok: true,
      version: 2,
      tableCount: tables.length,
      nonEmptyTableCount: summaries.filter((table) => table.rowCount > 0).length,
      totalRows,
      redactedFields: includeRecoverySecrets ? ["storageId"] : ["secretEncrypted", "tokenHash", "storageId"],
      recoverySecretsIncluded: includeRecoverySecrets,
      issues: [],
    },
    tables: exportedTables,
  };
}

async function fetchTableRows(table: string) {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    if (cursor) {
      if (seen.has(cursor)) throw new Error(`Repeated cursor for ${table}`);
      seen.add(cursor);
    }
    const result = await client.query(api.exports.exportTablePage, {
      societyId: society._id,
      table,
      includeRecoverySecrets,
      paginationOpts: { cursor, numItems: pageSizeFor(table) },
    });
    rows.push(...((result.page ?? []) as Array<Record<string, unknown>>));
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return rows;
}

async function listAttachments() {
  const rows: Attachment[] = [];
  for (const source of ["documentVersions", "documents"] as const) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      if (cursor) {
        if (seen.has(cursor)) throw new Error(`Repeated cursor for ${source} attachments`);
        seen.add(cursor);
      }
      const result = await client.query(api.exports.exportAttachmentPage, {
        societyId: society._id,
        source,
        paginationOpts: { cursor, numItems: source === "documents" ? 100 : 100 },
      });
      rows.push(...((result.page ?? []) as Attachment[]));
      cursor = result.isDone ? null : result.continueCursor;
    } while (cursor);
  }
  return rows;
}

async function downloadAttachments(attachments: Attachment[]) {
  const results: AttachmentResult[] = [];
  const seenPaths = new Map<string, number>();
  for (const attachment of attachments) {
    if (!attachment.downloadUrl || attachment.downloadUrl.startsWith("demo://")) {
      results.push({ ...attachment, ok: false, skipped: true, error: "No downloadable stored file URL." });
      continue;
    }
    if (attachment.storageProvider === "externalUrl") {
      results.push({ ...attachment, ok: false, skipped: true, error: "External URL reference only." });
      continue;
    }

    const relativePath = uniquePath(
      seenPaths,
      path.posix.join(
        attachment.source,
        sanitizePathPart(attachment.documentId),
        sanitizeFileName(attachment.fileName ?? attachment.title ?? attachment.id),
      ),
    );
    const outputPath = path.join(attachmentsRoot, relativePath);
    mkdirSync(path.dirname(outputPath), { recursive: true });

    try {
      const response = await fetch(attachment.downloadUrl);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      await pipeline(response.body as any, createWriteStream(outputPath));
      const bytes = statSync(outputPath).size;
      results.push({
        ...attachment,
        archivePath: path.posix.join("attachments", relativePath),
        downloadedBytes: bytes,
        downloadedSha256: sha256File(outputPath),
        ok: true,
      });
    } catch (error) {
      results.push({
        ...attachment,
        archivePath: path.posix.join("attachments", relativePath),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

function summarizeAttachments(results: AttachmentResult[]) {
  const downloaded = results.filter((row) => row.ok);
  const skipped = results.filter((row) => row.skipped);
  const failed = results.filter((row) => !row.ok && !row.skipped);
  return {
    societyId: society._id,
    societyName: society.name,
    generatedAtISO: new Date().toISOString(),
    discovered: results.length,
    downloaded: downloaded.length,
    skipped: skipped.length,
    failed: failed.length,
    expectedBytes: results.reduce((sum, row) => sum + (Number(row.fileSizeBytes) || 0), 0),
    downloadedBytes: downloaded.reduce((sum, row) => sum + (Number(row.downloadedBytes) || 0), 0),
    files: results,
  };
}

function zipDirectory(directory: string, zipPath: string) {
  if (existsSync(zipPath)) {
    throw new Error(`Refusing to overwrite existing zip: ${zipPath}`);
  }
  const result = spawnSync("zip", ["-qr", zipPath, path.basename(directory)], {
    cwd: path.dirname(directory),
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`zip failed: ${result.stderr || result.stdout}`);
  }
}

function exportTables() {
  const source = readFileSync(path.join(process.cwd(), "convex/exports.ts"), "utf8");
  const match = source.match(/export const EXPORTABLE_TABLES = \[([\s\S]*?)\] as const;/);
  if (!match) throw new Error("Could not find EXPORTABLE_TABLES in convex/exports.ts.");
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function pageSizeFor(table: string) {
  return table === "documents" || table === "sourceEvidence" ? 25 : 100;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
}

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "record";
}

function sanitizeFileName(value: string) {
  const cleaned = value.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  return (cleaned || "attachment").slice(0, 180);
}

function uniquePath(seen: Map<string, number>, value: string) {
  const parsed = path.posix.parse(value);
  const current = seen.get(value) ?? 0;
  seen.set(value, current + 1);
  if (current === 0) return value;
  return path.posix.join(parsed.dir, `${parsed.name}-${current + 1}${parsed.ext}`);
}

function sha256File(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function roundMiB(bytes: number) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}
