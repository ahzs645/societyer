/** Messages between the intake page and the intake extraction worker. */
import type { IntakeExtract } from "../../../shared/intake/blocks";
import type { CoverageReport, IntakeRunResult } from "../../../shared/intake/bundle";

export type WorkerFileInput = { fileKey: string; name: string; path: string; sizeBytes: number; modifiedTime?: string; mimeType?: string; file: Blob };
export type WorkerLlmConfig = { provider: "openai" | "openrouter" | "openai-compatible"; modelId: string; apiKey: string; baseUrl?: string; budgetTokens: number; concurrency: number };
/** OCR of scanned PDF pages and document images, on this device (tesseract.js). */
export type WorkerOcrConfig = { pageBudget: number; workers?: number };

export type IntakeWorkerRequest =
  | {
      type: "run";
      files: WorkerFileInput[];
      canConvertLegacy: boolean;
      options: { name: string; sourceKind: "upload" | "local_folder"; sourceRoot: string; fieldExtraction: boolean; llm?: WorkerLlmConfig; ocr?: WorkerOcrConfig };
    }
  | { type: "convertResult"; id: number; bytes: ArrayBuffer | null };

export type IntakeWorkerResponse =
  | { type: "progress"; stage: string; done: number; total: number }
  | { type: "convert"; id: number; name: string; target: "docx" | "xlsx"; bytes: ArrayBuffer }
  | { type: "result"; run: Omit<IntakeRunResult, "texts"> & { texts?: undefined }; extracts: Record<string, IntakeExtract>; coverage?: CoverageReport }
  | { type: "error"; message: string };
