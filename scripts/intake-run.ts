/** AI-led intake pipeline CLI (inventory → extract → cluster → classify →
 * extract fields → verify → reconcile → bundle).
 *
 *   # A local folder (recursively)
 *   npx tsx scripts/intake-run.ts <folder> --out <dir> [--name "Society records"]
 *
 *   # The repo's Drive inventory format (scripts/inventory-public-drive.py),
 *   # with downloaded files under --files-root/<driveId>/<file> or entry.localPath
 *   npx tsx scripts/intake-run.ts --drive-inventory inventory.json --files-root <dir> --out <dir>
 *
 *   # Schema-constrained LLM extraction (falls back to the deterministic engine per file)
 *   OPENAI_API_KEY=… npx tsx scripts/intake-run.ts <folder> --out <dir> --llm openai --model gpt-4.1-mini \
 *     --budget-tokens 2000000 --llm-concurrency 4
 *   OPENROUTER_API_KEY=… … --llm openrouter --model openai/gpt-4.1-mini
 *
 *   # Re-runs of a large archive: reuse text/layout extracts by content hash
 *   npx tsx scripts/intake-run.ts <folder> --out <dir> --extract-cache <dir>
 *
 *   # JSON Schema for offline agents
 *   npx tsx scripts/intake-run.ts --export-schemas <dir>
 *
 * Outputs (in --out, which must be outside the repository for real records):
 *   run.json            files, clusters, extractions with locators, reconciliation, record gaps
 *   bundle.json         import bundle (Pending review) incl. representationGaps
 *   coverage.json       native coverage per class / body / year + record gaps
 *   processing-log.json which file went to which provider (privacy log)
 *   extracts/*.json     text + layout blocks per file (locator targets)
 */
import fs from "node:fs";
import path from "node:path";
import { buildImportBundle, coverageReport } from "../shared/intake/bundle";
import { libreOfficeConverter, md5Hex, sha256Hex } from "../shared/intake/node/extractFile";
import { extractBytes } from "../shared/intake/extract";
import { INTAKE_EXTRACT_VERSION } from "../shared/intake/blocks";
import type { GenerateObjectFn } from "../shared/intake/llm";
import { runIntakePipeline, type PipelineSourceFile } from "../shared/intake/pipeline";
import { exportIntakeJsonSchemas } from "../shared/intake/schemas";

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const has = (name: string) => args.includes(name);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (has("--export-schemas")) {
  const dir = flag("--export-schemas") ?? fail("--export-schemas needs a directory");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, schema] of Object.entries(exportIntakeJsonSchemas())) fs.writeFileSync(path.join(dir, `${name}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(exportIntakeJsonSchemas()).length} JSON Schemas to ${dir}`);
  process.exit(0);
}

const out = flag("--out") ?? fail("--out <dir> is required");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
if (path.resolve(out).startsWith(repoRoot + path.sep) && !has("--allow-in-repo")) fail("Refusing to write intake output inside the repository (real records must stay out of git). Pass --allow-in-repo for synthetic data.");
const limit = Number(flag("--limit") ?? Infinity);

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  visit(root);
  return out.sort();
}

let sourceFiles: PipelineSourceFile[] = [];
let sourceKind: "local_folder" | "drive_inventory" = "local_folder";
let sourceRoot = "";
const inventoryPath = flag("--drive-inventory");
if (inventoryPath) {
  sourceKind = "drive_inventory";
  sourceRoot = path.resolve(inventoryPath);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.entries)) fail("Not a Drive inventory (schemaVersion 1 with entries[]).");
  if (inventory.completeness && inventory.completeness !== "complete") console.warn(`Inventory completeness: ${inventory.completeness}${inventory.completenessNote ? ` — ${inventory.completenessNote}` : ""}`);
  const filesRoot = flag("--files-root");
  for (const entry of inventory.entries.filter((item: any) => item.kind === "file")) {
    const candidates = [
      entry.localPath ? path.resolve(path.dirname(inventoryPath), entry.localPath) : undefined,
      filesRoot ? path.join(filesRoot, entry.id) : undefined,
    ].filter(Boolean) as string[];
    let local: string | undefined;
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      local = fs.statSync(candidate).isDirectory() ? fs.readdirSync(candidate).map((name) => path.join(candidate, name)).find((file) => fs.statSync(file).isFile()) : candidate;
      if (local) break;
    }
    sourceFiles.push({
      fileKey: `google-drive:${entry.id}${entry.headRevisionId ? `@${entry.headRevisionId}` : ""}`,
      driveId: entry.id,
      revision: entry.headRevisionId,
      name: entry.name,
      path: entry.path ?? entry.name,
      mimeType: entry.mimeType,
      md5: entry.md5Checksum,
      sha256: entry.sha256,
      modifiedTime: entry.modifiedTime,
      url: `https://drive.google.com/file/d/${entry.id}/view`,
      ...(local ? { localPath: local } : {}),
      acquisitionStatus: local ? "downloaded" : "listed",
      read: local ? async () => new Uint8Array(fs.readFileSync(local!)) : undefined,
    });
  }
} else {
  const folder = args.find((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1].startsWith("--") && !["--allow-in-repo"].includes(args[index - 1]))) ?? fail("Pass a folder or --drive-inventory <inventory.json>.");
  sourceRoot = path.resolve(folder);
  for (const file of walk(sourceRoot)) {
    const relative = path.relative(sourceRoot, file).split(path.sep).join("/");
    const stat = fs.statSync(file);
    sourceFiles.push({
      fileKey: `local:${relative}`,
      name: path.basename(file),
      path: relative,
      sizeBytes: stat.size,
      modifiedTime: stat.mtime.toISOString(),
      localPath: file,
      acquisitionStatus: "local",
      read: async () => new Uint8Array(fs.readFileSync(file)),
    });
  }
}
if (Number.isFinite(limit)) sourceFiles = sourceFiles.slice(0, limit);

// Optional LLM engine (OpenAI / OpenRouter / OpenAI-compatible), the same providers the app uses.
let llm: Parameters<typeof runIntakePipeline>[1]["llm"];
const llmProvider = flag("--llm");
if (llmProvider) {
  const apiKey = llmProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) fail(`--llm ${llmProvider} needs ${llmProvider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} in the environment.`);
  const model = flag("--model") ?? process.env.SOCIETYER_AI_MODEL ?? (llmProvider === "openrouter" ? "openai/gpt-4.1-mini" : "gpt-4.1-mini");
  const baseURL = flag("--base-url") ?? (llmProvider === "openrouter" ? "https://openrouter.ai/api/v1" : process.env.OPENAI_BASE_URL);
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { makeGenerateObject } = await import("../shared/intake/aiGenerate");
  const openai = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const generate: GenerateObjectFn = makeGenerateObject(llmProvider === "openai" ? openai(model) : openai.chat(model));
  llm = { generate, provider: llmProvider, model, budgetTokens: Number(flag("--budget-tokens") ?? 2_000_000), concurrency: Number(flag("--llm-concurrency") ?? 4) };
}

const started = Date.now();
let lastProgress = 0;
const result = await runIntakePipeline(sourceFiles, {
  name: flag("--name") ?? path.basename(sourceRoot),
  sourceKind,
  sourceRoot,
  extract: async (file, bytes) => {
    // --extract-cache <dir>: text/layout extracts keyed by content hash and extractor version,
    // so re-running a large archive after an extractor fix skips PDF parsing and LibreOffice.
    const cacheDir = flag("--extract-cache");
    const cacheFile = cacheDir ? path.join(cacheDir, `${sha256Hex(bytes)}-${INTAKE_EXTRACT_VERSION.replace(/[^\w.-]+/g, "_")}-${path.extname(file.name).toLowerCase().replace(/[^\w.]/g, "")}.json`) : undefined;
    if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    const extract = await extractBytes(file.name, bytes, { convertLegacy: libreOfficeConverter });
    if (cacheFile) {
      fs.mkdirSync(cacheDir!, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(extract));
    }
    return extract;
  },
  hash: (bytes) => sha256Hex(bytes),
  llm,
  concurrency: Number(flag("--concurrency") ?? 2),
  onProgress: (stage, done, total) => {
    if (Date.now() - lastProgress > 3000 || done === total) {
      lastProgress = Date.now();
      process.stderr.write(`  ${stage}: ${done}/${total}\n`);
    }
  },
});
for (const file of result.files) if (!file.md5 && file.localPath && file.sizeBytes && file.sizeBytes < 200_000_000 && file.disposition !== "junk") file.md5 = md5Hex(new Uint8Array(fs.readFileSync(file.localPath)));

const build = buildImportBundle(result);
const coverage = coverageReport(result, build);
fs.mkdirSync(path.join(out, "extracts"), { recursive: true });
const { texts: _texts, extracts, ...runJson } = result;
fs.writeFileSync(path.join(out, "run.json"), `${JSON.stringify(runJson, null, 2)}\n`);
fs.writeFileSync(path.join(out, "bundle.json"), `${JSON.stringify(build.bundle, null, 2)}\n`);
fs.writeFileSync(path.join(out, "coverage.json"), `${JSON.stringify({ ...coverage, bundle: { issues: build.issues, stagedRecords: build.stagedRecords, meetingsBundled: build.meetingsBundled, minutesSkipped: build.minutesSkipped } }, null, 2)}\n`);
fs.writeFileSync(path.join(out, "processing-log.json"), `${JSON.stringify(result.processingLog, null, 2)}\n`);
for (const [fileKey, extract] of Object.entries(extracts)) {
  const safe = fileKey.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
  fs.writeFileSync(path.join(out, "extracts", `${safe}.json`), JSON.stringify({ fileKey, ...extract }));
}
const counts = result.files.reduce<Record<string, number>>((acc, file) => ({ ...acc, [file.disposition]: (acc[file.disposition] ?? 0) + 1 }), {});
const motions = result.extractions.reduce((sum, extraction) => sum + ((extraction.record as any).motions?.length ?? 0), 0);
console.log(JSON.stringify({
  files: result.files.length, dispositions: counts, clusters: result.clusters.length, minutesExtracted: result.extractions.length, motions,
  meetings: result.reconciliation.meetings.length, meetingsBundled: build.meetingsBundled, recordGaps: result.reconciliation.gaps.length,
  representationGaps: (build.bundle.representationGaps as unknown[]).length, stagedRecords: build.stagedRecords, bundleIssues: build.issues.length,
  nativeCoverage: coverage.headline.coverage, attendancePersonLinked: coverage.attendancePersonLinked, personRefsResolved: coverage.personRefsResolved, people: result.people?.length ?? 0, hallucinationRate: Number(coverage.hallucinationRate.toFixed(4)), seconds: Math.round((Date.now() - started) / 1000), out,
}, null, 2));
if (build.issues.length) console.warn(`Bundle preflight issues (first 10):\n${build.issues.slice(0, 10).map((issue) => `- ${issue}`).join("\n")}`);
