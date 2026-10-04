/** Implementation capabilities, not evidence that a deployment is connected. */
export const DOCUMENT_STORAGE_CAPABILITIES = [
  { provider: "local-filesystem", label: "Local filesystem", implemented: true, upload: true, download: true, checksum: true, immutableVersions: true, operatorManaged: false, requirement: "Requires the Electron desktop bridge and its local workspace." },
  { provider: "rustfs", label: "RustFS / S3 compatible", implemented: true, upload: true, download: true, checksum: true, immutableVersions: true, operatorManaged: true, requirement: "Requires deployment endpoint, bucket, credentials, CORS and a successful upload/download probe." },
  { provider: "r2", label: "Cloudflare R2", implemented: true, upload: true, download: true, checksum: true, immutableVersions: true, operatorManaged: true, requirement: "Requires deployment endpoint or account ID, bucket, scoped S3 credentials, CORS and a successful upload/download probe." },
  { provider: "sharepoint", label: "Microsoft SharePoint", implemented: false, upload: false, download: false, checksum: false, immutableVersions: false, operatorManaged: true, requirement: "Server adapter primitives are implemented; deployment wiring, credentials, consent/resource grants and live verification are required; version retention must be verified." },
] as const;

export type DocumentStorageCapability = typeof DOCUMENT_STORAGE_CAPABILITIES[number];
