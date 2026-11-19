/** Reads registry PDFs and emails off the main thread: pdf.js text layers,
 * email headers and bodies, and each email's PDF and message attachments.
 * Only text and attachment bytes go back; nothing is logged. */
import { extractBytes } from "../../../../shared/intake/extract";
import type { PdfJsModule } from "../../../../shared/intake/extract/pdf";
import { readRegistryFile, type RegistryFileText } from "./extractCore";
import type { RegistryExtractRequest, RegistryExtractResponse } from "./extractProtocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<RegistryExtractRequest>) => void) | null;
  postMessage: (message: RegistryExtractResponse, transfer?: Transferable[]) => void;
};
const scope = self as unknown as WorkerScope;

let pdfjsPromise: Promise<PdfJsModule> | null = null;
function loadPdfJs(): Promise<PdfJsModule> {
  // pdf.js's own worker can't be nested reliably; its handler runs in this worker (fake-worker mode).
  pdfjsPromise ??= (async () => {
    const [pdfjs, handler] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.mjs")]);
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= handler;
    return pdfjs as unknown as PdfJsModule;
  })();
  return pdfjsPromise;
}

scope.onmessage = (event) => {
  const { files } = event.data;
  void (async () => {
    try {
      const results: RegistryFileText[] = [];
      for (const [index, file] of files.entries()) {
        scope.postMessage({ type: "progress", done: index, total: files.length });
        results.push(...await readRegistryFile({ id: file.id, name: file.name, bytes: new Uint8Array(file.bytes) }, async (name, bytes) => {
          const extract = await extractBytes(name, bytes, { pdfjs: /\.pdf$/i.test(name) ? await loadPdfJs() : undefined, maxAttachmentDepth: 0 });
          return { text: extract.text, warnings: extract.warnings };
        }));
      }
      // Each attachment gets its own buffer, so every one can be transferred.
      const payload = results.map((result) => result.attachment ? { ...result, attachment: { ...result.attachment, bytes: result.attachment.bytes.slice() } } : result);
      const transfer = payload.flatMap((result) => result.attachment ? [result.attachment.bytes.buffer as ArrayBuffer] : []);
      scope.postMessage({ type: "result", files: payload }, transfer);
    } catch (error) {
      scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
