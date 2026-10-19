/** Backed-up, explicit retirement of inactive catalog generations. Dry-run by default. */
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const deployment = value("--deployment"), societyId = value("--workspace");
const keep = Number(value("--keep-previous") ?? 1);
if (!deployment || !societyId || !Number.isInteger(keep) || keep < 0 || keep > 19) throw new Error("Usage: npx tsx scripts/procurement/retire-convex.ts --deployment NAME --workspace ID [--keep-previous 1] [--apply --backup PRIVATE_CONVEX_EXPORT.zip]");
function run(name: string, input: unknown, json = false): any {
  const result = spawnSync("npx", ["convex", "run", name, JSON.stringify(input), "--deployment", deployment!], { encoding: "utf8", stdio: json ? "pipe" : "inherit", maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(json ? result.stderr : "Retirement stopped; active catalog remains protected.");
  return json ? JSON.parse(result.stdout) : undefined;
}
const state = run("procurementImport:state", { societyId }, true);
if (state?.profileVersion !== 2) throw new Error("Activate and verify the compact catalog before retiring earlier generations.");
const plan = run("procurementImport:generations", { societyId }, true);
if (plan.truncated) throw new Error("More than 20 generations; inspect and retire explicitly in smaller maintenance sessions.");
const inactive = (plan.generations as string[]).filter(generation => generation !== plan.active).sort().reverse();
const retiring = inactive.slice(keep);
console.log(JSON.stringify({ deployment, workspace: societyId, active: plan.active, retained: inactive.slice(0, keep), retiring, apply: args.includes("--apply") }, null, 2));
if (!args.includes("--apply") || !retiring.length) process.exit(0);

const backup = value("--backup");
if (!backup || !existsSync(backup)) throw new Error("A completed private Convex ZIP export is required before applying retirement.");
// Inspect the actual backup, not just its filename. Never print user records.
const check = spawnSync("python3", ["-c", `
import collections,json,sys,zipfile
counts=collections.defaultdict(lambda:collections.Counter())
with zipfile.ZipFile(sys.argv[1]) as z:
    if z.testzip() is not None: raise ValueError('Backup CRC verification failed')
    for table in ('procurementRecords','procurementDetails','procurementDocuments','procurementEvidence'):
        name=table+'/documents.jsonl'
        if name not in z.namelist(): raise ValueError('Incomplete procurement backup')
        with z.open(name) as source:
            for line in source:
                row=json.loads(line)
                if row.get('societyId')==sys.argv[2]: counts[row['generation']][table]+=1
print(json.dumps(counts))
`, resolve(backup), societyId], { encoding: "utf8", maxBuffer: 1024 * 1024 });
if (check.status !== 0) throw new Error("Could not verify the private backup ZIP; no retirement performed.");
const covered = JSON.parse(check.stdout);
for (const generation of retiring) if (!(covered[generation]?.procurementRecords > 0 && covered[generation]?.procurementDetails > 0)) throw new Error(`Backup does not contain ${generation}; no retirement performed.`);
const digest = createHash("sha256");
for await (const chunk of createReadStream(backup)) digest.update(chunk);
console.log(`Verified backup SHA-256 ${digest.digest("hex")}. Retiring only the listed inactive generations.`);
for (const generation of retiring) {
  for (const table of ["procurementRecords", "procurementDetails", "procurementDocuments", "procurementEvidence"]) {
    let removed = 0;
    for (;;) {
      const result = run("procurementImport:purgeSlice", { societyId, generation, table }, true);
      removed += result.removed;
      console.log(`${generation} ${table}: ${removed} retired in this run${result.done ? " (complete)" : ""}.`);
      if (result.done) break;
    }
  }
}
const after = run("procurementImport:generations", { societyId }, true);
if (after.active !== plan.active || retiring.some(generation => after.generations.includes(generation))) throw new Error("Retirement verification needs operator attention.");
console.log("Retirement complete; active generation is unchanged. Shared taxonomy terms and SharePoint files were retained.");
