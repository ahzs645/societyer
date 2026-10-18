import assert from "node:assert/strict";
import { createServer } from "vite";
import { hasPdfSignature, hasZipSignature, hasOleSignature, imageMimeType } from "../src/lib/filePreviewSignatures";
const buffer = (text: string) => new TextEncoder().encode(text).buffer;
assert.equal(hasPdfSignature(buffer("<html><script>alert('not a PDF')</script></html>")), false);
assert.equal(imageMimeType(buffer('<svg onload="alert(1)"></svg>')), undefined);
assert.equal(hasPdfSignature(buffer("%PDF-1.7\nsynthetic")), true);
assert.equal(hasPdfSignature(buffer(" ".repeat(1000) + "%PDF-1.7")), true);
assert.equal(hasPdfSignature(buffer(" ".repeat(1024) + "%PDF-1.7")), false);
assert.equal(hasZipSignature(new Uint8Array([0x50,0x4b,0x03,0x04]).buffer), true);
assert.equal(hasOleSignature(new Uint8Array([0xd0,0xcf,0x11,0xe0]).buffer), true);
assert.equal(imageMimeType(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).buffer), "image/png");
const priorFetch = globalThis.fetch;
const envNames = ["VITE_AUTH_MODE", "VITE_RUNTIME_MODE", "VITE_CONVEX_SITE_URL"] as const;
const priorEnv = envNames.map(key => process.env[key]);
process.env.VITE_AUTH_MODE = "none"; process.env.VITE_RUNTIME_MODE = "local-indexeddb"; process.env.VITE_CONVEX_SITE_URL = "https://fixture.convex.site";
const server = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true } });
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
  console.log("OK file previews: byte signatures reject HTML/SVG, real file signatures, selected-file routing, size/checksum validation, missing-file fallback and cancellation.");
} finally {
  globalThis.fetch = priorFetch;
  envNames.forEach((key, i) => { if (priorEnv[i] === undefined) delete process.env[key]; else process.env[key] = priorEnv[i]; });
  await server.close();
}
