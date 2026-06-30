// Storage adapter — RustFS (S3-compatible) when configured, demo otherwise.
// Demo mode returns a pseudo-URL and a deterministic key; the browser treats
// the file as a client-side blob for preview and never uploads.
//
// The SigV4 presigning + download-URL resolution lives in the portable
// shared/storage/signedUrl module (no Convex deps) so shared/functions handlers
// can resolve document download URLs too; re-exported here for existing callers.

import { providers } from "./env";
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
    provider: "rustfs",
    key: args.key,
    url: await presignUrl({ method: "PUT", key: args.key, expiresSeconds: 900 }),
    headers: args.mimeType ? { "content-type": args.mimeType } : undefined,
    expiresAtISO,
  };
}
