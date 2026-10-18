import assert from "node:assert/strict";
import { createServer } from "vite";
import { hasPdfSignature, hasZipSignature, hasOleSignature, imageMimeType, mediaMimeType } from "../src/lib/filePreviewSignatures";
import { MAX_FILE_PREVIEW_BYTES, readPreviewResponse, verifyPreviewBytes } from "../src/lib/filePreviewBytes";
const buffer = (text: string) => new TextEncoder().encode(text).buffer;
assert.equal(hasPdfSignature(buffer("<html><script>alert('not a PDF')</script></html>")), false);
assert.equal(imageMimeType(buffer('<svg onload="alert(1)"></svg>')), undefined);
assert.equal(hasPdfSignature(buffer("%PDF-1.7\nsynthetic")), true);
assert.equal(hasPdfSignature(buffer(" ".repeat(1000) + "%PDF-1.7")), true);
assert.equal(hasPdfSignature(buffer(" ".repeat(1024) + "%PDF-1.7")), false);
assert.equal(hasZipSignature(new Uint8Array([0x50,0x4b,0x03,0x04]).buffer), true);
assert.equal(hasOleSignature(new Uint8Array([0xd0,0xcf,0x11,0xe0]).buffer), true);
assert.equal(imageMimeType(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).buffer), "image/png");
assert.equal(mediaMimeType(buffer('<html><script>bad()</script></html>'), "recording.mp4"), undefined);
assert.equal(mediaMimeType(buffer("RIFF1234WAVEdata"), "recording.wav"), "audio/wav");
assert.equal(mediaMimeType(buffer("0000ftypM4A "), "recording.m4a"), "audio/mp4");
assert.equal(mediaMimeType(buffer("0000ftypisom"), "recording.mp4"), "video/mp4");
const signal = new AbortController().signal;
assert.deepEqual(await readPreviewResponse(new Response("bounded preview"), signal), buffer("bounded preview"));
let canceled = false;
const oversized = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_FILE_PREVIEW_BYTES + 1)); }, cancel() { canceled = true; } }));
await assert.rejects(readPreviewResponse(oversized, signal), /25 MB/);
assert.equal(canceled, true, "Oversized responses must stop reading");
await assert.rejects(readPreviewResponse(new Response("tiny", { headers: { "content-length": String(MAX_FILE_PREVIEW_BYTES + 1) } }), signal), /25 MB/);
await assert.rejects(readPreviewResponse(new Response(null, { status: 403 }), signal), /403/);
const aborted = new AbortController(); aborted.abort();
await assert.rejects(readPreviewResponse(new Response("never read"), aborted.signal), /abort/i);
await assert.rejects(verifyPreviewBytes(buffer("changed"), "0".repeat(64)), /integrity/);
await assert.rejects(verifyPreviewBytes(buffer("changed"), undefined, 6), /size/);
const original = buffer("original");
const digest = Buffer.from(await crypto.subtle.digest("SHA-256", original)).toString("hex");
assert.equal(await verifyPreviewBytes(original, digest, original.byteLength), original);
const priorFetch = globalThis.fetch;
const envNames = ["VITE_AUTH_MODE", "VITE_RUNTIME_MODE", "VITE_CONVEX_SITE_URL"] as const;
const priorEnv = envNames.map(key => process.env[key]);
process.env.VITE_AUTH_MODE = "none"; process.env.VITE_RUNTIME_MODE = "local-indexeddb"; process.env.VITE_CONVEX_SITE_URL = "https://fixture.convex.site";
const server = await createServer({ root: process.cwd(), configFile: false, resolve: { alias: { "@": `${process.cwd()}/src` } }, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true } });
try {
  const { readProcurementDocument } = await server.ssrLoadModule("/src/features/procurementReview/lib/documents.ts");
  const bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic preview fixture");
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const document = { documentKey: "fixture", name: "fixture.pdf", mediaType: "application/pdf", sha256, bytes: bytes.length, parts: 0, available: true };
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("societyId"), "workspace");
    assert.equal(url.searchParams.get("path"), `files/${sha256}`);
    assert.equal(init?.redirect, "error");
    return new Response(bytes);
  };
  assert.deepEqual(new Uint8Array(await readProcurementDocument("workspace", document)), bytes);
  await assert.rejects(readProcurementDocument("workspace", { ...document, bytes: bytes.length - 1 }), /published size/);
  // Keep a valid content-address path but serve changed bytes.
  globalThis.fetch = async () => new Response(new TextEncoder().encode("%PDF-1.7\nsynthetic preview fixturX"));
  await assert.rejects(readProcurementDocument("workspace", document), /integrity/);
  globalThis.fetch = async () => new Response(null, { status: 404 });
  await assert.rejects(readProcurementDocument("workspace", document), /missing/);
  const controller = new AbortController(); controller.abort();
  const before = requests;
  await assert.rejects(readProcurementDocument("workspace", document, controller.signal), /abort/i);
  assert.equal(requests, before, "Canceled previews must not start fetching files");
  const { readDocumentPreview } = await server.ssrLoadModule("/src/lib/documentPreview.ts");
  const opened: string[] = [];
  const access = {
    getDownloadTarget: async ({ versionId }: { versionId: string }) => {
      opened.push(versionId);
      return { kind: "url", provider: "sharepoint", key: versionId, url: "https://fixture.example/version-file", fileSizeBytes: bytes.length };
    },
    getLegacyUrl: async () => { throw new Error("Must not substitute legacy storage for a selected version"); },
  };
  globalThis.fetch = async (url, init) => { assert.equal(String(url), "https://fixture.example/version-file"); assert.equal(init?.signal, signal); return new Response(bytes); };
  const selected = { _id: "document", latestVersionId: "historical-version", versionOnly: true, fileName: "fixture.pdf", sha256, fileSizeBytes: bytes.length, storageId: "wrong-legacy-file" };
  assert.deepEqual(new Uint8Array(await readDocumentPreview(selected, access, signal)), bytes);
  assert.deepEqual(opened, ["historical-version"]);
  await assert.rejects(readDocumentPreview(selected, { ...access, getDownloadTarget: async () => null }, signal), /no longer available/);
  await assert.rejects(readDocumentPreview(selected, { ...access, getDownloadTarget: async () => { throw new Error("Access denied"); } }, signal), /Access denied/);
  const versionRequests = opened.length;
  await assert.rejects(readDocumentPreview({ ...selected, fileSizeBytes: MAX_FILE_PREVIEW_BYTES + 1 }, access, signal), /25 MB/);
  assert.equal(opened.length, versionRequests, "Known large previews must not request file targets");
  console.log("OK file previews: byte signatures reject HTML/SVG, real file/media signatures, bounded streaming reads, integrity checks, selected-file routing, size/checksum validation, missing-file fallback and cancellation.");
} finally {
  globalThis.fetch = priorFetch;
  envNames.forEach((key, i) => { if (priorEnv[i] === undefined) delete process.env[key]; else process.env[key] = priorEnv[i]; });
  await server.close();
}
