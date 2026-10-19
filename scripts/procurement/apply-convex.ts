/** Deployment-operator tool. No new ingestion token or public write endpoint. */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
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
const activation = JSON.parse(
  readFileSync(resolve(input, "activation.json"), "utf8"),
);
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
if (delta) {
  if (
    delta.formatVersion !== 1 ||
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
  if (args.includes("--dry-run")) {
    console.log(
      JSON.stringify(
        {
          delta,
          action:
            "Apply changed rows only; retain archived rows and original snapshots",
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  if (
    prior?.contentHash === delta.targetContentHash &&
    prior?.generation === activation.generation
  ) {
    console.log(
      "Delta already activated; no row imports or catalog scans.",
    );
    process.exit(0);
  }
}
if (args.includes("--dry-run")) {
  console.log(
    JSON.stringify(
      {
        deployment,
        generation: activation.generation,
        expected: activation.expected,
        taxonomyTerms: activation.taxonomyCount ?? 0,
        unchanged,
        action: unchanged
          ? "Reuse active generation; update publication metadata only"
          : "Import compact generation, verify counts, activate; retain previous generation",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (unchanged && !delta) {
  run([
    "run",
    "procurementImport:commit",
    JSON.stringify({ ...activation, generation: prior.generation }),
  ]);
  console.log(
    `Unchanged hosted content: reused ${prior.generation}; no row import or catalog scan.`,
  );
  process.exit(0);
}
for (const index of activation.taxonomyIndexes ?? []) {
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
  };
  let progress = run(
    ["run", "procurementSync:begin", JSON.stringify(scope)],
    true,
  );
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
    }),
  ]);
  console.log(
    `Activated incremental publication ${generation}; full source archives retained.`,
  );
  process.exit(0);
}
if (!args.includes("--activate-only")) {
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
run(["run", "procurementImport:activate", JSON.stringify(activation)]);
console.log(`Activated ${activation.generation} for ${activation.societyId}.`);
