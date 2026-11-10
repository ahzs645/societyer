/** Explicit, pinned operator-tool installation from SQLite's official release. */
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import JSZip from "jszip";
const packages: Record<string, { name: string; sha3: string }> = {
  "darwin-arm64": { name: "sqlite-tools-osx-arm64-3540100.zip", sha3: "a3106c6db3b50ec9ef4fde4edfafe7504179e9bfd7e0816a280b29c4d56a2e7b" },
  "linux-x64": { name: "sqlite-tools-linux-x64-3540100.zip", sha3: "555635de98534d87a67ee2e6e1b0d79f494b1b33b223477d3e7a8ea0c66e416f" },
};
const args = process.argv.slice(2), destination = args[args.indexOf("--destination") + 1], target = args.includes("--target") ? args[args.indexOf("--target") + 1] : process.platform + "-" + process.arch;
if (!args.includes("--destination") || !destination || !packages[target]) throw new Error("Usage: tsx install-sqlite-rsync.ts --destination NEW_DIRECTORY [--target darwin-arm64|linux-x64]");
const spec = packages[target], directory = resolve(destination);
if (existsSync(join(directory, "sqlite3_rsync"))) throw new Error("A pinned binary already exists here; choose a new directory to upgrade.");
const response = await fetch("https://sqlite.org/2026/" + spec.name, { redirect: "error", signal: AbortSignal.timeout(60_000) });
if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 8 * 1024 ** 2) throw new Error("SQLite tool download failed.");
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.length > 8 * 1024 ** 2 || createHash("sha3-256").update(bytes).digest("hex") !== spec.sha3) throw new Error("Official SQLite tool checksum differs; nothing installed.");
const zip = await JSZip.loadAsync(bytes), candidates = Object.values(zip.files).filter(file => !file.dir && file.name.split("/").at(-1) === "sqlite3_rsync");
if (candidates.length !== 1) throw new Error("Pinned archive does not contain one sqlite3_rsync binary.");
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(join(directory, "sqlite3_rsync"), await candidates[0].async("nodebuffer"), { mode: 0o700 });
writeFileSync(join(directory, "release.json"), JSON.stringify({ version: "3.54.1", archive: spec.name, sha3_256: spec.sha3 }) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ installed: join(directory, "sqlite3_rsync"), version: "3.54.1", verifiedOfficialArchive: true }));
