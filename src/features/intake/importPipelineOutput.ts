/** Stages the output folder of a command-line or desktop intake run
 * (`scripts/intake-run.ts`: run.json, coverage.json, extracts/*.json) into this
 * workspace through the same portable `intake:*` mutations an in-app run uses.
 * Large corpora (thousands of files, legacy Office formats converted with
 * LibreOffice) are processed on a workstation and reviewed here.
 *
 * Optionally the original source folder is chosen too: originals whose relative
 * path and size match a run file are cached on this device by SHA-256 for the
 * review viewer and for promotion (saved as document versions). */
import type { IntakeExtract } from "../../../shared/intake/blocks";
import type { CoverageReport, IntakeRunResult } from "../../../shared/intake/bundle";
import { stageRunInWorkspace, type MutationCaller } from "../../../shared/intake/stageRun";
import { putOriginal } from "./originalsCache";

export type PipelineOutputFiles = { run: File; coverage?: File; extracts: File[] };

function relativePath(file: File): string {
  return ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, "/");
}

/** Finds run.json, coverage.json and extracts/*.json in a chosen folder (any depth). */
export function pipelineOutputFiles(list: FileList | File[] | null | undefined): PipelineOutputFiles | { error: string } {
  const files = Array.from(list ?? []);
  const run = files.find((file) => /(^|\/)run\.json$/.test(relativePath(file)));
  if (!run) return { error: "This folder has no run.json. Choose the --out folder of an intake run." };
  const base = relativePath(run).replace(/run\.json$/, "");
  const coverage = files.find((file) => relativePath(file) === `${base}coverage.json`);
  const extracts = files.filter((file) => relativePath(file).startsWith(`${base}extracts/`) && file.name.endsWith(".json"));
  return { run, coverage, extracts };
}

export type ImportProgress = { stage: "read" | "originals" | "stage" | "done"; done: number; total: number; message?: string };

export async function importPipelineOutput(
  output: PipelineOutputFiles,
  options: { societyId: string; name?: string; mutation: MutationCaller; originals?: FileList | File[] | null; onProgress?: (progress: ImportProgress) => void },
): Promise<{ runId: string; files: number; extractions: number; originalsCached: number }> {
  const progress = (value: ImportProgress) => options.onProgress?.(value);
  progress({ stage: "read", done: 0, total: output.extracts.length + 1, message: "Reading run.json" });
  const run = JSON.parse(await output.run.text()) as IntakeRunResult;
  if (!run || !Array.isArray(run.files) || !Array.isArray(run.extractions) || !run.reconciliation) throw new Error("run.json is not an intake run (files, extractions and reconciliation are required).");
  const coverage = output.coverage ? (JSON.parse(await output.coverage.text()) as CoverageReport) : undefined;
  const extracts: Record<string, IntakeExtract> = {};
  let read = 0;
  for (const file of output.extracts) {
    const parsed = JSON.parse(await file.text()) as IntakeExtract & { fileKey?: string };
    if (parsed?.fileKey && Array.isArray(parsed.blocks)) {
      const { fileKey, ...extract } = parsed;
      extracts[fileKey] = extract as IntakeExtract;
    }
    if (++read % 50 === 0) progress({ stage: "read", done: read, total: output.extracts.length, message: "Reading extracts" });
  }

  let originalsCached = 0;
  const originals = Array.from(options.originals ?? []);
  if (originals.length) {
    // Match by path relative to the chosen folder (its own name is dropped) and by size.
    const byPath = new Map<string, File>();
    for (const file of originals) byPath.set(relativePath(file).split("/").slice(1).join("/"), file);
    const wanted = run.files.filter((file) => file.sha256 && file.disposition !== "junk" && file.disposition !== "excluded");
    let done = 0;
    const seen = new Set<string>();
    for (const file of wanted) {
      const original = byPath.get(file.path);
      if (original && (file.sizeBytes === undefined || original.size === file.sizeBytes) && !seen.has(file.sha256!)) {
        seen.add(file.sha256!);
        await putOriginal({ sha256: file.sha256!, blob: original, name: file.name, mimeType: file.mimeType || original.type || undefined, size: original.size });
        originalsCached++;
      }
      if (++done % 100 === 0) progress({ stage: "originals", done, total: wanted.length, message: "Caching originals on this device" });
    }
  }

  const staged = await stageRunInWorkspace(options.mutation, options.societyId, { ...run, name: options.name?.trim() || run.name }, extracts, coverage, {
    onProgress: (_stage, done, total) => progress({ stage: "stage", done, total, message: "Saving the run to this workspace" }),
  });
  await options.mutation("intake:updateRun", {
    societyId: options.societyId,
    runId: staged.runId,
    patch: { stats: { phase: "done", origin: "pipeline-output", files: run.files.length, extractions: run.extractions.length, clusters: run.clusters.length, originalsCached } },
  });
  progress({ stage: "done", done: 1, total: 1 });
  return { ...staged, originalsCached };
}
