/** Deployment-operator tool. No new ingestion token or public write endpoint. */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const deployment = value("--deployment");
const input = value("--input");
if (!deployment || !input) throw new Error("Usage: npx tsx scripts/procurement/apply-convex.ts --deployment NAME --input PRIVATE_EXPORT_DIRECTORY [--activate-only]");
const activation = JSON.parse(readFileSync(resolve(input, "activation.json"), "utf8"));
const archive = resolve(input, "metadata.zip");
if (!existsSync(archive)) throw new Error("Metadata archive not found.");
function run(command: string[], json = false): any {
  const result = spawnSync("npx", ["convex", ...command, "--deployment", deployment!], { encoding: "utf8", stdio: json ? "pipe" : "inherit", maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(json ? result.stderr || "Convex command failed" : "Convex command failed. The active generation is unchanged; inspect the import before retrying.");
  return json ? JSON.parse(result.stdout) : undefined;
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
