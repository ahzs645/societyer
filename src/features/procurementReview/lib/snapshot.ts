/**
 * Loads a published snapshot (contract §3, reader rules): the manifest, then
 * every catalog part checked against its sha256, gunzipped, and the whole
 * catalog checked against the manifest before anything opens it. A verified
 * catalog is cached on this device per snapshot so reloads don't refetch it.
 */
import { parseSnapshotManifest, snapshotFilePaths, SnapshotFormatError, type SnapshotManifest } from "../../../../shared/procurementReview/manifest";
import type { BlobReader } from "./blobs";
import { concatBytes, sha256Hex } from "./digest";

export type SnapshotProgress = { stage: "manifest" | "download" | "decompress" | "open"; done: number; total: number };

/** Bytes that don't match what the manifest promises. Never opened or cached. */
export class SnapshotIntegrityError extends Error {}

export type CatalogCache = {
  get(snapshotId: string): Promise<Uint8Array | null>;
  put(snapshotId: string, bytes: Uint8Array): Promise<void>;
};

/** The current manifest, or null when nothing has been published to the folder yet. */
export async function fetchSnapshotManifest(read: BlobReader): Promise<SnapshotManifest | null> {
  const bytes = await read("manifest.json");
  if (!bytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SnapshotFormatError("The snapshot manifest isn't valid JSON.");
  }
  return parseSnapshotManifest(value);
}

const PARALLEL_PARTS = 3;

async function mapInOrder<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function gunzip(compressed: Uint8Array, expectedBytes: number): Promise<Uint8Array> {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedBytes) {
        await reader.cancel();
        throw new SnapshotIntegrityError("The catalog is larger than its manifest says.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SnapshotIntegrityError) throw error;
    throw new SnapshotIntegrityError("The catalog parts don't form a valid gzip stream.");
  }
  return concatBytes(chunks);
}

async function verifiedCatalog(manifest: SnapshotManifest, bytes: Uint8Array): Promise<boolean> {
  return bytes.byteLength === manifest.catalog.bytes && (await sha256Hex(bytes)) === manifest.catalog.sha256;
}

/** The verified, uncompressed catalog.sqlite for this manifest. */
export async function loadSnapshotCatalog(
  manifest: SnapshotManifest,
  read: BlobReader,
  options: { cache?: CatalogCache; onProgress?: (progress: SnapshotProgress) => void } = {},
): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
  const { cache, onProgress } = options;
  const cached = await cache?.get(manifest.snapshotId).catch(() => null);
  // A cached copy is rechecked: browser storage is not a trust boundary we control.
  if (cached && await verifiedCatalog(manifest, cached)) return { bytes: cached, fromCache: true };

  const parts = manifest.catalog.parts;
  const total = parts.reduce((sum, part) => sum + part.bytes, 0);
  let done = 0;
  onProgress?.({ stage: "download", done, total });
  const chunks = await mapInOrder(parts, PARALLEL_PARTS, async (part, index) => {
    const bytes = await read(part.path);
    if (!bytes) throw new SnapshotIntegrityError(`Catalog part ${index + 1} of ${parts.length} is missing from the folder. The publisher may still be uploading; refresh in a minute.`);
    if (bytes.byteLength !== part.bytes || (await sha256Hex(bytes)) !== part.sha256) throw new SnapshotIntegrityError(`Catalog part ${index + 1} of ${parts.length} doesn't match its checksum.`);
    done += bytes.byteLength;
    onProgress?.({ stage: "download", done, total });
    return bytes;
  });

  onProgress?.({ stage: "decompress", done: 0, total: manifest.catalog.bytes });
  const catalog = await gunzip(concatBytes(chunks), manifest.catalog.bytes);
  if (!(await verifiedCatalog(manifest, catalog))) throw new SnapshotIntegrityError("The assembled catalog doesn't match the manifest checksum.");
  onProgress?.({ stage: "decompress", done: manifest.catalog.bytes, total: manifest.catalog.bytes });
  await cache?.put(manifest.snapshotId, catalog).catch(() => undefined);
  return { bytes: catalog, fromCache: false };
}

/** One document blob, assembled from its parts and checked against its content address. */
export async function readSnapshotDocument(manifest: SnapshotManifest, read: BlobReader, sha256: string): Promise<Uint8Array> {
  const file = manifest.files[sha256];
  if (!file) throw new Error("This document isn't in the published snapshot.");
  const chunks: Uint8Array[] = [];
  for (const path of snapshotFilePaths(sha256, file)) {
    const bytes = await read(path);
    if (!bytes) throw new Error("This document is missing from the published folder.");
    chunks.push(bytes);
  }
  const bytes = concatBytes(chunks);
  if (bytes.byteLength !== file.bytes || (await sha256Hex(bytes)) !== sha256) throw new SnapshotIntegrityError("Stored document failed its integrity check.");
  return bytes;
}
