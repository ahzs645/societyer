/** Deployment-operator tool. No new ingestion token or public write endpoint. */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validateExport, validateDelta, archiveEligible } from "./verify-export";
const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const deployment = value("--deployment");
const input = value("--input");
if (!deployment || !input)
  throw new Error(
    "Usage: npx tsx scripts/procurement/apply-convex.ts --deployment NAME --input PRIVATE_EXPORT_DIRECTORY [--dry-run|--activate-only]",
  );
// This entire preflight happens before the first network request or import lock.
const verified = await validateExport(input);
const activation = verified.activation;
const restoreBackup = value("--restore-backup");
if (activation.restoration && !restoreBackup) throw new Error("A deliberate restore requires --restore-backup ORIGINAL_BACKUP_ZIP; normal publications cannot silently activate a restored catalog.");
if (restoreBackup) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(resolve(restoreBackup))) digest.update(chunk);
  if (!activation.restoration || digest.digest("hex") !== activation.restoration.backupSha256) throw new Error("Restore backup integrity mismatch.");
}
const archive = resolve(input, "metadata.zip");
if (!existsSync(archive)) throw new Error("Metadata archive not found.");
function run(command: string[], json = false): any {
  // Pass JSON over stdin: large detail rows must not hit the OS argv limit.
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("convex/package.json");
  const cliPath = join(
    dirname(pkgPath),
    JSON.parse(readFileSync(pkgPath, "utf8")).bin.convex,
  );
  const runner =
    'const fs=require("node:fs"); const a=JSON.parse(fs.readFileSync(0,"utf8")); process.argv=[process.execPath,a[0],...a.slice(1)]; require(a[0]);';
  const result = spawnSync(process.execPath, ["-e", runner], {
    input: JSON.stringify([cliPath, ...command, "--deployment", deployment!]),
    encoding: "utf8",
    stdio: json ? "pipe" : ["pipe", "inherit", "inherit"],
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      json
        ? result.stderr || "Convex command failed"
        : "Convex command failed. The active generation is unchanged; inspect the import before retrying.",
    );
  return json ? JSON.parse(result.stdout) : undefined;
}
const deltaPath = resolve(input, "delta-manifest.json");
const delta = existsSync(deltaPath)
  ? JSON.parse(readFileSync(deltaPath, "utf8"))
  : null;
const baselineDirectory = value("--baseline");
if (delta && !baselineDirectory) throw new Error("Incremental import requires --baseline LAST_SUCCESSFUL_EXPORT for independent inventory validation.");
const verifiedDelta = delta ? await validateDelta(input, baselineDirectory!, verified) : null;
if (args.includes("--dry-run")) {
  console.log(JSON.stringify({deployment,generation:activation.generation,expected:activation.expected,inventoryHash:activation.inventoryHash,coverage:activation.coverage,delta:verifiedDelta?.delta ?? null,action:"Verified all files, archives, relationships and exact delta locally; no network requests or serving mutations."},null,2));
  process.exit(0);
}
let jobId: string | undefined, activeRun: {runId:string;planHash:string} | undefined;
const receipt = (state: "ready"|"failed", served?:any, error?:string) => {
  const path = resolve(input,"serving-receipt.json"), temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary,JSON.stringify({schemaVersion:1,publicationId:activation.publicationId ?? activation.sourceSnapshotId,sourceSnapshotId:activation.sourceSnapshotId,generation:activation.generation,inventoryHash:activation.inventoryHash,state,heartbeatAt:new Date().toISOString(),...(state === "ready" ? {activatedAt:new Date(served?.activatedAt ?? Date.now()).toISOString()} : {}),...(error ? {error:error.slice(0,2000)} : {})})+"\n",{mode:0o600});
  renameSync(temporary,path);
};
const servingState = () => run(["run","procurementImport:state",JSON.stringify({societyId:activation.societyId})],true);
try {
const prior = run(
  [
    "run",
    "procurementImport:state",
    JSON.stringify({ societyId: activation.societyId }),
  ],
  true,
);
const unchanged =
  activation.profileVersion === 2 &&
  prior?.profileVersion === 2 &&
  prior.folder === activation.folder &&
  prior.contentHash === activation.contentHash;
if (prior && !prior.updating && prior.folder === activation.folder && prior.generation === activation.generation && prior.contentHash === activation.contentHash && (prior.inventoryHash === activation.inventoryHash || restoreBackup)) {
  receipt("ready",prior);
  console.log("The verified publication is already serving; no rows or activation timestamps changed.");
  process.exit(0);
}
if (!delta && prior && !unchanged && !restoreBackup && !archiveEligible(activation)) throw new Error("Replacing an active catalog requires explicitly complete source/window coverage; use a verified non-removing delta for partial collections.");
if (delta) {
  if (
    delta.formatVersion !== 2 ||
    delta.societyId !== activation.societyId ||
    delta.folder !== activation.folder ||
    delta.targetContentHash !== activation.contentHash
  )
    throw new Error("Invalid delta target.");
  const hash = createHash("sha256");
  let count = 0;
  for await (const line of createInterface({
    input: createReadStream(resolve(input, "delta.jsonl")),
    crlfDelay: Infinity,
  })) {
    JSON.parse(line);
    hash.update(line + "\n");
    count++;
  }
  if (hash.digest("hex") !== delta.sha256 || count !== delta.operations)
    throw new Error("Delta integrity failure.");
  if (
    prior?.contentHash === delta.targetContentHash &&
    prior?.generation === activation.generation
  ) {
    receipt("ready",prior);
    console.log(
      "Delta already activated; no row imports or catalog scans.",
    );
    process.exit(0);
  }
}
jobId = run(["run","procurementImport:beginJob",JSON.stringify({societyId:activation.societyId,folder:activation.folder,generation:activation.generation,inventoryHash:activation.inventoryHash,contentHash:activation.contentHash,publishedAt:activation.publishedAt,collectedAt:activation.collectedAt,complete:archiveEligible(activation),...(delta ? {planHash:delta.sha256} : {})})],true);
const progressJob = (phase: "taxonomy"|"importing"|"activating",runId?:string) => run(["run","procurementImport:jobProgress",JSON.stringify({jobId,phase,...(runId ? {runId} : {})})]);
if (unchanged && !delta) {
  run([
    "run",
    "procurementImport:commit",
    JSON.stringify({ ...activation, reuseActive: true }),
  ]);
  receipt("ready",servingState());
  console.log(
    `Unchanged hosted content: reused ${prior.generation}; no row import or catalog scan.`,
  );
  process.exit(0);
}
for (const index of activation.taxonomyIndexes ?? []) {
  progressJob("taxonomy");
  const scope = { societyId: activation.societyId, ...index };
  const action = run(
    [
      "run",
      "procurementImport:beginTaxonomy",
      JSON.stringify({ ...scope, folder: activation.folder }),
    ],
    true,
  );
  if (action === "reuse") {
    console.log(
      `Reused verified taxonomy ${index.releaseId} (${index.count} terms).`,
    );
    continue;
  }
  if (action === "resume" && !args.includes("--activate-only"))
    throw new Error(
      "Taxonomy import is already reserved. Check its previous import, then retry --activate-only to verify it without appending duplicates.",
    );
  if (action === "import") {
    if (!/^[a-f0-9]{64}$/.test(index.contentHash))
      throw new Error("Invalid taxonomy content hash.");
    const termsArchive = resolve(input, `taxonomy-${index.contentHash}.zip`);
    if (!existsSync(termsArchive)) throw new Error("Taxonomy archive missing.");
    run(["import", "--append", termsArchive]);
  }
  run(["run", "procurementTaxonomy:finishTaxonomy", JSON.stringify(scope)]);
}
if (delta) {
  const scope = {
    societyId: activation.societyId,
    folder: activation.folder,
    baseHash: delta.baseContentHash,
    targetHash: delta.targetContentHash,
    planHash: delta.sha256,
    operations: delta.operations,
    baseInventoryHash: delta.baseInventoryHash, targetInventoryHash: delta.targetInventoryHash,
    baseExpected: verifiedDelta!.baseline.expected, expected: activation.expected,
    targetGeneration: activation.generation, publishedAt: activation.publishedAt, collectedAt: activation.collectedAt,
    allowArchives: archiveEligible(activation),
  };
  let progress = run(
    ["run", "procurementSync:begin", JSON.stringify(scope)],
    true,
  );
  activeRun = {runId:progress.runId,planHash:delta.sha256};
  progressJob("importing",progress.runId);
  let batch = 0,
    pending: any[] = [],
    bytes = 0;
  const flush = () => {
    if (!pending.length) return;
    if (batch >= progress.nextBatch) {
      const result = run(
        [
          "run",
          "procurementSync:applyBatch",
          JSON.stringify({
            runId: progress.runId,
            planHash: delta.sha256,
            batch,
            operations: pending,
          }),
        ],
        true,
      );
      progress = { ...progress, ...result };
      progressJob("importing",progress.runId);
      console.log(
        `Incremental import: ${progress.applied}/${delta.operations} changed rows`,
      );
    }
    batch++;
    pending = [];
    bytes = 0;
  };
  for await (const line of createInterface({
    input: createReadStream(resolve(input, "delta.jsonl")),
    crlfDelay: Infinity,
  })) {
    const raw = JSON.parse(line);
    const op = {
      ...raw,
      row: raw.row === null ? null : JSON.stringify(raw.row),
      before: raw.before === null ? null : JSON.stringify(raw.before),
    };
    const size = JSON.stringify(op).length;
    if (pending.length && (pending.length >= 40 || bytes + size > 900000))
      flush();
    pending.push(op);
    bytes += size;
  }
  flush();
  const {
    generation,
    publishedAt,
    counts,
    sourceCounts,
    sourceSnapshotId,
    sourceCatalogSha256,
    taxonomyIndexes = [],
  } = activation;
  run([
    "run",
    "procurementSync:finish",
    JSON.stringify({
      runId: progress.runId,
      planHash: delta.sha256,
      generation,
      publishedAt,
      counts,
      sourceCounts,
      sourceSnapshotId,
      sourceCatalogSha256,
      taxonomyIndexes,
      publicationId: activation.publicationId, schemaVersion: activation.schemaVersion, tables: activation.tables, inventoryHash: activation.inventoryHash,
      archives: activation.archives, coverage: activation.coverage, collectedAt: activation.collectedAt,
    }),
  ]);
  receipt("ready",servingState());
  console.log(
    `Activated incremental publication ${generation}; full source archives retained.`,
  );
  process.exit(0);
}
if (!args.includes("--activate-only")) {
  progressJob("importing");
  for (const table of [
    "procurementRecords",
    "procurementDetails",
    "procurementDocuments",
    "procurementEvidence",
  ]) {
    const first = run(
      [
        "run",
        "procurementImport:countPage",
        JSON.stringify({
          societyId: activation.societyId,
          generation: activation.generation,
          table,
          cursor: null,
        }),
      ],
      true,
    );
    if (first.count)
      throw new Error(
        `This generation already contains ${table}. Refusing to append duplicates. If its import completed, rerun with --activate-only.`,
      );
  }
  run(["import", "--append", archive]);
}
progressJob("activating");
run(["run", "procurementImport:activate", JSON.stringify({...activation,...(restoreBackup ? {restoreFromBackup:activation.restoration.backupSha256} : {})})]);
receipt("ready",servingState());
console.log(`Activated ${activation.generation} for ${activation.societyId}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // A response may be lost after activation commits. Reconcile its durable outcome first.
  try {
    const served = servingState();
    if (served && !served.updating && served.generation === activation.generation && served.contentHash === activation.contentHash && served.inventoryHash === activation.inventoryHash) {
      receipt("ready",served);
      console.log(`Confirmed activated publication ${activation.generation} after an ambiguous response.`);
      process.exit(0);
    }
  } catch { /* A later exact retry can reconcile a temporarily unreachable server. */ }
  if (activeRun) try { run(["run","procurementSync:fail",JSON.stringify({...activeRun,error:message.slice(0,2000)})]); } catch { /* The durable heartbeat still exposes a stalled run after network failure. */ }
  if (jobId) try { run(["run","procurementImport:jobProgress",JSON.stringify({jobId,phase:"failed",error:message.slice(0,2000)})]); } catch { /* Preserve the primary failure and exact export for recovery. */ }
  receipt("failed",undefined,message);
  throw error;
}
