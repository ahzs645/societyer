/** Intake extraction worker (local + desktop runtimes, and stage 0–4 for
 * hosted runs). Runs the shared deterministic pipeline off the main thread:
 * junk filter, text/layout extraction (DOCX via jszip, PDF via pdf.js, XLSX,
 * MSG), clustering, classification and — unless the server extracts fields —
 * field extraction (deterministic, or the configured AI provider with
 * PII redaction), span verification and reconciliation. Legacy formats are
 * converted by the desktop host when the main thread can ask it to (and read
 * natively otherwise). Scanned pages and document images are read by OCR
 * (tesseract.js, local assets) when the run asks for it. */
import { runIntakePipeline, type PipelineSourceFile } from "../../../shared/intake/pipeline";
import { extractBytes } from "../../../shared/intake/extract";
import type { PdfJsModule } from "../../../shared/intake/extract/pdf";
import { buildImportBundle, coverageReport } from "../../../shared/intake/bundle";
import type { GenerateObjectFn } from "../../../shared/intake/llm";
import { withOcrActivity, type OcrHost } from "../../../shared/intake/extract/ocr";
import type { IntakeWorkerRequest, IntakeWorkerResponse, WorkerLlmConfig, WorkerOcrConfig } from "./workerProtocol";

type WorkerScope = { postMessage: (message: IntakeWorkerResponse, transfer?: Transferable[]) => void; onmessage: ((event: MessageEvent<IntakeWorkerRequest>) => void) | null };
const scope = self as unknown as WorkerScope;
const post = (message: IntakeWorkerResponse, transfer?: Transferable[]) => scope.postMessage(message, transfer);

let pdfjsPromise: Promise<PdfJsModule> | null = null;
function loadPdfJs(): Promise<PdfJsModule> {
  // pdf.js's own worker cannot be nested reliably here, so its message handler runs in this worker (fake-worker mode).
  pdfjsPromise ??= (async () => {
    const [pdfjs, handler] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.mjs")]);
    (globalThis as any).pdfjsWorker ??= handler;
    return pdfjs as unknown as PdfJsModule;
  })();
  return pdfjsPromise;
}

/** The OCR host is created per run; tesseract.js itself starts on the first page that needs it. */
async function makeOcr(config: WorkerOcrConfig): Promise<OcrHost & { terminate(): Promise<void> }> {
  const { createWorkerOcrHost } = await import("./ocrHost");
  return createWorkerOcrHost({ pageBudget: config.pageBudget, workers: config.workers, onPage: (done, total) => post({ type: "progress", stage: "ocr", done, total }) });
}

const pendingConversions = new Map<number, (bytes: Uint8Array | null) => void>();
let conversionId = 0;
let canConvert = false;
function convertLegacy(bytes: Uint8Array, fileName: string, target: "docx" | "xlsx"): Promise<Uint8Array | null> {
  if (!canConvert) return Promise.resolve(null);
  const id = ++conversionId;
  return new Promise((resolve) => {
    pendingConversions.set(id, resolve);
    const copy = bytes.slice().buffer;
    post({ type: "convert", id, name: fileName, target, bytes: copy }, [copy]);
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function makeLlm(config: WorkerLlmConfig): Promise<{ generate: GenerateObjectFn; provider: string; model: string; budgetTokens: number; concurrency: number }> {
  const [{ createOpenAI }, { makeGenerateObject }] = await Promise.all([import("@ai-sdk/openai"), import("../../../shared/intake/aiGenerate")]);
  const provider = createOpenAI({ apiKey: config.apiKey, ...(config.baseUrl ? { baseURL: config.baseUrl } : {}) });
  const model = config.provider === "openai" ? provider(config.modelId) : provider.chat(config.modelId);
  return { generate: makeGenerateObject(model), provider: config.provider, model: config.modelId, budgetTokens: config.budgetTokens, concurrency: config.concurrency };
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "convertResult") {
    pendingConversions.get(message.id)?.(message.bytes ? new Uint8Array(message.bytes) : null);
    pendingConversions.delete(message.id);
    return;
  }
  if (message.type !== "run") return;
  canConvert = message.canConvertLegacy;
  void (async () => {
    try {
      const files: PipelineSourceFile[] = message.files.map((input) => ({
        fileKey: input.fileKey,
        name: input.name,
        path: input.path,
        sizeBytes: input.sizeBytes,
        modifiedTime: input.modifiedTime,
        mimeType: input.mimeType || undefined,
        acquisitionStatus: "local",
        read: async () => new Uint8Array(await input.file.arrayBuffer()),
      }));
      const llm = message.options.llm ? await makeLlm(message.options.llm) : undefined;
      const ocr = message.options.ocr ? await makeOcr(message.options.ocr) : undefined;
      const result = await runIntakePipeline(files, {
        name: message.options.name,
        sourceKind: message.options.sourceKind,
        sourceRoot: message.options.sourceRoot,
        fieldExtraction: message.options.fieldExtraction,
        concurrency: 2,
        hash: sha256,
        llm,
        ocrImages: Boolean(ocr),
        extract: async (file, bytes, { keepAlive }) => extractBytes(file.name, bytes, { pdfjs: /\.pdf$/i.test(file.name) || !/\.[a-z0-9]{1,6}$/i.test(file.name) ? await loadPdfJs() : undefined, convertLegacy: canConvert ? convertLegacy : undefined, ocr: ocr && withOcrActivity(ocr, keepAlive) }),
        onProgress: (stage, done, total) => post({ type: "progress", stage, done, total }),
      }).finally(() => ocr?.terminate());
      const { extracts, texts: _texts, ...run } = result;
      const coverage = message.options.fieldExtraction === false ? undefined : coverageReport(result, buildImportBundle(result));
      post({ type: "result", run: { ...run, texts: undefined }, extracts, coverage });
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
