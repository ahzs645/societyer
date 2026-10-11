/** Node / Electron-main OCR host: pdf.js pages rasterized with @napi-rs/canvas, recognised by
 * the system `tesseract` binary when one is installed (faster, reads TIFF) or by tesseract.js
 * with the bundled English model otherwise. Not imported by browser code. */
import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { OcrPageBudget, type OcrEngine, type OcrHost, type OcrImage, type OcrRecognition, type OcrWord } from "../extract/ocr";
import { createTesseractEngine, type TesseractModule } from "../extract/ocrTesseract";

const require = createRequire(import.meta.url);
const run = promisify(execFile);

export type NodeOcrOptions = {
  /** "auto" (default): the system binary when found, else tesseract.js. */
  engine?: "auto" | "tesseract.js" | "system";
  /** Concurrent recognisers (default 2). */
  concurrency?: number;
  /** Pages OCR may read in this run (default unlimited). */
  pageBudget?: number;
  dpi?: number;
  keepLineBoxes?: boolean;
};

export type NodeOcrHost = OcrHost & { terminate(): Promise<void>; engineKind: "system" | "tesseract.js" };

let systemTesseract: { path: string; version: string } | null | undefined;
export async function findSystemTesseract(): Promise<{ path: string; version: string } | null> {
  if (systemTesseract !== undefined) return systemTesseract;
  for (const candidate of [process.env.TESSERACT_PATH, "tesseract", "/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"].filter(Boolean) as string[]) {
    try {
      const { stdout, stderr } = await run(candidate, ["--version"], { timeout: 15000 });
      const version = /tesseract\s+v?([\d.]+)/i.exec(`${stdout}\n${stderr}`)?.[1] ?? "unknown";
      systemTesseract = { path: candidate, version };
      return systemTesseract;
    } catch {
      // next candidate
    }
  }
  systemTesseract = null;
  return null;
}

/** `tesseract … tsv` output → words (level 5 rows) grouped by block/paragraph/line. */
export function recognitionFromTsv(tsv: string, size: { width: number; height: number }): OcrRecognition {
  const words: OcrWord[] = [];
  const lineIds = new Map<string, number>();
  let maxX = 0;
  let maxY = 0;
  for (const row of tsv.split(/\r?\n/).slice(1)) {
    const cells = row.split("\t");
    if (cells.length < 12 || cells[0] !== "5") continue;
    const text = cells.slice(11).join("\t").trim();
    const confidence = Number(cells[10]);
    if (!text || confidence < 0) continue;
    const [left, top, width, height] = cells.slice(6, 10).map(Number);
    const key = `${cells[1]}:${cells[2]}:${cells[3]}:${cells[4]}`;
    if (!lineIds.has(key)) lineIds.set(key, lineIds.size);
    words.push({ text, confidence, bbox: { x0: left, y0: top, x1: left + width, y1: top + height }, line: lineIds.get(key)! });
    maxX = Math.max(maxX, left + width);
    maxY = Math.max(maxY, top + height);
  }
  return { words, width: size.width || maxX + 10, height: size.height || maxY + 10 };
}

function systemEngine(binary: { path: string; version: string }, concurrency: number): OcrEngine {
  let active = 0;
  const queue: Array<() => void> = [];
  const slot = () => new Promise<void>((resolve) => {
    if (active < concurrency) {
      active += 1;
      resolve();
    } else queue.push(() => {
      active += 1;
      resolve();
    });
  });
  const free = () => {
    active -= 1;
    queue.shift()?.();
  };
  return {
    name: `tesseract-${binary.version}-system`,
    async recognize(image: OcrImage) {
      await slot();
      try {
        const tsv = await new Promise<string>((resolve, reject) => {
          const child = spawn(binary.path, ["stdin", "stdout", "-l", "eng", "--psm", "3", "--dpi", "300", "tsv"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OMP_THREAD_LIMIT: "1" } });
          const chunks: Buffer[] = [];
          let stderr = "";
          child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
          child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
          child.on("error", reject);
          child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error(`tesseract exited ${code}: ${stderr.slice(0, 200)}`))));
          child.stdin.end(Buffer.from(image.bytes));
        });
        return recognitionFromTsv(tsv, image);
      } finally {
        free();
      }
    },
  };
}

/** Where the bundled English model lives (the `@tesseract.js-data/eng` package). */
export function bundledEnglishLangPath(): string {
  return path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
}
export function pdfjsWasmDirectory(): string {
  return `${path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "wasm")}${path.sep}`;
}

export async function createNodeOcrHost(options: NodeOcrOptions = {}): Promise<NodeOcrHost> {
  const canvasModule = await import("@napi-rs/canvas");
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const binary = options.engine === "tesseract.js" ? null : await findSystemTesseract();
  if (options.engine === "system" && !binary) throw new Error("--ocr-engine system: no tesseract binary found (set TESSERACT_PATH).");
  let engine: OcrEngine & { terminate?: () => Promise<void> };
  if (binary) engine = systemEngine(binary, concurrency);
  else {
    const tesseract = (await import("tesseract.js")) as unknown as Partial<TesseractModule> & { default?: TesseractModule };
    const version = (require("tesseract.js/package.json") as { version: string }).version;
    engine = createTesseractEngine(tesseract.createWorker ? (tesseract as TesseractModule) : tesseract.default!, {
      workers: concurrency,
      name: `tesseract.js-${version}-eng-lstm`,
      workerOptions: { langPath: bundledEnglishLangPath(), cacheMethod: "none", gzip: true },
    });
  }
  const toImage = (canvas: { width: number; height: number; toBuffer: (mime: "image/png") => Buffer }): OcrImage => ({ bytes: new Uint8Array(canvas.toBuffer("image/png")), width: canvas.width, height: canvas.height, mime: "image/png" });
  return {
    engine,
    engineKind: binary ? "system" : "tesseract.js",
    dpi: options.dpi ?? 300,
    budget: options.pageBudget !== undefined && Number.isFinite(options.pageBudget) ? new OcrPageBudget(options.pageBudget) : undefined,
    keepLineBoxes: options.keepLineBoxes,
    pdfjsWasmUrl: pdfjsWasmDirectory(),
    async renderPdfPage(page: any, { scale, rotation }) {
      const viewport = page.getViewport({ scale, rotation });
      const canvas = canvasModule.createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      return toImage(canvas);
    },
    async decodeImage(bytes, fileName, { rotation, maxPixels }) {
      let image: Awaited<ReturnType<typeof canvasModule.loadImage>>;
      try {
        image = await canvasModule.loadImage(Buffer.from(bytes));
      } catch {
        // TIFF and other formats the canvas cannot decode: the system binary reads them itself.
        if (binary && rotation === 0) return { bytes, width: 0, height: 0 };
        return null;
      }
      const shrink = Math.min(1, Math.sqrt(maxPixels / Math.max(1, image.width * image.height)));
      const width = Math.max(1, Math.round(image.width * shrink));
      const height = Math.max(1, Math.round(image.height * shrink));
      const turned = rotation === 90 || rotation === 270;
      const canvas = canvasModule.createCanvas(turned ? height : width, turned ? width : height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.drawImage(image, -width / 2, -height / 2, width, height);
      return toImage(canvas);
    },
    async terminate() {
      await engine.terminate?.();
    },
  };
}
