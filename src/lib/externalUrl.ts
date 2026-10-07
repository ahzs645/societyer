/**
 * Returns the URL only when a browser can open it as an external page
 * (http/https). Stored integration links can carry placeholder schemes (the
 * demo's `demo://paperless/…`) or scripts; those must not become anchors that
 * silently navigate inside the app or run code.
 */
export function openableExternalUrl(value: unknown): string | null {
  const url = String(value ?? "").trim();
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}
