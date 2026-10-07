/**
 * ID-03: exact-duplicate grouping for Drive staging.
 *
 * Grouping by SHA-256 must never treat empty or failed downloads as copies of
 * each other: every zero-byte file hashes to the same empty-content digest,
 * which collapsed five unrelated PGAIR files into one candidate.
 */

export const EMPTY_CONTENT_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function isUsableContentHash(sha256: unknown, bytes?: unknown): boolean {
  const hash = String(sha256 ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  if (hash === EMPTY_CONTENT_SHA256) return false;
  if (bytes !== undefined && bytes !== null && Number(bytes) === 0) return false;
  return true;
}

/** Group key: the content hash when it identifies real content, else the file id. */
export function dedupeKeyForDriveItem(item: { sha256?: unknown; bytes?: unknown; id?: unknown; textStatus?: unknown }): string {
  const failed = typeof item.textStatus === "string" && /^(?:download_failed|failed|error|missing)$/i.test(item.textStatus);
  return !failed && isUsableContentHash(item.sha256, item.bytes) ? String(item.sha256).toLowerCase() : `id:${String(item.id ?? "")}`;
}
