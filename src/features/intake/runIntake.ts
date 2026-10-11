/** Main-thread orchestration of an in-app intake run.
 *
 * 1. The run row is created first (status "running") so it shows up at once.
 * 2. The worker runs the shared pipeline: junk filter → text/layout extract →
 *    clusters → classification → (local runtime) field extraction with the
 *    deterministic engine or the device's AI provider.
 * 3. Originals are cached on this device by SHA-256 for the review viewer.
 * 4. Files, extracts, clusters, extractions and the processing log are staged
 *    through the portable intake:* mutations.
 * 5. Hosted runtime: fields are extracted server-side
 *    (intakeActions:extractRun, workspace AI settings, deterministic fallback)
 *    and the run is reconciled (intake:reconcileRun). */
import { junkVerdict } from "../../../shared/intake/junk";
import { stageRunInWorkspace, type MutationCaller } from "../../../shared/intake/stageRun";
import type { IntakeRunResult } from "../../../shared/intake/bundle";
import { desktopLegacyConverter, keptByJunkFilter, materializeSelection, type IntakeSelection } from "./collectFiles";
import { putOriginal } from "./originalsCache";
import { providerBaseUrl, type LocalLlmConfig } from "./localLlm";
import type { IntakeWorkerRequest, IntakeWorkerResponse, WorkerFileInput } from "./workerProtocol";

export type IntakeStageId = "inventory" | "junk" | "extract" | "cluster" | "classify" | "fields" | "stage" | "server" | "done";
export type IntakeProgress = {
  stage: IntakeStageId;
  done: number;
  total: number;
  counts: Partial<Record<"files" | "junk" | "excluded" | "catalogue" | "extracted" | "unreadable" | "clusters" | "classified" | "restricted" | "fields" | "extractions" | "duplicates", number>>;
  errors: Array<{ fileKey?: string; message: string }>;
  message?: string;
};

export type RunIntakeOptions = {
  societyId: string;
  name: string;
  hosted: boolean;
  llm?: LocalLlmConfig;
  /** Read scanned PDF pages and document images by OCR on this device, up to `pageBudget` pages. */
  ocr?: { pageBudget: number };
  mutation: MutationCaller;
  extractRun?: (args: { societyId: string; runId: string; budgetTokens?: number }) => Promise<any>;
  onRunCreated?: (runId: string) => void;
  onProgress: (progress: IntakeProgress) => void;
  signal?: AbortSignal;
};

export type RunIntakeResult = { runId: string; run: Omit<IntakeRunResult, "texts">; progress: IntakeProgress };

function fileKeyFor(relativePath: string) {
  return `local:${relativePath}`;
}

export async function runIntake(selection: IntakeSelection, options: RunIntakeOptions): Promise<RunIntakeResult> {
  const progress: IntakeProgress = { stage: "inventory", done: 0, total: selection.files.length, counts: { files: selection.files.length }, errors: [] };
  const emit = (patch: Partial<IntakeProgress>) => {
    Object.assign(progress, patch);
    options.onProgress({ ...progress, counts: { ...progress.counts }, errors: [...progress.errors] });
  };
  for (const file of selection.files) {
    const verdict = junkVerdict({ name: file.name, path: file.relativePath, sizeBytes: file.size });
    if (verdict.disposition === "junk") progress.counts.junk = (progress.counts.junk ?? 0) + 1;
    if (verdict.disposition === "excluded") progress.counts.excluded = (progress.counts.excluded ?? 0) + 1;
  }
  emit({ stage: "junk", done: selection.files.length, total: selection.files.length });

  const runId = String(await options.mutation("intake:createRun", {
    societyId: options.societyId,
    name: options.name,
    sourceKind: selection.sourceKind,
    sourceRoot: selection.root,
    settings: { origin: "in-app", runtime: options.hosted ? "hosted" : "local", fileCount: selection.files.length, llm: options.llm ? { provider: options.llm.provider, model: options.llm.modelId, budgetTokens: options.llm.budgetTokens } : null },
    engine: { minutes: options.hosted ? "server" : options.llm ? "llm+deterministic-fallback" : "deterministic", ...(options.llm ? { llm: { provider: options.llm.provider, model: options.llm.modelId } } : {}) },
  }));
  options.onRunCreated?.(runId);
  try {
    await options.mutation("intake:updateRun", { societyId: options.societyId, runId, patch: { status: "running", stats: { phase: "extracting", files: selection.files.length } } });
    const materialized = await materializeSelection(selection, (file) => keptByJunkFilter(file, { ocr: Boolean(options.ocr) }));
    const inputs: WorkerFileInput[] = materialized.files.map((file) => ({
      fileKey: fileKeyFor(file.relativePath), name: file.name, path: file.relativePath, sizeBytes: file.size,
      ...(file.lastModified ? { modifiedTime: new Date(file.lastModified).toISOString() } : {}), mimeType: file.type || undefined, file: file.file,
    }));
    const result = await runWorker(inputs, {
      name: options.name, sourceKind: selection.sourceKind, sourceRoot: selection.root, fieldExtraction: !options.hosted,
      ...(options.ocr ? { ocr: { pageBudget: options.ocr.pageBudget, workers: 1 } } : {}),
      ...(options.llm && !options.hosted ? { llm: { provider: options.llm.provider, modelId: options.llm.modelId, apiKey: options.llm.apiKey, baseUrl: providerBaseUrl(options.llm), budgetTokens: options.llm.budgetTokens, concurrency: options.llm.concurrency } } : {}),
    }, (stage, done, total) => {
      if (stage === "ocr") emit({ stage: "extract", message: `Reading scanned pages by OCR on this device: ${done} of up to ${total} pages.` });
      else emit({ stage: stage === "fields" ? "fields" : "extract", done, total, ...(stage === "fields" ? { message: undefined } : {}) });
    }, options.signal);
    const { run, extracts, coverage } = result;
    const counts = progress.counts;
    counts.junk = run.files.filter((file) => file.disposition === "junk").length;
    counts.excluded = run.files.filter((file) => file.disposition === "excluded").length;
    counts.catalogue = run.files.filter((file) => file.disposition === "catalogue").length;
    counts.duplicates = run.files.filter((file) => file.disposition === "duplicate").length;
    counts.extracted = Object.values(extracts).filter((extract) => extract.text.trim()).length;
    counts.unreadable = run.files.filter((file) => /^Extraction failed|Bytes not available/.test(file.dispositionReason ?? "")).length;
    counts.clusters = run.clusters.length;
    counts.classified = run.files.filter((file) => file.classification).length;
    counts.restricted = run.files.filter((file) => file.sensitivity === "restricted").length;
    counts.extractions = run.extractions.length;
    for (const file of run.files) {
      if (/^Extraction failed/.test(file.dispositionReason ?? "")) progress.errors.push({ fileKey: file.fileKey, message: file.dispositionReason! });
    }
    emit({ stage: "cluster", done: run.clusters.length, total: run.clusters.length });
    emit({ stage: "classify", done: counts.classified ?? 0, total: run.files.length });

    // Originals stay on this device for the review viewer (and become document versions on promotion).
    const bySha = new Map<string, WorkerFileInput>();
    for (const file of run.files) {
      if (!file.sha256 || file.disposition === "junk" || file.disposition === "excluded") continue;
      const input = inputs.find((candidate) => candidate.fileKey === file.fileKey);
      if (input && input.file.size) bySha.set(file.sha256, input);
    }
    for (const [sha256, input] of bySha) await putOriginal({ sha256, blob: input.file, name: input.name, mimeType: input.mimeType, size: input.file.size });

    emit({ stage: "stage", done: 0, total: run.files.length });
    await stageRunInWorkspace(options.mutation, options.societyId, run as IntakeRunResult, extracts, coverage, {
      runId,
      status: options.hosted ? "running" : "extracted",
      onProgress: (_stage, done, total) => emit({ stage: "stage", done, total }),
    });
    const stats = { phase: options.hosted ? "server_extraction" : "done", files: run.files.length, extractions: run.extractions.length, clusters: run.clusters.length, counts, errors: progress.errors.slice(0, 50) };
    await options.mutation("intake:updateRun", { societyId: options.societyId, runId, patch: { stats } });

    if (options.hosted && options.extractRun) {
      const serverTotal = run.files.filter((file) => file.disposition === "extract").length;
      emit({ stage: "server", done: 0, total: serverTotal, message: "Extracting fields on the server (workspace AI settings, deterministic fallback)…" });
      // The server extracts in batches (each call skips files already extracted); call until none remain.
      let extracted = 0, tokensUsed = 0;
      const serverStats: Record<string, number> = {};
      for (let round = 0; round < 200; round++) {
        if (options.signal?.aborted) throw new DOMException("The intake run was cancelled.", "AbortError");
        const outcome = await options.extractRun({ societyId: options.societyId, runId });
        extracted += Number(outcome?.files ?? 0);
        tokensUsed += Number(outcome?.tokensUsed ?? 0);
        for (const [key, value] of Object.entries((outcome?.stats ?? {}) as Record<string, number>)) serverStats[key] = (serverStats[key] ?? 0) + value;
        emit({ stage: "server", done: extracted, total: serverTotal, message: "Extracting fields on the server (workspace AI settings, deterministic fallback)…" });
        if (!outcome?.files || !outcome?.remaining) break;
      }
      const reconciled = await options.mutation("intake:reconcileRun", { societyId: options.societyId, runId });
      counts.extractions = extracted || counts.extractions;
      await options.mutation("intake:updateRun", { societyId: options.societyId, runId, patch: { stats: { ...stats, phase: "done", server: serverStats, tokensUsed, recordGaps: reconciled?.recordGaps } } });
      emit({ stage: "server", done: progress.total, total: progress.total, message: undefined });
    }
    emit({ stage: "done", done: 1, total: 1 });
    return { runId, run, progress };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.errors.push({ message });
    emit({});
    await options.mutation("intake:appendProcessingLog", { societyId: options.societyId, runId, entries: [{ atISO: new Date().toISOString(), stage: "bundle", sentToProvider: false, note: `Run failed: ${message.slice(0, 900)}` }] }).catch(() => undefined);
    await options.mutation("intake:updateRun", { societyId: options.societyId, runId, patch: { status: "failed", stats: { phase: "failed", error: message.slice(0, 500), counts: progress.counts } } }).catch(() => undefined);
    throw error;
  }
}

function runWorker(
  files: WorkerFileInput[],
  options: Extract<IntakeWorkerRequest, { type: "run" }>["options"],
  onProgress: (stage: string, done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Extract<IntakeWorkerResponse, { type: "result" }>> {
  const worker = new Worker(new URL("./intake.worker.ts", import.meta.url), { type: "module", name: "societyer-intake" });
  const convert = desktopLegacyConverter();
  return new Promise((resolve, reject) => {
    const stop = () => {
      worker.terminate();
      reject(new DOMException("The intake run was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<IntakeWorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") onProgress(message.stage, message.done, message.total);
      else if (message.type === "convert") {
        void (async () => {
          const bytes = convert ? await convert({ fileName: message.name, bytes: message.bytes, target: message.target }).catch(() => null) : null;
          worker.postMessage({ type: "convertResult", id: message.id, bytes } satisfies IntakeWorkerRequest, bytes ? [bytes] : []);
        })();
      } else if (message.type === "result") {
        signal?.removeEventListener("abort", stop);
        worker.terminate();
        resolve(message);
      } else if (message.type === "error") {
        signal?.removeEventListener("abort", stop);
        worker.terminate();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      reject(new Error(event.message || "The intake worker failed."));
    };
    worker.postMessage({ type: "run", files, canConvertLegacy: Boolean(convert), options } satisfies IntakeWorkerRequest);
  });
}
