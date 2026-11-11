import { createBlobReader, type BlobReader } from "./blobs";
import { snapshotFilePaths } from "../../../../shared/procurementReview/manifest";
import { concatBytes, sha256Hex } from "./digest";

export type StoredProcurementDocument = {
  documentKey: string; name: string; mediaType: string; sha256: string;
  bytes: number; parts: number; available: boolean; sourceUrl?: string;
};

/**
 * Fetch only the selected document, through authenticated workspace access,
 * then verify it. A verified file is kept for the life of the tab (see
 * `cachedDocument`), so opening its preview again, or downloading the file
 * being previewed, doesn't read it from SharePoint a second time.
 */
export async function readProcurementDocument(societyId: string, document: StoredProcurementDocument, signal?: AbortSignal): Promise<ArrayBuffer> {
  return cachedDocument(`${societyId}:${document.sha256}`, () => createBlobReader(societyId), document, signal);
}

/** The same, through any snapshot reader (the no-login demo reads its bundled snapshot). */
export async function readVerifiedDocument(read: BlobReader, document: StoredProcurementDocument, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!document.available) throw new Error("This document has not been published.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const path of snapshotFilePaths(document.sha256, document)) {
    signal?.throwIfAborted();
    const bytes = await read(path, signal);
    if (!bytes) throw new Error("The published file is missing. Please ask the publisher to republish it.");
    total += bytes.length;
    if (total > document.bytes) throw new Error("The file exceeds its published size.");
    chunks.push(bytes);
  }
  signal?.throwIfAborted();
  const bytes = concatBytes(chunks);
  if (bytes.length !== document.bytes || await sha256Hex(bytes) !== document.sha256) throw new Error("The file failed its integrity check.");
  return bytes.buffer as ArrayBuffer;
}

/** Verified bytes kept in memory, least recently used dropped first. */
export const DOCUMENT_CACHE_BYTES = 64 * 1024 * 1024;

type Entry = {
  /** Settles with the verified bytes; never rejects into the cache (a failure removes the entry). */
  load: Promise<ArrayBuffer>;
  controller: AbortController;
  /** Callers still waiting for an unsettled load. When the last one gives up, the read is cancelled. */
  waiting: number;
  /** Set once verified. */
  bytes?: number;
};
const entries = new Map<string, Entry>();
let cachedBytes = 0;

function evict() {
  for (const [key, entry] of entries) {
    if (cachedBytes <= DOCUMENT_CACHE_BYTES) return;
    if (entry.bytes === undefined) continue;
    entries.delete(key);
    cachedBytes -= entry.bytes;
  }
}

function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * A published file is named by its SHA-256 and checked against it, so a copy
 * kept here can't go stale. Concurrent callers share one read; each gets its
 * own copy of the bytes (a viewer may transfer, and so detach, the buffer it
 * is given). Exported for the checks in scripts/check-procurement-documents.ts.
 */
export async function cachedDocument(key: string, reader: () => BlobReader, document: StoredProcurementDocument, signal?: AbortSignal): Promise<ArrayBuffer> {
  signal?.throwIfAborted();
  let entry = entries.get(key);
  if (entry?.bytes !== undefined) {
    // Most recently used goes last.
    entries.delete(key);
    entries.set(key, entry);
  } else if (!entry) {
    const controller = new AbortController();
    const created: Entry = { controller, waiting: 0, load: Promise.resolve(new ArrayBuffer(0)) };
    created.load = readVerifiedDocument(reader(), document, controller.signal).then(
      (bytes) => {
        if (entries.get(key) !== created) return bytes;
        if (bytes.byteLength > DOCUMENT_CACHE_BYTES / 2) entries.delete(key);
        else { created.bytes = bytes.byteLength; cachedBytes += bytes.byteLength; evict(); }
        return bytes;
      },
      (error: unknown) => {
        if (entries.get(key) === created) entries.delete(key);
        throw error;
      },
    );
    // Rejections are handled by each waiting caller; don't report them twice.
    created.load.catch(() => {});
    entries.set(key, created);
    entry = created;
  }
  const current = entry;
  current.waiting++;
  try {
    const bytes = await untilAborted(current.load, signal);
    return bytes.slice(0);
  } finally {
    current.waiting--;
    if (current.waiting === 0 && current.bytes === undefined && entries.get(key) === current) {
      // Nobody wants an unfinished read any more (the preview closed): stop it rather than finish it in the background.
      entries.delete(key);
      current.controller.abort();
    }
  }
}

/** Empties the cache (tests). */
export function clearDocumentCache() {
  entries.clear();
  cachedBytes = 0;
}
