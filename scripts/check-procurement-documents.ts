/**
 * The hosted reader's document cache (src/features/procurementReview/lib/documents.ts):
 * one SharePoint read per verified file, shared by concurrent callers,
 * cancelled when nobody wants it, never caching a failure, bounded in bytes.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cachedDocument, clearDocumentCache, DOCUMENT_CACHE_BYTES, type StoredProcurementDocument } from "../src/features/procurementReview/lib/documents";
import type { BlobReader } from "../src/features/procurementReview/lib/blobs";

function file(name: string, size = 64): { document: StoredProcurementDocument; bytes: Uint8Array } {
  const bytes = new Uint8Array(size).map((_, index) => (index * 7 + name.length) % 251);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, document: { documentKey: name, name, mediaType: "application/pdf", sha256, bytes: size, parts: 0, available: true } };
}

/** A reader that counts its reads and can be held open until released. */
function reader(bytes: Uint8Array, options: { fail?: boolean } = {}) {
  let reads = 0, aborted = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read: BlobReader = async (_path, signal) => {
    reads++;
    await new Promise<void>((resolve, reject) => {
      signal?.addEventListener("abort", () => { aborted++; reject(signal.reason); }, { once: true });
      void gate.then(resolve);
    });
    if (options.fail) throw new Error("SharePoint unavailable");
    return bytes.slice();
  };
  return { read: () => read, release, get reads() { return reads; }, get aborted() { return aborted; } };
}

// Concurrent callers share one read; a later call is served from memory; each gets its own buffer.
{
  clearDocumentCache();
  const { document, bytes } = file("shared.pdf");
  const source = reader(bytes);
  const first = cachedDocument("w:shared", source.read, document);
  const second = cachedDocument("w:shared", source.read, document);
  source.release();
  const [a, b] = await Promise.all([first, second]);
  const c = await cachedDocument("w:shared", source.read, document);
  assert.equal(source.reads, 1, "One read for concurrent and repeated opens");
  assert.deepEqual(new Uint8Array(c), bytes);
  assert.notEqual(a, b, "Each caller gets its own copy");
  structuredClone(a, { transfer: [a] });
  assert.equal((await cachedDocument("w:shared", source.read, document)).byteLength, bytes.byteLength, "A caller detaching its copy leaves the cache intact");
}

// The last caller giving up cancels the read, and nothing is cached.
{
  clearDocumentCache();
  const { document, bytes } = file("closed.pdf");
  const source = reader(bytes);
  const controller = new AbortController();
  const pending = cachedDocument("w:closed", source.read, document, controller.signal);
  controller.abort();
  await assert.rejects(pending);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(source.aborted, 1, "Closing the only preview stops its read");
  const again = reader(bytes);
  const retry = cachedDocument("w:closed", again.read, document);
  again.release();
  await retry;
  assert.equal(again.reads, 1, "A cancelled read isn't reused");
}

// One caller giving up doesn't cancel a read another still waits for.
{
  clearDocumentCache();
  const { document, bytes } = file("download.pdf");
  const source = reader(bytes);
  const preview = new AbortController();
  const shown = cachedDocument("w:download", source.read, document, preview.signal);
  const download = cachedDocument("w:download", source.read, document);
  preview.abort();
  await assert.rejects(shown);
  source.release();
  assert.deepEqual(new Uint8Array(await download), bytes);
  assert.equal(source.aborted, 0);
}

// A failure (or a file failing its integrity check) is never cached.
{
  clearDocumentCache();
  const { document, bytes } = file("flaky.pdf");
  const failing = reader(bytes, { fail: true });
  const attempt = cachedDocument("w:flaky", failing.read, document);
  failing.release();
  await assert.rejects(attempt, /SharePoint unavailable/);
  const tampered = reader(new Uint8Array(bytes.length));
  const bad = cachedDocument("w:flaky", tampered.read, document);
  tampered.release();
  await assert.rejects(bad, /integrity/);
  const working = reader(bytes);
  const ok = cachedDocument("w:flaky", working.read, document);
  working.release();
  assert.deepEqual(new Uint8Array(await ok), bytes);
}

// Bounded: the least recently used file is dropped first.
{
  clearDocumentCache();
  const size = Math.floor(DOCUMENT_CACHE_BYTES / 3);
  const files = ["a", "b", "c", "d"].map((name) => file(`${name}.pdf`, size));
  const readers = files.map((entry) => reader(entry.bytes));
  readers.forEach((entry) => entry.release());
  for (const [index, entry] of files.entries()) {
    await cachedDocument(`w:${index}`, readers[index].read, entry.document);
    if (index === 1) await cachedDocument("w:0", readers[0].read, files[0].document); // a used again: b is now the oldest
  }
  await cachedDocument("w:0", readers[0].read, files[0].document);
  await cachedDocument("w:1", readers[1].read, files[1].document);
  assert.equal(readers[0].reads, 1, "Recently used files stay");
  assert.equal(readers[1].reads, 2, "The least recently used file was evicted");
}

console.log("OK: procurement documents read once per tab, shared by concurrent callers, cancelled when unwanted, failures and tampered files never cached, bounded LRU.");
