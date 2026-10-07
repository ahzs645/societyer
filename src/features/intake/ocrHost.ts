/** OCR host for the intake web worker (browser and desktop): pdf.js pages rendered on an
 * OffscreenCanvas, images decoded with createImageBitmap, words recognised by tesseract.js.
 *
 * Everything is served from this build (`assets/intake-ocr/`, see vite.config.ts): the
 * tesseract.js worker script, its WebAssembly core and the English model, and pdf.js's
 * JBIG2 / JPEG 2000 decoders. No CDN is contacted, so OCR works offline in the desktop app,
 * and no page leaves the device. This module and tesseract.js load only when a run asks for
 * OCR (they are outside the app's main bundle). */
import { OcrPageBudget, type OcrHost, type OcrImage } from "../../../shared/intake/extract/ocr";
import { createTesseractEngine, type TesseractModule } from "../../../shared/intake/extract/ocrTesseract";

/** `assets/intake-ocr/` next to the worker chunk in a build; any `/intake-ocr/` path in dev. */
export function intakeOcrAssetBase(): string {
  const folder = "intake-ocr/";
  return new URL(folder, import.meta.url).href;
}

/** WebAssembly SIMD (every current browser and Electron): selects the faster core. */
function supportsSimd(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

/** pdf.js draws into canvases it creates itself (masks, patterns); a worker has no document. */
class OffscreenCanvasFactory {
  constructor(_options?: unknown) {}
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(target: { canvas: OffscreenCanvas | null }, width: number, height: number) {
    if (!target.canvas) throw new Error("Canvas is not specified");
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (target.canvas) target.canvas.width = target.canvas.height = 0;
    target.canvas = null;
    target.context = null;
  }
}
class NoFilterFactory {
  constructor(_options?: unknown) {}
  addFilter() { return "none"; }
  addHCMFilter() { return "none"; }
  addAlphaFilter() { return "none"; }
  addLuminosityFilter() { return "none"; }
  addHighlightHCMFilter() { return "none"; }
  destroy() {}
}

async function encode(canvas: OffscreenCanvas): Promise<OcrImage> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, mime: "image/png" };
}

function whiteCanvas(width: number, height: number) {
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

export type WorkerOcrOptions = { pageBudget: number; workers?: number; onPage?: (pagesRead: number, budget: number) => void };

export async function createWorkerOcrHost(options: WorkerOcrOptions): Promise<OcrHost & { terminate(): Promise<void> }> {
  const base = intakeOcrAssetBase();
  const tesseract = (await import("tesseract.js")) as unknown as Partial<TesseractModule> & { default?: TesseractModule };
  const engine = createTesseractEngine(tesseract.createWorker ? (tesseract as TesseractModule) : tesseract.default!, {
    workers: options.workers ?? 1,
    name: "tesseract.js-7-eng-lstm",
    workerOptions: {
      workerPath: `${base}tesseract-worker.min.js`,
      corePath: `${base}${supportsSimd() ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js"}`,
      langPath: base.replace(/\/$/, ""),
      gzip: true,
      cacheMethod: "none",
      workerBlobURL: false,
    },
  });
  const budget = new OcrPageBudget(options.pageBudget);
  const recognize = engine.recognize.bind(engine);
  engine.recognize = async (image) => {
    const result = await recognize(image);
    options.onPage?.(budget.used, budget.limit);
    return result;
  };
  return {
    engine,
    budget,
    dpi: 300,
    // A browser tab has less memory than the CLI: large pages are read at a lower resolution.
    maxPixels: 12_000_000,
    keepLineBoxes: true,
    pdfjsWasmUrl: `${base}pdfjs/`,
    pdfjsDocumentOptions: { CanvasFactory: OffscreenCanvasFactory, FilterFactory: NoFilterFactory, isOffscreenCanvasSupported: true },
    async renderPdfPage(page: any, { scale, rotation }) {
      const viewport = page.getViewport({ scale, rotation });
      const { canvas, context } = whiteCanvas(viewport.width, viewport.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      return encode(canvas);
    },
    async decodeImage(bytes, _fileName, { rotation, maxPixels }) {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
      } catch {
        return null; // TIFF and other formats the browser cannot decode
      }
      const shrink = Math.min(1, Math.sqrt(maxPixels / Math.max(1, bitmap.width * bitmap.height)));
      const width = Math.max(1, Math.round(bitmap.width * shrink));
      const height = Math.max(1, Math.round(bitmap.height * shrink));
      const turned = rotation === 90 || rotation === 270;
      const { canvas, context } = whiteCanvas(turned ? height : width, turned ? width : height);
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.drawImage(bitmap, -width / 2, -height / 2, width, height);
      bitmap.close();
      return encode(canvas);
    },
    terminate: () => engine.terminate(),
  };
}
