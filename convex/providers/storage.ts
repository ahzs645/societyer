// Storage adapter — RustFS (S3-compatible) when configured, demo otherwise.
// Demo mode returns a pseudo-URL and a deterministic key; the browser treats
// the file as a client-side blob for preview and never uploads.
//
// The SigV4 presigning + download-URL resolution lives in the portable
// shared/storage/signedUrl module (no Convex deps) so shared/functions handlers
// can resolve document download URLs too; re-exported here for existing callers.

import { providers } from "./env";
import { MAX_DOCUMENT_UPLOAD_BYTES, verifyUploadBytes } from "../../shared/storage/uploadVerification";
import {
  createDownloadUrl,
  presignUrl,
  type StorageProviderId,
} from "../../shared/storage/signedUrl";

export { createDownloadUrl };
export type { StorageProviderId };

export type PresignedUpload = {
  provider: StorageProviderId;
  key: string;
  url: string; // presigned PUT url, or "demo://..." sentinel
  headers?: Record<string, string>;
  expiresAtISO: string;
};

export function buildStorageKey(
  societyId: string,
  documentId: string,
  version: number,
  fileName: string,
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `societies/${societyId}/documents/${documentId}/v${version}-${safe}`;
}

export function buildUploadStorageKey(
  societyId: string,
  documentId: string,
  uploadId: string,
  fileName: string,
): string {
  const safeUploadId = uploadId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `societies/${societyId}/documents/${documentId}/uploads/${safeUploadId}-${safeFileName}`;
}

export async function createUploadUrl(args: {
  key: string;
  mimeType?: string;
}): Promise<PresignedUpload> {
  const p = providers.storage();
  const expiresAtISO = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  if (p.id === "demo") {
    return {
      provider: "demo",
      key: args.key,
      url: `demo://upload/${encodeURIComponent(args.key)}`,
      expiresAtISO,
    };
  }
  return {
    provider: p.id,
    key: args.key,
    url: await presignUrl({ provider: p.id, method: "PUT", key: args.key, expiresSeconds: 900 }),
    headers: args.mimeType ? { "content-type": args.mimeType } : undefined,
    expiresAtISO,
  };
}

/** Copy checked staging bytes into a key for which no client receives a PUT URL. */
export async function verifyAndSealUpload(args: { provider: "rustfs" | "r2"; stagingKey: string; storageKey: string; fileSizeBytes: number; mimeType?: string }) {
  const source = await fetch(await presignUrl({ provider: args.provider, method: "GET", key: args.stagingKey, expiresSeconds: 60 }), { signal: AbortSignal.timeout(30000) });
  if (!source.ok || !source.body) throw new Error("Uploaded object could not be verified.");
  const declaredSize = source.headers.get("content-length");
  if (declaredSize !== null && Number(declaredSize) !== args.fileSizeBytes) throw new Error("Uploaded object size does not match the authorized upload.");
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > args.fileSizeBytes || length > MAX_DOCUMENT_UPLOAD_BYTES) {
      await reader.cancel();
      throw new Error("Uploaded object exceeds the authorized size.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const sha256 = await verifyUploadBytes(bytes.buffer, args.fileSizeBytes);
  const sealed = await fetch(await presignUrl({ provider: args.provider, method: "PUT", key: args.storageKey, expiresSeconds: 60 }), {
    method: "PUT", headers: { "content-type": args.mimeType || "application/octet-stream" }, body: bytes, signal: AbortSignal.timeout(30000),
  });
  if (!sealed.ok) throw new Error("Verified document could not be stored.");
  return { sha256, fileSizeBytes: length };
}
