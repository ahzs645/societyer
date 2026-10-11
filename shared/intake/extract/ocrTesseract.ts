/** tesseract.js as an OcrEngine: a small pool of recognisers created on first use, shared by
 * the browser worker and the Node CLI. The caller passes the imported module and where its
 * worker script, WebAssembly core and English data live (always local files: no CDN fetch). */
import type { OcrEngine, OcrImage, OcrRecognition, OcrWord } from "./ocr";

type TesseractWorker = {
  recognize: (image: unknown, options?: Record<string, unknown>, output?: Record<string, boolean>) => Promise<{ data: any }>;
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};
export type TesseractModule = { createWorker: (langs: string, oem?: number, options?: Record<string, unknown>) => Promise<TesseractWorker> };

/** tesseract.js `blocks` output (block → paragraph → line → word) → flat words with line ids. */
export function recognitionFromTesseractBlocks(blocks: any[] | null | undefined, size: { width: number; height: number }): OcrRecognition {
  const words: OcrWord[] = [];
  let line = 0;
  let maxX = 0;
  let maxY = 0;
  for (const block of blocks ?? []) {
    for (const paragraph of block?.paragraphs ?? []) {
      for (const textLine of paragraph?.lines ?? []) {
        for (const word of textLine?.words ?? []) {
          const text = String(word?.text ?? "").trim();
          const bbox = word?.bbox;
          if (!text || !bbox) continue;
          words.push({ text, confidence: Number(word.confidence ?? 0), bbox: { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 }, line });
          maxX = Math.max(maxX, bbox.x1);
          maxY = Math.max(maxY, bbox.y1);
        }
        line += 1;
      }
    }
  }
  return { words, width: size.width || maxX + 10, height: size.height || maxY + 10 };
}

export type TesseractEngineOptions = {
  /** Concurrent recognisers (default 1). Each holds the model (~40 MB) and one page image. */
  workers?: number;
  /** createWorker options: workerPath, corePath, langPath, cacheMethod, gzip, workerBlobURL … */
  workerOptions: Record<string, unknown>;
  /** Shown in extract method versions and the processing log. */
  name: string;
};

export function createTesseractEngine(tesseract: TesseractModule, options: TesseractEngineOptions): OcrEngine & { terminate(): Promise<void> } {
  const size = Math.max(1, options.workers ?? 1);
  const idle: TesseractWorker[] = [];
  const all: Array<Promise<TesseractWorker>> = [];
  const waiting: Array<(worker: TesseractWorker) => void> = [];
  const acquire = async (): Promise<TesseractWorker> => {
    const free = idle.pop();
    if (free) return free;
    if (all.length < size) {
      // OEM 1 = LSTM only (the bundled "best_int" English model).
      const created = tesseract.createWorker("eng", 1, options.workerOptions).then(async (worker) => {
        await worker.setParameters({ user_defined_dpi: "300" }).catch(() => undefined);
        return worker;
      });
      all.push(created);
      return created;
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = (worker: TesseractWorker) => {
    const next = waiting.shift();
    if (next) next(worker);
    else idle.push(worker);
  };
  return {
    name: options.name,
    async recognize(image: OcrImage): Promise<OcrRecognition> {
      const worker = await acquire();
      try {
        const result = await worker.recognize(image.bytes, { rotateAuto: true }, { blocks: true, text: false });
        return recognitionFromTesseractBlocks(result.data?.blocks, image);
      } finally {
        release(worker);
      }
    },
    async terminate() {
      const workers = await Promise.allSettled(all);
      await Promise.all(workers.map((settled) => (settled.status === "fulfilled" ? settled.value.terminate().catch(() => undefined) : undefined)));
      all.length = 0;
      idle.length = 0;
    },
  };
}
