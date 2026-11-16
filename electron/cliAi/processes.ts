/**
 * Child processes and private folders for CLI runs (no Electron imports).
 *
 * Every child is tracked so app quit can stop it; a stop is SIGTERM, then
 * SIGKILL after two seconds. Each run gets a private temporary folder (0700,
 * files 0600) used as its working directory and deleted afterwards, so the
 * system prompt and the MCP token are never in the process list. Folders a
 * quit or crash left behind are removed: synchronously at quit, and those
 * older than an hour on the first run after a restart.
 */
import { execFile, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { chmod, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CliBinary } from "./binary.js";

const children = new Set<ChildProcess>();

export function trackChild(child: ChildProcess) {
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", () => children.delete(child));
}

export function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 2000);
  timer.unref();
  child.once("exit", () => clearTimeout(timer));
}

export function stopAllChildren() {
  for (const child of children) stopChild(child);
}

export const RUN_DIR_PREFIXES = ["societyer-claude-", "societyer-codex-"];
const STALE_RUN_DIR_MS = 60 * 60_000;
const activeRunDirs = new Set<string>();
let staleSweep: Promise<void> | null = null;

/** Deletes run folders older than `maxAgeMs` (a quit or crash skipped their cleanup). */
export async function removeStaleRunDirs(root = os.tmpdir(), maxAgeMs = STALE_RUN_DIR_MS, now = Date.now()) {
  const names = await readdir(root).catch(() => [] as string[]);
  for (const name of names) {
    if (!RUN_DIR_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const dir = path.join(root, name);
    if (activeRunDirs.has(dir)) continue;
    const info = await stat(dir).catch(() => null);
    if (info?.isDirectory() && now - info.mtimeMs > maxAgeMs) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function makeRunDir(prefix: string, root = os.tmpdir()): Promise<string> {
  staleSweep ??= removeStaleRunDirs().catch(() => undefined);
  const dir = await mkdtemp(path.join(root, prefix));
  await chmod(dir, 0o700);
  activeRunDirs.add(dir);
  return dir;
}

export async function writePrivateFile(dir: string, name: string, text: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, text, { encoding: "utf8", mode: 0o600 });
  return file;
}

export async function removeRunDir(dir: string) {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  activeRunDirs.delete(dir);
}

/** At quit: the runs still going won't get to clean up after themselves. */
export function removeActiveRunDirsSync() {
  for (const dir of activeRunDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Removed on the next start instead.
    }
  }
  activeRunDirs.clear();
}

export type ExecOutcome = { ok: boolean; code: number | null; stdout: string; stderr: string; notFound: boolean };

/** A short command (`--version`, `auth status`, `mcp list`), never through a shell. */
export function execCli(binary: CliBinary, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 10_000, cwd = os.tmpdir()): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    execFile(
      binary.command,
      [...binary.prefixArgs, ...args],
      { env, cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : error ? null : 0;
        const notFound = Boolean(error && (error.code === "ENOENT" || error.code === "EACCES"));
        resolve({ ok: !error, code, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), notFound });
      },
    );
  });
}
