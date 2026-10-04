import { authenticatedFetch } from "./authToken";

/** Only our generated-file endpoint may receive the signed-in session token. */
export function isAuthenticatedDocumentUrl(value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(value, window.location.origin);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === window.location.origin &&
      !url.username && !url.password &&
      url.pathname.startsWith("/api/v1/workflow-generated-documents/");
  } catch {
    return false;
  }
}

export function fetchDocumentDownload(url: string, init: RequestInit = {}) {
  if (isAuthenticatedDocumentUrl(url)) {
    // The file endpoint returns bytes directly; do not forward a token through redirects.
    return authenticatedFetch(url, { ...init, redirect: "error" });
  }
  return fetch(url, init);
}
