/** The intake pipeline orchestrator (inventory → junk → extract → cluster →
 * classify → field extraction → verify → reconcile). Runtime-neutral: hosts
 * inject file reading, hashing, text extraction and (optionally) an LLM. */
import type { IntakeExtract } from "./blocks";
import type { IntakeFileRecord, IntakeExtractionResult, IntakeRunResult } from "./bundle";
import { classifyPrior } from "./classify";
import { clusterFiles } from "./cluster";
import { buildDirectoryFromOccurrences, resolvePerson } from "./entities";
import { EXTRACTABLE_EXTENSIONS, extensionOf } from "./extract";
import { junkVerdict } from "./junk";
import { extractWithLlm, mapWithConcurrency, TokenBudget, type GenerateObjectFn } from "./llm";
import { extractMeetingMinutes } from "./minutes/extractMinutes";
import { detectPii, sensitivityFor, type ProcessingLogEntry } from "./privacy";
import { reconcileExtractions } from "./reconcile";
import { validateExtraction } from "./schemas";
import { verifyRecord } from "./verify";

export { reconcileExtractions };

export type PipelineSourceFile = Omit<IntakeFileRecord, "disposition" | "classification" | "sensitivity" | "clusterKey" | "extractMethod" | "textLength"> & {
  read?: () => Promise<Uint8Array | null>;
};
export type PipelineOptions = {
  runId?: string;
  name: string;
  sourceKind: IntakeRunResult["sourceKind"];
  sourceRoot: string;
  extract: (file: PipelineSourceFile, bytes: Uint8Array) => Promise<IntakeExtract>;
  hash?: (bytes: Uint8Array) => string | Promise<string>;
  llm?: { generate: GenerateObjectFn; provider: string; model: string; budgetTokens: number; concurrency: number };
  concurrency?: number;
  onProgress?: (stage: string, done: number, total: number) => void;
  keepExtracts?: boolean;
  /** false: stop after classification (hosted runs extract fields server-side with intakeActions:extractRun). */
  fieldExtraction?: boolean;
};
export type PipelineOutput = IntakeRunResult & { extracts: Record<string, IntakeExtract> };

const MINUTES_LIKE = new Set(["meetingMinutes"]);

export async function runIntakePipeline(sourceFiles: PipelineSourceFile[], options: PipelineOptions): Promise<PipelineOutput> {
  const now = () => new Date().toISOString();
  const runId = options.runId ?? `intake-${now().replace(/[:.]/g, "-")}`;
  const log: ProcessingLogEntry[] = [];
  const startedAtISO = now();
  // 1. Junk filter.
  const files: Array<IntakeFileRecord & { read?: PipelineSourceFile["read"] }> = sourceFiles.map((file) => {
    const verdict = junkVerdict(file);
    const disposition = verdict.disposition === "keep" ? (EXTRACTABLE_EXTENSIONS.has(extensionOf(file.name)) ? "extract" : "catalogue") : verdict.disposition;
    if (verdict.disposition !== "keep") log.push({ atISO: now(), fileKey: file.fileKey, stage: "junk", sentToProvider: false, note: verdict.reason });
    return { ...file, disposition, ...(verdict.reason ? { dispositionReason: verdict.reason } : disposition === "catalogue" ? { dispositionReason: `No text extractor for .${extensionOf(file.name) || "(none)"}` } : {}) };
  });
  // 2. Acquire and extract text + layout.
  const extracts: Record<string, IntakeExtract> = {};
  const texts: Record<string, string> = {};
  const toExtract = files.filter((file) => file.disposition === "extract");
  let done = 0;
  await mapWithConcurrency(toExtract, options.concurrency ?? 2, async (file) => {
    try {
      const bytes = file.read ? await file.read() : null;
      if (!bytes) {
        file.acquisitionStatus = "failed";
        file.disposition = "pending";
        file.dispositionReason = "Bytes not available (not downloaded).";
        return;
      }
      if (!file.sha256 && options.hash) file.sha256 = await options.hash(bytes);
      file.sizeBytes ??= bytes.byteLength;
      const verdict = junkVerdict(file);
      if (verdict.disposition === "junk") {
        file.disposition = "junk";
        file.dispositionReason = verdict.reason;
        return;
      }
      const extract = await options.extract(file, bytes);
      file.extractMethod = extract.method;
      file.textLength = extract.text.length;
      if (extract.method === "unsupported" || !extract.text.trim()) {
        file.disposition = "catalogue";
        file.dispositionReason = extract.warnings[0] ?? "No extractable text (scan without OCR?).";
      }
      extracts[file.fileKey] = extract;
      texts[file.fileKey] = extract.text;
      log.push({ atISO: now(), fileKey: file.fileKey, stage: "extract", sentToProvider: false, note: `${extract.method}; ${extract.text.length} chars${extract.warnings.length ? `; ${extract.warnings.join(" ")}` : ""}` });
    } catch (error) {
      file.acquisitionStatus = file.acquisitionStatus === "listed" ? "failed" : file.acquisitionStatus;
      file.disposition = "catalogue";
      file.dispositionReason = `Extraction failed: ${error instanceof Error ? error.message : String(error)}`;
      log.push({ atISO: now(), fileKey: file.fileKey, stage: "extract", sentToProvider: false, note: file.dispositionReason });
    } finally {
      options.onProgress?.("extract", ++done, toExtract.length);
    }
  });
  // 3. Cluster (exact, near-duplicate, version, package-embedded).
  const live = files.filter((file) => file.disposition !== "junk" && file.disposition !== "excluded");
  const clusters = clusterFiles(live.map((file) => ({ id: file.fileKey, name: file.name, path: file.path, sha256: file.sha256, text: texts[file.fileKey], sizeBytes: file.sizeBytes })));
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      const file = files.find((candidate) => candidate.fileKey === member.fileId);
      if (!file) continue;
      file.clusterKey = cluster.clusterKey;
      if ((member.relation === "identical" || member.relation === "format-copy") && file.disposition === "extract") {
        file.disposition = "duplicate";
        file.dispositionReason = `${member.relation} of ${cluster.canonicalId}`;
      }
    }
  }
  log.push({ atISO: now(), stage: "cluster", sentToProvider: false, note: `${clusters.length} clusters` });
  // 4. Classify (deterministic priors) + sensitivity.
  for (const file of live) {
    const head = texts[file.fileKey]?.slice(0, 3000);
    file.classification = classifyPrior({ name: file.name, path: file.path, headText: head });
    const findings = texts[file.fileKey] ? detectPii(texts[file.fileKey].slice(0, 200000)) : [];
    file.sensitivity = sensitivityFor({ restrictedClass: file.classification.restricted, findings });
    if (file.sensitivity === "restricted" && file.disposition === "extract" && !MINUTES_LIKE.has(file.classification.docClass)) {
      file.dispositionReason = file.classification.restrictedReason ?? "Restricted personal data";
    }
  }
  log.push({ atISO: now(), stage: "classify", sentToProvider: false, note: `${live.length} files classified (deterministic priors)` });
  // 5–6. Field extraction (LLM when configured, deterministic otherwise) + span verification.
  const budget = options.llm ? new TokenBudget(options.llm.budgetTokens) : undefined;
  const targets = options.fieldExtraction === false ? [] : files.filter((file) => file.disposition === "extract" && file.classification && MINUTES_LIKE.has(file.classification.docClass) && extracts[file.fileKey]);
  const extractions: IntakeExtractionResult[] = [];
  done = 0;
  await mapWithConcurrency(targets, options.llm?.concurrency ?? 4, async (file) => {
    const extract = extracts[file.fileKey];
    let envelope: IntakeExtractionResult | undefined;
    if (options.llm) {
      const result = await extractWithLlm({ fileId: file.fileKey, fileName: file.name, docClass: "meetingMinutes", extract, restricted: file.sensitivity === "restricted" && Boolean(file.classification?.restricted), generate: options.llm.generate, provider: options.llm.provider, model: options.llm.model, budget }).catch((error) => ({ log: [{ atISO: now(), fileKey: file.fileKey, stage: "llm_skipped" as const, sentToProvider: true, note: `Provider error: ${error instanceof Error ? error.message : String(error)}` }], envelope: undefined, verification: undefined }));
      log.push(...result.log);
      if (result.envelope && validateExtraction(result.envelope).ok) envelope = { ...result.envelope, verification: result.verification, fileKey: file.fileKey };
    }
    if (!envelope) {
      const deterministic = extractMeetingMinutes({ fileId: file.fileKey, fileName: file.name, path: file.path, extract });
      const verification = verifyRecord(deterministic.record, extract);
      envelope = { ...deterministic, verification, fileKey: file.fileKey };
      log.push({ atISO: now(), fileKey: file.fileKey, stage: "extract_fields", sentToProvider: false, note: `deterministic; ${verification.verified + verification.fuzzy}/${verification.quoted} quotes verified` });
    }
    extractions.push(envelope);
    options.onProgress?.("fields", ++done, targets.length);
  });
  extractions.sort((a, b) => a.fileKey.localeCompare(b.fileKey));
  // 7. Entity resolution within the run: a directory bootstrapped from attendance lists,
  // then short references ("Avery", "T. Marsh", initials) resolved per document.
  const allNames = extractions.flatMap((extraction) => ((extraction.record as any).attendance ?? []).map((entry: any) => entry.nameAsWritten?.value).filter(Boolean));
  const directory = buildDirectoryFromOccurrences(allNames);
  const occurrences = new Map<string, number>();
  for (const extraction of extractions) {
    const record = extraction.record as any;
    const contextNames = (record.attendance ?? []).map((entry: any) => entry.nameAsWritten?.value).filter(Boolean);
    const link = (name: string | undefined) => {
      if (!name) return undefined;
      const resolution = resolvePerson(name, directory, { contextNames });
      if (resolution.status !== "matched") return undefined;
      occurrences.set(resolution.personId!, (occurrences.get(resolution.personId!) ?? 0) + 1);
      return resolution.personId;
    };
    for (const entry of record.attendance ?? []) {
      const key = link(entry.nameAsWritten?.value);
      if (key) entry.personKey = key;
    }
    const people = [record.chair, record.recorder, ...(record.motions ?? []).flatMap((motion: any) => [motion.movedBy, motion.secondedBy]), ...(record.sections ?? []).map((section: any) => section.presenter)];
    for (const field of people) {
      if (!field?.value) continue;
      const key = link(field.value.resolvedName ?? field.value.nameAsWritten);
      if (key) field.value.personKey = key;
    }
  }
  // 8. Reconcile.
  const { reconciled, carry, gaps } = reconcileExtractions(files, extractions);
  log.push({ atISO: now(), stage: "bundle", sentToProvider: false, note: `${reconciled.meetings.length} meetings reconciled; ${gaps.length} record gaps` });
  return {
    runId,
    name: options.name,
    sourceKind: options.sourceKind,
    sourceRoot: options.sourceRoot,
    startedAtISO,
    completedAtISO: now(),
    engine: { minutes: options.llm ? "llm+deterministic-fallback" : "deterministic", ...(options.llm ? { llm: { provider: options.llm.provider, model: options.llm.model } } : {}) },
    files: files.map(({ read: _read, ...file }) => file),
    clusters,
    extractions,
    reconciliation: { meetings: reconciled.meetings, links: [...reconciled.links, ...carry.links], gaps, actionChains: carry.chains },
    processingLog: log,
    people: directory.map((person) => ({ id: person.id, fullName: person.fullName, aliases: person.aliases ?? [], occurrences: occurrences.get(person.id) ?? 0 })),
    texts,
    extracts: options.keepExtracts === false ? {} : extracts,
  };
}

