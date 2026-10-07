/** Stages a pipeline result (CLI or desktop run) into a workspace through the
 * portable `intake:*` mutations, in bounded batches. Works against hosted
 * Convex, the local runtime or a test PortableRuntime: the caller supplies
 * `mutation(name, args)`. */
import type { IntakeExtract } from "./blocks";
import type { IntakeRunResult } from "./bundle";
import type { CoverageReport } from "./bundle";

export type MutationCaller = (name: string, args: Record<string, unknown>) => Promise<any>;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

export type StageOptions = {
  /** Stage into a run created earlier (the in-app flow creates it first so progress is visible). */
  runId?: string;
  /** Final run status (default "extracted"); hosted runs stay "running" until server extraction finishes. */
  status?: string;
  onProgress?: (stage: string, done: number, total: number) => void;
};

export async function stageRunInWorkspace(mutation: MutationCaller, societyId: string, run: IntakeRunResult, extracts: Record<string, IntakeExtract>, coverage?: CoverageReport, options: StageOptions = {}): Promise<{ runId: string; files: number; extractions: number }> {
  const runId = options.runId ?? await mutation("intake:createRun", { societyId, name: run.name, sourceKind: run.sourceKind, sourceRoot: run.sourceRoot, engine: run.engine, settings: { pipelineRunId: run.runId } });
  const total = run.files.length + Object.keys(extracts).length + run.extractions.length;
  let done = 0;
  const tick = (count: number) => options.onProgress?.("stage", (done += count), total);
  for (const batch of chunks(run.files, 200)) {
    await mutation("intake:recordFiles", {
      societyId, runId,
      files: batch.map((file) => ({
        fileKey: file.fileKey, name: file.name, path: file.path, driveId: file.driveId, revision: file.revision, md5: file.md5, sha256: file.sha256, mimeType: file.mimeType,
        sizeBytes: file.sizeBytes, modifiedTime: file.modifiedTime, url: file.url, acquisitionStatus: file.acquisitionStatus, disposition: file.disposition,
        dispositionReason: file.dispositionReason, classification: file.classification, sensitivity: file.sensitivity, clusterKey: file.clusterKey,
      })),
    });
    tick(batch.length);
  }
  for (const [fileKey, extract] of Object.entries(extracts)) {
    await mutation("intake:saveExtract", { societyId, runId, fileKey, extract: { method: extract.method, methodVersion: extract.methodVersion, blocks: extract.blocks, text: extract.text, pageCount: extract.pageCount, sheetNames: extract.sheetNames, emptyPages: extract.emptyPages, warnings: extract.warnings } });
    tick(1);
  }
  for (const batch of chunks(run.clusters, 200)) await mutation("intake:saveClusters", { societyId, runId, clusters: batch });
  for (const extraction of run.extractions) {
    const { verification: _verification, fileKey, ...envelope } = extraction;
    await mutation("intake:saveExtraction", { societyId, runId, fileKey, extraction: envelope });
    tick(1);
  }
  for (const batch of chunks(run.processingLog, 400)) await mutation("intake:appendProcessingLog", { societyId, runId, entries: batch });
  await mutation("intake:updateRun", {
    societyId, runId,
    patch: {
      status: options.status ?? "extracted",
      stats: { files: run.files.length, extractions: run.extractions.length, clusters: run.clusters.length },
      recordGaps: run.reconciliation.gaps,
      reconciliation: { meetings: run.reconciliation.meetings, links: run.reconciliation.links.slice(0, 2000), actionChains: run.reconciliation.actionChains.slice(0, 500) },
      ...(coverage ? { coverage: { headline: coverage.headline, byClass: coverage.byClass, byBody: coverage.byBody, byYear: coverage.byYear, dispositions: coverage.dispositions, hallucinationRate: coverage.hallucinationRate } } : {}),
    },
  });
  return { runId, files: run.files.length, extractions: run.extractions.length };
}
