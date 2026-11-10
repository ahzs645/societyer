/** Narrow SSH transport; never runs a remote shell supplied by the publication. */
import { spawn } from "node:child_process";
import { createReadStream, readFileSync, lstatSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateWorkspaceProcurementReviewFolder } from "../../shared/procurementReview/paths";

export type CatalogPublisherConfig = { societyId: string; folder: string; sshHost: string; sshPort?: number; keyFile: string; knownHostsFile: string; sqliteRsync: string; originFile: string };
export function publisherConfig(path: string): CatalogPublisherConfig {
  const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8000) throw new Error("Use a regular bounded publisher configuration file.");
  const value = JSON.parse(readFileSync(path, "utf8")) as CatalogPublisherConfig;
  validateWorkspaceProcurementReviewFolder(value.societyId, value.folder);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.sshHost) || value.sshPort !== undefined && (!Number.isInteger(value.sshPort) || value.sshPort < 1 || value.sshPort > 65535)) throw new Error("Use one explicit SSH user and host.");
  for (const key of ["keyFile", "knownHostsFile", "sqliteRsync", "originFile"] as const) if (typeof value[key] !== "string" || value[key] !== resolve(value[key]) || /[\r\n\0]/.test(value[key])) throw new Error("Publisher paths must be absolute local paths.");
  for (const key of ["keyFile", "knownHostsFile", "sqliteRsync"] as const) if (!lstatSync(value[key]).isFile()) throw new Error("A configured SSH prerequisite is missing.");
  if (lstatSync(value.keyFile).mode & 0o077) throw new Error("The publisher's private key must be readable only by its owner.");
  return value;
}
export function sshArguments(config: CatalogPublisherConfig) {
  return ["-F", "/dev/null", "-i", config.keyFile, "-p", String(config.sshPort ?? 22), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + config.knownHostsFile, "-o", "ClearAllForwardings=yes", "-T"];
}
export async function processOutput(binary: string, args: string[], input?: { file: string } | { json: unknown }) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "inherit"] }); let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Catalog publishing command timed out; retry this exact publication.")); }, 11 * 60_000);
    child.stdout.on("data", data => { output += data.toString(); if (Buffer.byteLength(output) > 64000) { child.kill(); reject(new Error("Publisher response exceeds the limit.")); } });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); code === 0 ? resolveOutput(output) : reject(new Error("Catalog publishing command failed (exit " + code + ").")); });
    child.stdin.on("error", () => {});
    if (input && "file" in input) { const stream = createReadStream(input.file); stream.on("error", error => { child.kill(); reject(error); }); child.once("exit", () => stream.destroy()); stream.pipe(child.stdin); }
    else child.stdin.end(input ? JSON.stringify(input.json) : undefined);
  });
}
export async function remoteCommand(config: CatalogPublisherConfig, command: "probe" | "activate" | "qualify" | "status", json?: unknown) {
  return JSON.parse(await processOutput("/usr/bin/ssh", [...sshArguments(config), config.sshHost, command], json === undefined ? undefined : { json }));
}
export function sshWrapper(config: CatalogPublisherConfig, directory: string) {
  const path = join(directory, "catalog-ssh");
  if (/\s/.test(path)) throw new Error("The sqlite3_rsync SSH wrapper needs a work directory without spaces.");
  writeFileSync(path, "#!/usr/bin/env python3\nimport os,sys\nos.execv('/usr/bin/ssh', " + JSON.stringify(["ssh", ...sshArguments(config)]) + " + sys.argv[1:])\n", { mode: 0o700 }); chmodSync(path, 0o700); return path;
}
