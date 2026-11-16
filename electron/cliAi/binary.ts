/**
 * Finding the Claude Code / Codex executable (no Electron imports).
 *
 * A configured path must be absolute, exist, be a file and be executable.
 * Otherwise the name is looked up on the child PATH (shellEnvironment.ts).
 * Nothing is ever run through a shell, so on Windows an npm `.cmd`/`.ps1`
 * shim can't be used directly: the package entry next to it is tried instead
 * (a native `.exe`, or a `cli.js` run with Node), else the person is asked to
 * set the path to the `.exe`.
 */
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { DesktopLocalAiCliKind } from "../../src/lib/desktopBridge";
import { LocalAiProxyError } from "../localAiProxy.js";

/** What to spawn: `command` with `prefixArgs` before the CLI's own arguments. */
export type CliBinary = { kind: DesktopLocalAiCliKind; command: string; prefixArgs: string[]; path: string };

const NAMES: Record<DesktopLocalAiCliKind, string> = { "claude-cli": "claude", "codex-cli": "codex" };
export const CLI_LABEL: Record<DesktopLocalAiCliKind, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex" };
const SHIM_EXTENSIONS = new Set([".cmd", ".bat", ".ps1"]);

function isFile(file: string) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function isExecutable(file: string, platform: NodeJS.Platform) {
  if (!isFile(file)) return false;
  if (platform === "win32") return true;
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathDirs(env: NodeJS.ProcessEnv) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  return (env[key] ?? "").split(path.delimiter).filter((dir) => dir && path.isAbsolute(dir));
}

/** First match on PATH; on Windows a `.exe` anywhere beats a shim. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string | null {
  const dirs = pathDirs(env);
  const extensions = platform === "win32" ? [".exe", ".cmd", ".ps1", ".bat"] : [""];
  for (const extension of extensions) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name + extension);
      if (isExecutable(candidate, platform)) return candidate;
    }
  }
  return null;
}

/** The npm package entry beside a Windows shim, as T3 Code's ClaudeExecutable does. */
function shimTarget(kind: DesktopLocalAiCliKind, shim: string, env: NodeJS.ProcessEnv): Omit<CliBinary, "kind"> | null {
  const dir = path.dirname(shim);
  if (kind === "claude-cli") {
    const exe = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (isFile(exe)) return { command: exe, prefixArgs: [], path: exe };
    const cli = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    const node = findOnPath("node", env, "win32");
    if (isFile(cli) && node) return { command: node, prefixArgs: [cli], path: cli };
    return null;
  }
  // @openai/codex keeps the native binary at vendor/<target triple>/codex/codex.exe,
  // in the package itself or in a per-platform package it depends on.
  const pkg = path.join(dir, "node_modules", "@openai", "codex");
  const vendorDirs = [path.join(pkg, "vendor"), ...listDir(path.join(pkg, "node_modules", "@openai")).map((name) => path.join(pkg, "node_modules", "@openai", name, "vendor"))];
  for (const vendor of vendorDirs) {
    for (const triple of listDir(vendor)) {
      const exe = path.join(vendor, triple, "codex", "codex.exe");
      if (isFile(exe)) return { command: exe, prefixArgs: [], path: exe };
    }
  }
  return null;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Resolves the CLI or throws a LocalAiProxyError("refused") with a plain
 * message saying what to do.
 */
export function resolveCliBinary(
  kind: DesktopLocalAiCliKind,
  configuredPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): CliBinary {
  const label = CLI_LABEL[kind];
  let found: string | null;
  if (configuredPath) {
    if (!path.isAbsolute(configuredPath)) throw new LocalAiProxyError("refused", `The ${label} path must be a full path.`);
    if (!isFile(configuredPath)) throw new LocalAiProxyError("refused", `${label} wasn't found at the path set in On-device AI settings.`);
    if (!isExecutable(configuredPath, platform)) throw new LocalAiProxyError("refused", `The file set as ${label}'s path can't be run.`);
    found = configuredPath;
  } else {
    found = findOnPath(NAMES[kind], env, platform);
    if (!found) {
      throw new LocalAiProxyError(
        "refused",
        `${label} isn't installed on this computer, or Societyer can't find it. Install it, or set its path in On-device AI settings.`,
      );
    }
  }
  if (platform === "win32" && SHIM_EXTENSIONS.has(path.extname(found).toLowerCase())) {
    const target = shimTarget(kind, found, env);
    if (!target) throw new LocalAiProxyError("refused", `Societyer can't run ${label} through ${path.basename(found)}. Set the path to the .exe in On-device AI settings.`);
    return { kind, ...target };
  }
  return { kind, command: found, prefixArgs: [], path: found };
}
