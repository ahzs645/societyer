import { parseTd1Bytes } from "./td1ParserCore";
import type { PayrollTd1Form } from "../../../shared/payrollTd1";
import type { PdfJsModule } from "../../../shared/intake/extract/pdf";

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ bytes: Uint8Array; expectedForm: PayrollTd1Form; expectedYear: number; forceOcr?: boolean }>) => void) | null; postMessage: (message: unknown) => void };
scope.onmessage = async event => {
  try {
    const [pdfjs, handler] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.mjs")]);
    (globalThis as any).pdfjsWorker ??= handler;
    const result = await parseTd1Bytes(event.data.bytes, { expectedForm: event.data.expectedForm, expectedYear: event.data.expectedYear, forceOcr: event.data.forceOcr, pdfjs: pdfjs as unknown as PdfJsModule, createOcrHost: async () => { const { createWorkerOcrHost } = await import("../intake/ocrHost"); return createWorkerOcrHost({ pageBudget: 2, workers: 1 }); }, onProgress: progress => scope.postMessage({ type: "progress", progress }) });
    scope.postMessage({ type: "result", result });
  } catch { scope.postMessage({ type: "error", message: "The local TD1 import could not be read safely. Use one unlocked 2026 federal or BC form and review all fields; no document was uploaded." }); }
};
