import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, createReadStream, chmodSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { buildCatalog, openCatalog, verifyCatalog } from "../../server/procurement-catalog/database";
import { validateExport } from "./verify-export";
import { publisherConfig, remoteCommand, processOutput, sshArguments, sshWrapper } from "./catalog-transport";
import { createPersistentOperator } from "./operator-client";

const args = process.argv.slice(2), value = (name: string) => args[args.indexOf(name) + 1];
if (!["--input", "--config", "--deployment"].every(name => args.includes(name) && value(name))) throw new Error("Usage: tsx publish-catalog-service.ts --input VERIFIED_EXPORT --config PRIVATE_PUBLISHER_JSON --deployment NAME [--dry-run] [--full-copy]");
const input = resolve(value("--input")), config = publisherConfig(resolve(value("--config"))), deployment = value("--deployment");
const { activation } = await validateExport(input, { skipAnalytics: true });
if (activation.societyId !== config.societyId || activation.folder !== config.folder) throw new Error("Publisher configuration belongs to another workspace or folder.");
if (args.includes("--dry-run")) { console.log(JSON.stringify({ action: "Verified export and explicit SSH prerequisites; no network request or origin update.", publicationId: activation.publicationId })); process.exit(0); }
if (args.includes("--service-only")) {
  const operator = await createPersistentOperator(deployment);
  try { const policy = await operator.run("procurementCatalogOperator:publicationPolicy", JSON.stringify({ societyId: config.societyId })) as { serviceOnlyAllowed: boolean }; if (!policy.serviceOnlyAllowed) throw new Error("Continue parallel publishing until the qualified service has completed its 14-day Convex fallback period."); }
  finally { operator.close(); }
}
const directory = dirname(config.originFile), lock = config.originFile + ".publisher-lock";
mkdirSync(directory, { recursive: true, mode: 0o700 }); mkdirSync(lock, { mode: 0o700 });
try {
  await buildCatalog(input, config.originFile);
  const localVersion = await processOutput(config.sqliteRsync, ["--version"]), probe = await remoteCommand(config, "probe");
  const sqliteSourceId = "2026-10-16 14:45:20 555e07ef33f69a0957d24d8e555b702464a131d6f1607f4c3c1e4551e8e6ca76";
  if (localVersion.trim() !== sqliteSourceId || probe.sqliteRsyncSourceId !== sqliteSourceId || probe.sqliteRsyncVersion !== "3.54.1" || probe.societyId !== config.societyId || probe.folder !== config.folder) throw new Error("Both endpoints must run pinned sqlite3_rsync 3.54.1 with this exact workspace binding.");
  let bytesReceived = 0;
  if (!probe.stagingExists || args.includes("--full-copy")) {
    const snapshot = join(directory, ".catalog-snapshot-" + randomUUID() + ".sqlite"), db = openCatalog(config.originFile);
    try { verifyCatalog(db); db.prepare("VACUUM INTO ?").run(snapshot); chmodSync(snapshot, 0o600); } finally { db.close(); }
    try {
      const digest = createHash("sha256"); for await (const chunk of createReadStream(snapshot)) digest.update(chunk);
      const sha256 = digest.digest("hex"), size = statSync(snapshot).size;
      const copied = JSON.parse(await processOutput("/usr/bin/ssh", [...sshArguments(config), config.sshHost, "put", sha256, String(size)], { file: snapshot }));
      if (copied.sha256 !== sha256 || copied.received !== size) throw new Error("Full-copy receipt failed its checksum or size check.");
      bytesReceived = size;
    } finally { rmSync(snapshot, { force: true }); }
  } else {
    const wrapper = sshWrapper(config, directory);
    const output = await processOutput(config.sqliteRsync, [config.originFile, config.sshHost + ":/srv/procurement-catalog/staging/" + config.societyId + "/catalog.sqlite", "--exe", "/usr/local/libexec/sqlite3_rsync-3.54.1", "--ssh", wrapper, "-v"]);
    const traffic = /sent ([\d,]+) bytes, received ([\d,]+) bytes/.exec(output);
    if (!traffic) throw new Error("sqlite3_rsync did not return its transfer statistics.");
    bytesReceived = Number(traffic[1].replaceAll(",", ""));
  }
  const receipt = await remoteCommand(config, "activate", { societyId: config.societyId, publicationId: activation.publicationId, inventoryHash: activation.inventoryHash, bytesReceived });
  const status = await remoteCommand(config, "status"), serving = status.workspaces?.find((row: any) => row.societyId === config.societyId)?.current;
  for (const candidate of [receipt, serving]) if (!candidate || candidate.publicationId !== activation.publicationId || candidate.generation !== activation.generation || candidate.inventoryHash !== activation.inventoryHash || candidate.folder !== config.folder || candidate.sourceSnapshotId !== activation.sourceSnapshotId || !candidate.activatedAt) throw new Error("Service activation did not read back as serving for this exact publication.");
  if (receipt.state !== "ready") throw new Error("Service has not completed activation.");
  // Record the immutable serving receipt only after activation and independent readback.
  const receiptJson = JSON.stringify(receipt), receiptPath = join(input, "catalog-service-receipt.json"); writeFileSync(receiptPath, receiptJson + "\n", { mode: 0o600 });
  const operator = await createPersistentOperator(deployment);
  try { await operator.run("procurementCatalog:recordPublication", JSON.stringify({ societyId: config.societyId, receiptJson })); }
  finally { operator.close(); }
  console.log(JSON.stringify({ state: "ready", publicationId: receipt.publicationId, inventoryHash: receipt.inventoryHash, bytesReceived, counts: receipt.counts, receiptPath }));
} finally { rmSync(lock, { recursive: true, force: true }); }
