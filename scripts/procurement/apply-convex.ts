/** Deployment-operator tool. No new ingestion token or public write endpoint. */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const deployment = value("--deployment");
const input = value("--input");
if (!deployment || !input) throw new Error("Usage: npx tsx scripts/procurement/apply-convex.ts --deployment NAME --input PRIVATE_EXPORT_DIRECTORY [--dry-run|--activate-only]");
const activation = JSON.parse(readFileSync(resolve(input, "activation.json"), "utf8"));
const archive = resolve(input, "metadata.zip");
if (!existsSync(archive)) throw new Error("Metadata archive not found.");
function run(command: string[], json = false): any {
  const result = spawnSync("npx", ["convex", ...command, "--deployment", deployment!], { encoding: "utf8", stdio: json ? "pipe" : "inherit", maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(json ? result.stderr || "Convex command failed" : "Convex command failed. The active generation is unchanged; inspect the import before retrying.");
  return json ? JSON.parse(result.stdout) : undefined;
}
const prior = run(["run", "procurementImport:state", JSON.stringify({ societyId: activation.societyId })], true);
const unchanged = activation.profileVersion === 2 && prior?.profileVersion === 2 && prior.folder === activation.folder && prior.contentHash === activation.contentHash;
if (args.includes("--dry-run")) {
  console.log(JSON.stringify({ deployment, generation: activation.generation, expected: activation.expected, taxonomyTerms: activation.taxonomyCount ?? 0, unchanged, action: unchanged ? "Reuse active generation; update publication metadata only" : "Import compact generation, verify counts, activate; retain previous generation" }, null, 2));
  process.exit(0);
}
if (unchanged) {
  run(["run", "procurementImport:commit", JSON.stringify({ ...activation, generation: prior.generation })]);
  console.log(`Unchanged hosted content: reused ${prior.generation}; no row import or catalog scan.`);
  process.exit(0);
}
for (const index of activation.taxonomyIndexes ?? []) {
  const scope = { societyId: activation.societyId, ...index };
  const action = run(["run", "procurementImport:beginTaxonomy", JSON.stringify({ ...scope, folder: activation.folder })], true);
  if (action === "reuse") { console.log(`Reused verified taxonomy ${index.releaseId} (${index.count} terms).`); continue; }
  if (action === "resume" && !args.includes("--activate-only")) throw new Error("Taxonomy import is already reserved. Check its previous import, then retry --activate-only to verify it without appending duplicates.");
  if (action === "import") {
    if (!/^[a-f0-9]{64}$/.test(index.contentHash)) throw new Error("Invalid taxonomy content hash.");
    const termsArchive = resolve(input, `taxonomy-${index.contentHash}.zip`);
    if (!existsSync(termsArchive)) throw new Error("Taxonomy archive missing.");
    run(["import", "--append", termsArchive]);
  }
  run(["run", "procurementTaxonomy:finishTaxonomy", JSON.stringify(scope)]);
}
if (!args.includes("--activate-only")) {
  for (const table of ["procurementRecords", "procurementDetails", "procurementDocuments", "procurementEvidence"]) {
    const first = run(["run", "procurementImport:countPage", JSON.stringify({ societyId: activation.societyId, generation: activation.generation, table, cursor: null })], true);
    if (first.count) throw new Error(`This generation already contains ${table}. Refusing to append duplicates. If its import completed, rerun with --activate-only.`);
  }
  run(["import", "--append", archive]);
}
run(["run", "procurementImport:activate", JSON.stringify(activation)]);
console.log(`Activated ${activation.generation} for ${activation.societyId}.`);
