/**
 * "Test connection" for the CLI kinds: is the CLI there, which version, and
 * is it signed in (no Electron imports). Never runs a model. The account
 * label (plan and email) is shown to the person on this computer and never
 * logged.
 */
import type { DesktopLocalAiCliKind, DesktopLocalAiCliStatus } from "../../src/lib/desktopBridge";
import { LocalAiProxyError } from "../localAiProxy.js";
import { CLI_LABEL, resolveCliBinary, type CliBinary } from "./binary.js";
import { codexAppServer, type CodexAppServer } from "./codexAppServer.js";
import { codexAccountLabel } from "./codexProtocol.js";
import { execCli } from "./processes.js";

const SIGN_IN_HINT: Record<DesktopLocalAiCliKind, string> = {
  "claude-cli": "Run `claude auth login` in Terminal, then test again.",
  "codex-cli": "Run `codex login` in Terminal, then test again.",
};
const INSTALL_HINT: Record<DesktopLocalAiCliKind, string> = {
  "claude-cli": "Install Claude Code and sign in, or set the full path to `claude` below.",
  "codex-cli": "Install the Codex CLI and sign in, or set the full path to `codex` below.",
};

const PLAN_LABELS: Record<string, string> = { max: "Claude Max", pro: "Claude Pro", team: "Claude Team", enterprise: "Claude Enterprise", free: "Claude Free" };

export function parseCliVersion(stdout: string): string | undefined {
  return /\d+\.\d+\.\d+[\w.+-]*/.exec(stdout)?.[0];
}

/** `claude auth status` prints JSON whatever the exit code. */
export function claudeAuthStatus(stdout: string): { signedIn: boolean | null; label?: string } {
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!parsed || typeof parsed !== "object") return { signedIn: null };
    value = parsed as Record<string, unknown>;
  } catch {
    return { signedIn: null };
  }
  if (typeof value.loggedIn !== "boolean") return { signedIn: null };
  if (!value.loggedIn) return { signedIn: false };
  const provider = typeof value.apiProvider === "string" ? value.apiProvider : "firstParty";
  const method = typeof value.authMethod === "string" ? value.authMethod : "";
  const plan = typeof value.subscriptionType === "string" ? value.subscriptionType.toLowerCase() : "";
  let label = PLAN_LABELS[plan] ?? (plan ? `Claude ${plan[0].toUpperCase()}${plan.slice(1)}` : "Claude");
  if (provider === "bedrock") label = "Amazon Bedrock";
  else if (provider === "vertex") label = "Google Vertex AI";
  else if (provider === "foundry") label = "Microsoft Foundry";
  else if (/api.?key/i.test(method)) label = "Anthropic API key";
  const email = typeof value.email === "string" && value.email ? value.email : "";
  return { signedIn: true, label: email ? `${label} · ${email}` : label };
}

export type StatusDeps = {
  env: NodeJS.ProcessEnv;
  resolveBinary?: typeof resolveCliBinary;
  codexServer?: (binary: CliBinary, env: NodeJS.ProcessEnv) => Promise<CodexAppServer>;
};

async function signInState(binary: CliBinary, deps: StatusDeps): Promise<{ signedIn: boolean | null; label?: string; problem?: string }> {
  if (binary.kind === "claude-cli") {
    const outcome = await execCli(binary, ["auth", "status", "--json"], deps.env, 15_000);
    const parsed = claudeAuthStatus(outcome.stdout);
    if (parsed.signedIn !== null || outcome.ok) return parsed;
    // Older CLIs print JSON without the flag.
    return claudeAuthStatus((await execCli(binary, ["auth", "status"], deps.env, 15_000)).stdout);
  }
  try {
    const server = await (deps.codexServer ?? codexAppServer)(binary, deps.env);
    const account = await server.use((current) => current.request("account/read", { refreshToken: false }, 20_000));
    return codexAccountLabel(account && typeof account === "object" ? (account as Record<string, unknown>).account : null);
  } catch (error) {
    return { signedIn: null, problem: error instanceof LocalAiProxyError ? error.message : "Societyer couldn't ask Codex whether it's signed in." };
  }
}

export async function cliStatus(kind: DesktopLocalAiCliKind, configuredPath: string, deps: StatusDeps): Promise<DesktopLocalAiCliStatus> {
  const label = CLI_LABEL[kind];
  let binary: CliBinary;
  try {
    binary = (deps.resolveBinary ?? resolveCliBinary)(kind, configuredPath, deps.env);
  } catch (error) {
    return { kind, found: false, signedIn: null, message: error instanceof Error ? error.message : `${label} wasn't found.`, hint: INSTALL_HINT[kind] };
  }
  const versionRun = await execCli(binary, ["--version"], deps.env, 15_000);
  const version = versionRun.ok ? parseCliVersion(versionRun.stdout) : undefined;
  if (!versionRun.ok) {
    return { kind, found: false, binaryPath: binary.path, signedIn: null, message: `${label} was found at ${binary.path} but didn't run.`, hint: INSTALL_HINT[kind] };
  }
  const state = await signInState(binary, deps);
  const named = version ? `${label} ${version}` : label;
  if (state.signedIn === true) {
    return { kind, found: true, binaryPath: binary.path, version, signedIn: true, account: state.label, message: `${named} is ready.` };
  }
  if (state.signedIn === false) {
    return { kind, found: true, binaryPath: binary.path, version, signedIn: false, message: `${named} isn't signed in.`, hint: SIGN_IN_HINT[kind] };
  }
  return {
    kind,
    found: true,
    binaryPath: binary.path,
    version,
    signedIn: null,
    message: state.problem ?? `${named} was found, but Societyer couldn't check whether it's signed in.`,
    hint: SIGN_IN_HINT[kind],
  };
}
