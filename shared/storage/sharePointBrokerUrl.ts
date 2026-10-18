/** Exact application endpoints that can receive a Societyer JWT; never a Microsoft URL. */
export function isSharePointBrokerUrl(value: string, siteOrigin: string): boolean {
  try {
    const base = new URL(siteOrigin); const url = new URL(value);
    return ["https:", "http:"].includes(base.protocol) && url.origin === base.origin && !url.username && !url.password && !url.hash &&
      ["/document-storage/sharepoint/upload", "/document-storage/sharepoint/download"].includes(url.pathname);
  } catch { return false; }
}

export function sharePointDownloadBrokerUrl(siteOrigin: string, versionId: string) {
  const url = new URL("/document-storage/sharepoint/download", siteOrigin);
  url.searchParams.set("versionId", versionId); return url.href;
}
