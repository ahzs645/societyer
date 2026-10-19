/** Backed-up retirement of inactive catalog generations. Dry-run by default. */
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const deployment = value("--deployment"), societyId = value("--workspace"), backup = value("--backup");
const keep = Number(value("--keep-previous") ?? 1);
if (!deployment || !societyId || !Number.isInteger(keep) || keep < 0 || keep > 19) throw new Error("Usage: npx tsx scripts/procurement/retire-convex.ts --deployment NAME --workspace ID [--keep-previous 1] [--backup PRIVATE_CONVEX_EXPORT.zip] [--apply]");
function run(name: string, input: unknown, json = false): any {
  const result = spawnSync("npx", ["convex", "run", name, JSON.stringify(input), "--deployment", deployment!], { encoding: "utf8", stdio: json ? "pipe" : "inherit", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(json ? result.stderr : "Retirement stopped; active catalog remains protected.");
  return json ? JSON.parse(result.stdout) : undefined;
}
const state = run("procurementImport:state", { societyId }, true);
if (state?.profileVersion !== 2) throw new Error("Activate and verify the compact catalog before retiring earlier generations.");
let inventory: any;
if (backup) {
  if (!existsSync(backup)) throw new Error("Backup not found.");
  // Produce only aggregate counts and key boundaries, never print backed-up user records.
  const check = spawnSync("python3", ["-c", `
import collections,json,sys,zipfile
counts=collections.defaultdict(lambda:collections.Counter())
keys=collections.defaultdict(lambda:collections.defaultdict(lambda:collections.Counter()))
with zipfile.ZipFile(sys.argv[1]) as z:
    if z.testzip() is not None: raise ValueError('Backup CRC verification failed')
    for table in ('procurementRecords','procurementDetails','procurementDocuments','procurementEvidence'):
        with z.open(table+'/documents.jsonl') as source:
            for line in source:
                row=json.loads(line)
                if row.get('societyId')==sys.argv[2]:
                    counts[row['generation']][table]+=1
                    keys[row['generation']][table][row['recordKey']]+=len(line)
ranges={}
for generation,tables in keys.items():
    ranges[generation]={}
    for table,items in tables.items():
        pieces=[]; lower=''; size=0; number=0
        for key in sorted(items):
            if number and (number>=500 or size+items[key]>1000000):
                pieces.append(dict(lowerKey=lower,upperKey=key));lower=key;size=0;number=0
            size+=items[key];number+=1
        pieces.append(dict(lowerKey=lower,upperKey=None))
        ranges[generation][table]=pieces
print(json.dumps(dict(counts=counts,ranges=ranges)))
`, resolve(backup), societyId], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (check.status !== 0) throw new Error("Could not verify the private backup ZIP; no retirement performed.");
  inventory = JSON.parse(check.stdout);
}
// The backup is a durable inventory even after large deleted index ranges make discovery expensive.
const plan = inventory ? { active: state.generation, generations: Object.keys(inventory.counts), truncated: false }
  : run("procurementImport:generations", { societyId }, true);
if (plan.truncated) throw new Error("More than 20 generations; inspect and back up explicitly first.");
const inactive = (plan.generations as string[]).filter(generation => generation !== state.generation).sort().reverse();
const retiring = inactive.slice(keep);
console.log(JSON.stringify({ deployment, workspace: societyId, active: state.generation, inventory: inventory ? "verified backup generations only" : "database", retained: inactive.slice(0, keep), retiring, apply: args.includes("--apply") }, null, 2));
if (!args.includes("--apply") || !retiring.length) process.exit(0);
if (!inventory || !backup) throw new Error("A completed private Convex ZIP export is required before applying retirement.");
for (const generation of retiring) if (!(inventory.counts[generation]?.procurementRecords > 0 && inventory.counts[generation]?.procurementDetails > 0)) throw new Error(`Backup does not contain ${generation}; no retirement performed.`);
const digest = createHash("sha256");
for await (const chunk of createReadStream(backup)) digest.update(chunk);
console.log(`Verified backup SHA-256 ${digest.digest("hex")}. Retiring only the listed backed-up inactive generations.`);
for (const generation of retiring) {
  for (const table of ["procurementRecords", "procurementDetails", "procurementDocuments", "procurementEvidence"]) {
    const ranges = inventory.ranges[generation]?.[table] ?? [];
    let offset = 0, removed = 0, cursor: string | null = null;
    while (offset < ranges.length) {
      const result = run("procurementImport:purgeRanges", { societyId, generation, table, ranges: ranges.slice(offset, offset + 10), cursor }, true);
      removed += result.removed; offset += result.completedRanges; cursor = result.cursor;
      console.log(`${generation} ${table}: ${offset}/${ranges.length} backup ranges checked, ${removed} rows retired in this run.`);
    }
  }
}
if (run("procurementImport:state", { societyId }, true)?.generation !== state.generation) throw new Error("The active generation changed during maintenance; review its publication.");
console.log("Retirement complete; all backed-up ranges exhausted. Active catalog, shared taxonomy and SharePoint files retained.");
