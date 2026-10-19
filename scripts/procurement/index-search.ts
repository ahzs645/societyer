/** Operator-only search projection bootstrap. Existing metadata and documents are not replaced. */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
const args = process.argv.slice(2),
  value = (flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
const deployment = value("--deployment"),
  societyId = value("--society-id"),
  checkpoint = value("--checkpoint");
if (!deployment || !societyId || !checkpoint)
  throw new Error(
    "Usage: npx tsx scripts/procurement/index-search.ts --deployment NAME --society-id ID --checkpoint PRIVATE_JSON_PATH",
  );
let cursor: string | null = null,
  total = 0;
if (existsSync(checkpoint)) {
  const saved = JSON.parse(readFileSync(checkpoint, "utf8"));
  if (saved.deployment !== deployment || saved.societyId !== societyId)
    throw new Error("Checkpoint belongs to another workspace/deployment.");
  if (saved.done) {
    console.log("Search index already complete; no scan.");
    process.exit(0);
  }
  cursor = saved.cursor;
  total = saved.total;
}
for (let slice = 0; slice < 1000; slice++) {
  const result = spawnSync(
    "npx",
    [
      "convex",
      "run",
      "procurementSync:indexSearchSlice",
      JSON.stringify({ societyId, cursor }),
      "--deployment",
      deployment,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(
      result.stderr || "Indexing interrupted; rerun the same checkpoint.",
    );
  const page = JSON.parse(result.stdout);
  cursor = page.cursor;
  total += page.rows;
  writeFileSync(
    checkpoint,
    JSON.stringify({ deployment, societyId, cursor, total, done: page.done }),
    { mode: 0o600 },
  );
  chmodSync(checkpoint, 0o600);
  console.log(
    `Search projection: ${total} notices${page.done ? "; ready" : ""}`,
  );
  if (page.done) process.exit(0);
}
throw new Error("Slice budget reached; resume with the same checkpoint.");
