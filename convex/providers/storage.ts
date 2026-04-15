// Storage adapter — RustFS (S3-compatible) when configured, demo otherwise.
// Demo mode returns a pseudo-URL and a deterministic key; the browser treats
// the file as a client-side blob for preview and never uploads.

import { providers } from "./env";

export type StorageProviderId = "rustfs" | "demo";

export type PresignedUpload = {
  provider: StorageProviderId;
  key: string;
  url: string; // presigned PUT url, or "demo://..." sentinel
  headers?: Record<string, string>;
  expiresAtISO: string;
};

export function buildStorageKey(societyId: string, documentId: string, version: number, fileName: string): string {
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
  // Live RustFS path: sign a PUT URL against s3 endpoint. Left as a clearly
  // marked stub so infra (AWS SDK / signing) doesn't need to ship in demo.
  const endpoint = (globalThis as any).process?.env?.RUSTFS_ENDPOINT ?? "";
  const bucket = (globalThis as any).process?.env?.RUSTFS_BUCKET ?? "societyer";
  return {
    provider: "rustfs",
    key: args.key,
    url: `${endpoint}/${bucket}/${encodeURIComponent(args.key)}?X-Signed=placeholder`,
    headers: args.mimeType ? { "content-type": args.mimeType } : undefined,
    expiresAtISO,
  };
}

export async function createDownloadUrl(args: {
  provider: StorageProviderId;
  key: string;
}): Promise<string> {
  if (args.provider === "demo") return `demo://download/${encodeURIComponent(args.key)}`;
  const endpoint = (globalThis as any).process?.env?.RUSTFS_ENDPOINT ?? "";
  const bucket = (globalThis as any).process?.env?.RUSTFS_BUCKET ?? "societyer";
  return `${endpoint}/${bucket}/${encodeURIComponent(args.key)}?X-Signed=placeholder`;
}
