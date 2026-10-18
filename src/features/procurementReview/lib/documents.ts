import { createBlobReader, type BlobReader } from "./blobs";
import { snapshotFilePaths } from "../../../../shared/procurementReview/manifest";
import { concatBytes, sha256Hex } from "./digest";

export type StoredProcurementDocument = {
  documentKey: string; name: string; mediaType: string; sha256: string;
  bytes: number; parts: number; available: boolean;
};
/** Fetch only the selected document, through authenticated workspace access, then verify it. */
export async function readProcurementDocument(societyId: string, document: StoredProcurementDocument, signal?: AbortSignal): Promise<ArrayBuffer> {
  return readVerifiedDocument(createBlobReader(societyId), document, signal);
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
