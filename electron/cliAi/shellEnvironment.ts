/**
 * The environment the Claude Code and Codex CLIs run in (no Electron imports).
 *
 * An app opened from Finder or a desktop launcher does not inherit the PATH
 * the person's terminal has, so `claude` and `codex` (often in ~/.local/bin,
 * Homebrew or a Node version manager folder) would not be found. The login
 * shell is asked once for PATH and a few related variables, printed between
 * markers so prompt themes and greetings can't confuse the reading; macOS
 * falls back to `launchctl getenv PATH`. The usual install folders are added
 * after that.
 *
 * Children never inherit variables a parent Claude Code or Codex session
 * exported (they would make the child act as part of that session), nor
 * ELECTRON_RUN_AS_NODE (anything Electron-based they start would run as Node).
 */
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

/** Copied from the login shell when this process doesn't already have them. */
const SHELL_ENV_NAMES = [
  "PATH",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "XDG_CONFIG_HOME",
  "LANG",
] as const;

/** Exported by a Claude Code or Codex session that launched this app. */
const LEAKED_SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_DESKTOP_APP_VERSION",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "CLAUDE_AGENT_SDK_VERSION",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "CODEX_THREAD_ID",
  "CODEX_CI",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
];

const SHELL_TIMEOUT_MS = 5_000;
const SLOW_SHELL_TIMEOUT_MS = 20_000;
const LAUNCHCTL_TIMEOUT_MS = 2_000;
const MARKER = "__SOCIETYER_ENV_7c1f__";

export type ShellEnvironment = Partial<Record<(typeof SHELL_ENV_NAMES)[number], string>>;

type ExecResult = { stdout: string; timedOut: boolean };
export type ExecLike = (file: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

const execText: ExecLike = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
      const timedOut = Boolean(error && "killed" in error && error.killed);
      resolve({ stdout: typeof stdout === "string" ? stdout : "", timedOut });
    });
  });

/** A command for `$SHELL -ilc` that prints each name between markers (works in sh, bash, zsh and fish). */
export function shellCaptureCommand(names: readonly string[] = SHELL_ENV_NAMES): string {
  return names
    .map((name) => `printf '%s\\n' '${MARKER}${name}:start'; printenv ${name}; printf '%s\\n' '${MARKER}${name}:end'`)
    .join("; ");
}

export function parseShellCapture(output: string, names: readonly string[] = SHELL_ENV_NAMES): ShellEnvironment {
  const values: Record<string, string> = {};
  for (const name of names) {
    const start = `${MARKER}${name}:start`;
    const end = `${MARKER}${name}:end`;
    // The last pair: a shell that echoes commands would print the markers inside the command text first.
    const from = output.lastIndexOf(start);
    if (from < 0) continue;
    const to = output.indexOf(end, from + start.length);
    if (to < 0) continue;
    const value = output.slice(from + start.length, to).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    if (value && !value.includes(MARKER)) values[name] = value;
  }
  return values as ShellEnvironment;
}

function loginShell(env: NodeJS.ProcessEnv): string | null {
  if (process.platform === "win32") return null;
  let shell = env.SHELL;
  if (!shell) {
    try {
      shell = os.userInfo().shell ?? undefined;
    } catch {
      shell = undefined;
    }
  }
  if (!shell || !path.isAbsolute(shell)) shell = process.platform === "darwin" ? "/bin/zsh" : "/bin/sh";
  // Nushell and other non-POSIX shells don't take this command; launchctl covers macOS.
  return /(^|\/)(nu|elvish|xonsh)$/.test(shell) ? null : shell;
}

export async function probeShellEnvironment(env: NodeJS.ProcessEnv = process.env, exec: ExecLike = execText): Promise<ShellEnvironment> {
  const shell = loginShell(env);
  let found: ShellEnvironment = {};
  if (shell) {
    const command = shellCaptureCommand();
    let result = await exec(shell, ["-ilc", command], SHELL_TIMEOUT_MS);
    // A slow shell start (nvm, conda, a big oh-my-zsh) gets one longer try.
    if (result.timedOut) result = await exec(shell, ["-ilc", command], SLOW_SHELL_TIMEOUT_MS);
    found = parseShellCapture(result.stdout);
  }
  if (!found.PATH && process.platform === "darwin") {
    const launchctl = await exec("/bin/launchctl", ["getenv", "PATH"], LAUNCHCTL_TIMEOUT_MS);
    const value = launchctl.stdout.trim();
    if (value) found = { ...found, PATH: value };
  }
  return found;
}

let cached: Promise<ShellEnvironment> | null = null;

/** The login shell's values, read once per app run. */
export function shellEnvironment(): Promise<ShellEnvironment> {
  cached ??= probeShellEnvironment().catch(() => ({}));
  return cached;
}

export function resetShellEnvironmentCache() {
  cached = null;
}

/** Folders the installers put these CLIs in, after the shell's PATH. */
export function usualInstallDirs(home = os.homedir(), platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return [
      path.join(home, ".local", "bin"),
      path.join(appData, "npm"),
      path.join(local, "Programs", "claude"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, ".claude", "local"),
    ];
  }
  return [
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".bun", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".claude", "local"),
  ];
}

export function mergePath(parts: Array<string | undefined>, delimiter = path.delimiter): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const entry of (part ?? "").split(delimiter)) {
      const dir = entry.trim();
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      out.push(dir);
    }
  }
  return out.join(delimiter);
}

/**
 * The child environment: this process's variables, the login shell's values
 * for names this process lacks, a merged PATH, minus leaked session variables.
 * CLAUDE_CONFIG_DIR, CODEX_HOME and API keys the person set are kept.
 */
export function childEnvironment(base: NodeJS.ProcessEnv, shell: ShellEnvironment, extraDirs: string[] = usualInstallDirs()): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const [name, value] of Object.entries(shell)) {
    if (name !== "PATH" && value && !env[name]) env[name] = value;
  }
  // Windows spells it Path; keep one key.
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = mergePath([shell.PATH, env[pathKey], ...extraDirs]);
  for (const name of LEAKED_SESSION_VARIABLES) delete env[name];
  return env;
}

export async function cliChildEnvironment(): Promise<NodeJS.ProcessEnv> {
  return childEnvironment(process.env, await shellEnvironment());
}
