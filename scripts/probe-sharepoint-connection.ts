/** Operator qualification. Run with a private --env-file; no tokens or credential values are printed. */
import assert from "node:assert/strict";
import { createDeploymentSharePointAdapter, createSharePointTokenSupplier, sharePointDeployment } from "../shared/storage/sharePointDeployment";
import { verifyUploadBytes } from "../shared/storage/uploadVerification";
import { validateTransferUrl } from "../shared/storage/meetingSourceProtocol";
import { meetingSourceDownloadUrl } from "../shared/storage/meetingSourceGraph";

const connection = sharePointDeployment(process.env);
// Report only hostnames, never Microsoft's bearer transfer URLs or token values.
const probeFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (requestUrl.origin === "https://graph.microsoft.com") {
    const location = response.headers.get("Location");
    if (location && requestUrl.pathname.endsWith("/content") && [301, 302, 303, 307, 308].includes(response.status)) console.log(JSON.stringify({ transfer: "download", hostname: new URL(location).hostname }));
    if (requestUrl.pathname.endsWith("/createUploadSession") && response.ok) {
      const metadata = await response.clone().json() as { uploadUrl?: string };
      if (metadata.uploadUrl) console.log(JSON.stringify({ transfer: "upload-session", hostname: new URL(metadata.uploadUrl).hostname }));
    }
  }
  if (connection.transferHosts.includes(requestUrl.hostname) && init?.method === "PUT" && response.status !== 202) {
    const metadata = await response.clone().json().catch(() => null) as { nextExpectedRanges?: string[]; id?: string; size?: number; parentReference?: { driveId?: string }; error?: { code?: string } } | null;
    console.log(JSON.stringify({ chunkStatus: response.status, nextExpectedRanges: metadata?.nextExpectedRanges, hasItemId: Boolean(metadata?.id), sizeBytes: metadata?.size, driveId: metadata?.parentReference?.driveId, errorCode: metadata?.error?.code }));
  }
  return response;
};
const adapter = createDeploymentSharePointAdapter(process.env, probeFetch);
await adapter.verifyResource();
console.log("Approved tenant/site/library binding verified.");
if (process.argv.includes("--write-probe") || process.argv.includes("--chunked-write-probe") || process.argv.includes("--version-range-probe")) {
  const chunked = process.argv.includes("--chunked-write-probe") || process.argv.includes("--version-range-probe");
  const filename = `societyer-connection-probe-${crypto.randomUUID()}.${chunked ? "bin" : "txt"}`;
  const bytes = chunked ? new Uint8Array(5 * 1024 * 1024).fill(83) : new TextEncoder().encode(`Societyer synthetic connection check\n${new Date().toISOString()}\n`);
  const expected = await verifyUploadBytes(bytes.buffer as ArrayBuffer, bytes.byteLength);
  const item = await adapter.upload(filename, bytes, { mimeType: chunked ? "application/octet-stream" : "text/plain" });
  const downloaded = await adapter.download(item.locator);
  assert.equal(await verifyUploadBytes(downloaded.buffer as ArrayBuffer, bytes.byteLength), expected);
  if (process.argv.includes("--version-range-probe")) {
    const token = await createSharePointTokenSupplier(process.env)({ tenantId: connection.tenantId, authorizationMode: "application", audience: "https://graph.microsoft.com" });
    const base = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(item.locator.itemId)}`;
    const versions = await fetch(`${base}/versions?$top=1`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error" });
    assert.ok(versions.ok, `Version list status ${versions.status}`); const versionData = await versions.json(); const version = versionData.value?.[0];
    console.log(JSON.stringify({ versionListStatus: versions.status, versionCount: versionData.value?.length, versionId: version?.id, versionSize: version?.size }));
    assert.ok(version?.id, "Version list has no current version"); assert.equal(version.size, bytes.length);
    const downloadUrl = validateTransferUrl(await meetingSourceDownloadUrl(process.env, { itemId: item.locator.itemId, versionId: version.id, eTag: item.eTag, size: item.sizeBytes }), connection.transferHosts);
    const range = await fetch(downloadUrl, { headers: { Range: `bytes=0-${bytes.length - 1}` }, redirect: "error" });
    console.log(JSON.stringify({ rangeStatus: range.status, contentRange: range.headers.get("content-range") }));
    assert.equal(range.status, 206); assert.equal(range.headers.get("content-range"), `bytes 0-${bytes.length - 1}/${bytes.length}`);
    assert.equal(await verifyUploadBytes(await range.arrayBuffer(), bytes.length), expected);
    console.log(JSON.stringify({ status: "pinned-version-range-checksum-passed", versionId: version.id, sizeBytes: bytes.length, hostname: new URL(downloadUrl).hostname }));
  }
  console.log(JSON.stringify({ status: "upload-download-checksum-passed", filename, itemId: item.locator.itemId, sizeBytes: item.sizeBytes, sha256: expected, retainedForAudit: true }));
  // Deliberately retain the synthetic item. No permanent deletion or existing-file edits.
}
if (process.argv.includes("--check-unapproved-site")) {
  const token = await createSharePointTokenSupplier(process.env)({ tenantId: connection.tenantId, authorizationMode: "application", audience: "https://graph.microsoft.com" });
  const response = await fetch("https://graph.microsoft.com/v1.0/sites/1stform.sharepoint.com:/sites/ddcNorth?$select=id", { headers: { Authorization: `Bearer ${token}` }, redirect: "error" });
  await response.body?.cancel();
  assert.equal(response.status, 403, "The runtime app must not access the unapproved DDC North collaboration site.");
  console.log(JSON.stringify({ status: "unapproved-site-denied", httpStatus: response.status }));
}
console.log(JSON.stringify({ tenantId: connection.tenantId, siteId: connection.siteId, driveId: connection.driveId, maxFileBytes: connection.maxFileBytes }));
