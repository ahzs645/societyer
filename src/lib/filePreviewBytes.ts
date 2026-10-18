/** In-memory previews stay bounded on phones, independently of upload limits. */
export const MAX_FILE_PREVIEW_BYTES = 25 * 1024 * 1024;

export function assertPreviewSize(size: number) {
  if (size > MAX_FILE_PREVIEW_BYTES) throw new Error("Inline preview supports files up to 25 MB. Download the original instead.");
}

/** Enforce the limit while reading, including missing/incorrect Content-Length. */
export async function readPreviewResponse(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  if (!response.ok) throw new Error(`Couldn't load the file (HTTP ${response.status}).`);
  const reader = response.body?.getReader();
  try {
    assertPreviewSize(Number(response.headers.get("content-length")) || 0);
    if (!reader) return new ArrayBuffer(0);
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      signal.throwIfAborted();
      size += part.value.byteLength;
      assertPreviewSize(size);
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes.buffer;
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

export async function verifyPreviewBytes(bytes: ArrayBuffer, sha256?: string, size?: number) {
  assertPreviewSize(bytes.byteLength);
  if (size !== undefined && size !== bytes.byteLength) throw new Error("The stored file size does not match its metadata.");
  if (sha256) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== sha256.toLowerCase()) throw new Error("The stored file did not pass its integrity check.");
  }
  return bytes;
}
