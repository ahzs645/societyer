import type { PdfJsModule } from "../../../../shared/intake/extract/pdf";
import type { RegistryFileText } from "./extractCore";
import type { RegistryExtractRequest, RegistryExtractResponse } from "./extractProtocol";

export const MAX_REGISTRY_FILES = 30;
export const MAX_REGISTRY_FILE_BYTES = 25 * 1024 * 1024;
/** How long one file (with its attachments) may take before the reader is stopped. */
export const REGISTRY_FILE_TIMEOUT_MS = 60_000;

/** True for the files the import reads: PDFs and saved emails. */
export function isRegistryFile(file: Pick<File, "name" | "type">) {
  return /\.(pdf|eml)$/i.test(file.name) || file.type === "application/pdf" || file.type === "message/rfc822";
}

/** A name the extractor reads by extension, for a PDF or email saved without one. */
function extractName(file: File) {
  if (/\.(pdf|eml)$/i.test(file.name)) return file.name;
  return `${file.name}.${file.type === "message/rfc822" ? "eml" : "pdf"}`;
}

/**
 * Text of each chosen file and of each email's attachments, read on this
 * device. A worker does the reading (pdf.js and MIME decoding stay off the
 * main thread); without workers the same code is loaded here on demand.
 * Results come back in the order the files were chosen, each email followed
 * by its attachments. A file that takes longer than a minute stops the
 * reader; `signal` cancels it.
 */
export async function readRegistryFiles(files: readonly { id: string; file: File }[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<RegistryFileText[]> {
  const inputs = await Promise.all(files.map(async ({ id, file }) => ({ id, name: extractName(file), bytes: await file.arrayBuffer() })));
  if (signal?.aborted) throw new DOMException("Reading cancelled.", "AbortError");
  if (typeof Worker === "undefined") return readOnMainThread(inputs, onProgress);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./registryExtract.worker.ts", import.meta.url), { type: "module", name: "societyer-registry-extract" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = 0;
    const finish = (outcome: () => void) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      outcome();
    };
    const fail = (message: string) => finish(() => reject(new Error(message)));
    // Each file gets its own minute, from the moment the worker starts on it.
    const startTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fail(`Reading ${files[current]?.file.name ?? "a file"} took longer than a minute, so it was stopped. Try again without that file.`), REGISTRY_FILE_TIMEOUT_MS);
    };
    const cancel = () => finish(() => reject(new DOMException("Reading cancelled.", "AbortError")));
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<RegistryExtractResponse | { type?: unknown }>) => {
      const message = event.data;
      // pdf.js posts its own handshake messages; only ours finish the job.
      if (message.type === "progress" && "done" in message) {
        current = message.done;
        startTimer();
        onProgress?.(message.done, message.total);
      } else if (message.type === "result" && "files" in message) finish(() => resolve(message.files));
      else if (message.type === "error" && "message" in message) fail(message.message);
    };
    worker.onmessageerror = () => fail("The document reader sent back something that couldn't be read. Try again with fewer files.");
    worker.onerror = () => fail("The document reader could not start. Reload the page and try again.");
    startTimer();
    const request: RegistryExtractRequest = { files: inputs };
    worker.postMessage(request, inputs.map((input) => input.bytes));
  });
}

async function readOnMainThread(inputs: RegistryExtractRequest["files"], onProgress?: (done: number, total: number) => void): Promise<RegistryFileText[]> {
  const [{ extractBytes }, { readRegistryFile }] = await Promise.all([import("../../../../shared/intake/extract"), import("./extractCore")]);
  let pdfjs: Promise<PdfJsModule> | null = null;
  const loadPdfJs = () => {
    pdfjs ??= (async () => {
      const [module, handler] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.mjs")]);
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= handler;
      return module as unknown as PdfJsModule;
    })();
    return pdfjs;
  };
  const results: RegistryFileText[] = [];
  for (const [index, input] of inputs.entries()) {
    onProgress?.(index, inputs.length);
    results.push(...await readRegistryFile({ id: input.id, name: input.name, bytes: new Uint8Array(input.bytes) }, async (name, bytes) => {
      const extract = await extractBytes(name, bytes, { pdfjs: /\.pdf$/i.test(name) ? await loadPdfJs() : undefined, maxAttachmentDepth: 0 });
      return { text: extract.text, warnings: extract.warnings };
    }));
  }
  return results;
}
