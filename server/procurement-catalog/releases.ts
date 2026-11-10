import { mkdirSync, lstatSync, existsSync, readFileSync, writeFileSync, renameSync, symlinkSync, realpathSync, rmSync, chmodSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { openCatalog, readRows, sqliteSelfTest, verifyCatalog, type CatalogRow } from "./database";
import { safeIdentifier } from "./grants";
import { browserListRow } from "./model";
import { buildDefaultSummaries } from "../../shared/procurementAnalyticsArtifacts";
import type { ListRow, CatalogReviewRow } from "../../src/features/procurementReview/reader/source";

export type ActivationRequest = { societyId: string; publicationId: string; inventoryHash: string; bytesReceived: number };
export type ActivationReceipt = ActivationRequest & { schemaVersion: 1; generation: string; folder: string; sourceSnapshotId: string; contentHash: string; activatedAt: string; publishedAt: string; counts: Record<string, number>; listBytes: Record<string, number>; databaseBytes: number };
export function releasePath(root: string, societyId: string, publicationId: string) {
  return join(resolve(root), "releases", safeIdentifier(societyId), safeIdentifier(publicationId));
}
export function currentPath(root: string, societyId: string): string | null {
  return pointerPath(root, societyId, "current");
}
export function previousPath(root: string, societyId: string): string | null {
  return pointerPath(root, societyId, "previous");
}
function pointerPath(root: string, societyId: string, name: string): string | null {
  const link = join(resolve(root), name, safeIdentifier(societyId));
  if (!existsSync(link)) return null;
  const path = realpathSync(link), parent = join(resolve(root), "releases", societyId) + "/";
  if (!path.startsWith(parent) || dirname(path) + "/" !== parent) throw new Error("Current catalog pointer left its workspace.");
  return path;
}
function verifiedFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 ** 3) throw new Error("Catalog must be a regular bounded file.");
  return stat;
}
/** Runs in an activation worker, leaving the serving process responsive. */
export function prepareRelease(root: string, request: ActivationRequest): { directory: string; receipt: ActivationReceipt } {
  sqliteSelfTest(); safeIdentifier(request.societyId); safeIdentifier(request.publicationId);
  if (!/^[a-f0-9]{64}$/.test(request.inventoryHash) || !Number.isSafeInteger(request.bytesReceived) || request.bytesReceived < 0) throw new Error("Invalid activation receipt request.");
  const destination = releasePath(root, request.societyId, request.publicationId);
  if (existsSync(destination)) {
    const receipt = JSON.parse(readFileSync(join(destination, "receipt.json"), "utf8")) as ActivationReceipt;
    if (receipt.societyId !== request.societyId || receipt.publicationId !== request.publicationId || receipt.inventoryHash !== request.inventoryHash) throw new Error("A publication ID cannot be reused for different content.");
    const prior = openCatalog(join(destination, "catalog.sqlite"));
    try { if (verifyCatalog(prior).inventoryHash !== request.inventoryHash) throw new Error("Existing release integrity mismatch."); }
    finally { prior.close(); }
    return { directory: destination, receipt };
  }
  const staging = join(resolve(root), "staging", request.societyId, "catalog.sqlite"); verifiedFile(staging);
  const source = openCatalog(staging), temporary = destination + ".preparing-" + randomUUID();
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const check = (meta: CatalogRow) => {
    if (meta.societyId !== request.societyId || (meta.publicationId ?? meta.generation) !== request.publicationId || meta.inventoryHash !== request.inventoryHash) throw new Error("Staging file differs from the approved publication.");
  };
  try {
    try {
      check(verifyCatalog(source));
      source.prepare("VACUUM INTO ?").run(join(temporary, "catalog.sqlite"));
    } finally { source.close(); }
    const database = join(temporary, "catalog.sqlite"); chmodSync(database, 0o600);
    const db = openCatalog(database);
    let receipt: ActivationReceipt;
    try {
      const meta = verifyCatalog(db); check(meta);
      const full = readRows(db, "procurementRecords");
      const records = full.map(row => browserListRow(row));
      const listBytes: Record<string, number> = {}, counts: Record<string, number> = {};
      for (const kind of ["opportunity", "award"]) {
        const selected = records.filter(row => row.kind === kind), bytes = gzipSync(JSON.stringify(selected), { level: 6 });
        writeFileSync(join(temporary, `list-${kind}.json.gz`), bytes, { mode: 0o600 }); counts[kind] = selected.length; listBytes[kind] = bytes.length;
      }
      const analyticsRows = full.map(row => ({ ...browserListRow(row), ...(row.analyticsJson ? { analyticsJson: row.analyticsJson } : {}) })) as ListRow[];
      const evidence = readRows(db, "procurementEvidence").map(row => ({ recordKey: row.recordKey, source: row.source, dataJson: row.dataJson })) as CatalogReviewRow[];
      const summaries = buildDefaultSummaries(analyticsRows, evidence, Date.now(), true);
      writeFileSync(join(temporary, "summaries.json"), JSON.stringify(summaries), { mode: 0o600 });
      receipt = { ...request, schemaVersion: 1, generation: meta.generation, folder: meta.folder, sourceSnapshotId: meta.sourceSnapshotId, contentHash: meta.contentHash, publishedAt: meta.publishedAt, activatedAt: new Date().toISOString(), counts, listBytes, databaseBytes: verifiedFile(database).size };
      writeFileSync(join(temporary, "receipt.json"), JSON.stringify(receipt) + "\n", { mode: 0o600 });
    } finally { db.close(); }
    // rename is atomic on the same volume; no current pointer changes in this worker.
    renameSync(temporary, destination);
    return { directory: destination, receipt };
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
}
export function switchCurrent(root: string, receipt: ActivationReceipt) {
  const current = currentPath(root, receipt.societyId);
  if (current) {
    const prior = JSON.parse(readFileSync(join(current, "receipt.json"), "utf8")) as ActivationReceipt;
    if (prior.publicationId !== receipt.publicationId && Date.parse(prior.publishedAt) > Date.parse(receipt.publishedAt)) throw new Error("An older publication cannot replace the serving catalog.");
  }
  const parent = join(resolve(root), "current"); mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (current && current !== releasePath(root, receipt.societyId, receipt.publicationId)) {
    const previous = join(resolve(root), "previous"); mkdirSync(previous, { recursive: true, mode: 0o700 });
    const nextPrevious = join(previous, ".next-" + randomUUID()); symlinkSync(current, nextPrevious);
    try { renameSync(nextPrevious, join(previous, receipt.societyId)); } finally { if (existsSync(nextPrevious)) rmSync(nextPrevious); }
  }
  const temporary = join(parent, ".next-" + randomUUID());
  symlinkSync(releasePath(root, receipt.societyId, receipt.publicationId), temporary);
  try { renameSync(temporary, join(parent, receipt.societyId)); } finally { if (existsSync(temporary)) rmSync(temporary); }
}
