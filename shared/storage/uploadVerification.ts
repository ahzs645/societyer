/** Bound metadata checks are shared by upload initialization and finalization. */
export const MAX_DOCUMENT_UPLOAD_BYTES = 32 * 1024 * 1024;

export function validateUploadMetadata(args: { fileName: string; fileSizeBytes?: number; mimeType?: string }) {
  if (!args.fileName.trim() || args.fileName.length > 255 || /[\x00-\x1f]/.test(args.fileName)) throw new Error("A valid file name is required.");
  if (!Number.isSafeInteger(args.fileSizeBytes) || args.fileSizeBytes! < 0 || args.fileSizeBytes! > MAX_DOCUMENT_UPLOAD_BYTES) throw new Error("Document uploads require a known size of at most 32 MiB.");
  if (args.mimeType && (args.mimeType.length > 255 || /[\r\n]/.test(args.mimeType))) throw new Error("Invalid document MIME type.");
}

export function validateUploadHandle(handle: any, args: { societyId: string; documentId: string; actorUserId: string }, requiredStatus: string, now = Date.now()) {
  if (!handle || String(handle.societyId) !== String(args.societyId) || String(handle.documentId) !== String(args.documentId) || String(handle.actorUserId) !== String(args.actorUserId) || handle.status !== requiredStatus || !(Date.parse(handle.expiresAtISO) > now)) throw new Error("Upload handle is invalid, expired or already used.");
}

export async function verifyUploadBytes(bytes: ArrayBuffer, expectedSize: number) {
  if (bytes.byteLength !== expectedSize || bytes.byteLength > MAX_DOCUMENT_UPLOAD_BYTES) throw new Error("Uploaded object size does not match the authorized upload.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
