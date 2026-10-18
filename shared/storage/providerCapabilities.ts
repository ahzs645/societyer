/** Implementation capabilities, not evidence that a deployment is connected. */
export const DOCUMENT_STORAGE_CAPABILITIES = [
  { provider: "local-filesystem", label: "Local filesystem", implemented: true, upload: true, download: true, checksum: true, immutableVersions: true, operatorManaged: false, requirement: "Requires the Electron desktop bridge and its local workspace." },
  { provider: "rustfs", label: "RustFS / S3 compatible", implemented: true, upload: true, download: true, checksum: true, immutableVersions: true, operatorManaged: true, requirement: "Requires deployment endpoint, bucket, credentials, CORS and a successful upload/download probe." },
  { provider: "r2", label: "Cloudflare R2", implemented: true, upload: true, download: true, checksum: true, immutableVersions: true, operatorManaged: true, requirement: "Requires deployment endpoint or account ID, bucket, scoped S3 credentials, CORS and a successful upload/download probe." },
  { provider: "sharepoint", label: "Microsoft SharePoint", implemented: true, upload: true, download: true, checksum: true, immutableVersions: true, operatorManaged: true, requirement: "Requires application Sites.Selected consent, a private selected-site write grant, server credentials and pinned resource/transfer hosts. Authenticated transfers are limited to 8 MiB. Live qualification and retention/restore verification are separate." },
] as const;

export type DocumentStorageCapability = typeof DOCUMENT_STORAGE_CAPABILITIES[number];
