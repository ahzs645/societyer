/** Resume the workspace's detached Convex catalog cleanup with the original backup. */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPersistentOperator } from "./operator-client";

const { values } = parseArgs({ options: {
  deployment: { type: "string" }, workspace: { type: "string" },
  backup: { type: "string" }, checkpoint: { type: "string" },
} });
const { deployment, workspace: societyId, backup, checkpoint } = values;
if (!deployment || !societyId || !backup || !checkpoint) {
  throw new Error("Supply --deployment, --workspace, --backup and --checkpoint to purge a detached catalog.");
}
const digest = createHash("sha256");
for await (const chunk of createReadStream(backup)) digest.update(chunk);
const backupSha256 = digest.digest("hex");
const identity = { deployment, societyId, backupSha256 };
type State = typeof identity & { tables: string[]; index: number; cursor: string | null; removed: number };
const operator = await createPersistentOperator(deployment);
try {
  let state: State;
  if (existsSync(checkpoint)) {
    state = JSON.parse(readFileSync(checkpoint, "utf8"));
    if (state.deployment !== deployment || state.societyId !== societyId || state.backupSha256 !== backupSha256)
      throw new Error("The checkpoint belongs to another deployment, workspace or backup.");
  } else {
    const status = await operator.run("procurementCatalogOperator:retirementStatus", JSON.stringify({ societyId })) as { detached: boolean; verified: boolean; tables: string[] };
    if (!status.detached) throw new Error("Detach the backed-up catalog before purging its rows.");
    state = { ...identity, tables: status.verified ? [] : status.tables, index: 0, cursor: null, removed: 0 };
  }
  while (state.index < state.tables.length) {
    const table = state.tables[state.index];
    const result = await operator.run("procurementCatalogOperator:retirePage", JSON.stringify({ societyId, backupSha256, table, cursor: state.cursor })) as { removed: number; cursor: string; done: boolean };
    state.removed += result.removed;
    state.cursor = result.done ? null : result.cursor;
    if (result.done) state.index++;
    writeFileSync(checkpoint + ".tmp", JSON.stringify(state) + "\n", { mode: 0o600 });
    renameSync(checkpoint + ".tmp", checkpoint);
    if (result.done) console.log(`${table} finished (${state.removed} rows removed across this checkpoint)`);
  }
} finally {
  operator.close();
}
