/** Opt-in operator transport using the existing Convex CLI login, never a stored deploy key. */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { ConvexHttpClient } from "convex/browser";
import { jsonToConvex, type Value } from "convex/values";

const alternateSettings = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_OVERRIDE_ACCESS_TOKEN", "CONVEX_PROVISION_HOST", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"];
const functions = new Set([
  "procurementAnalytics:seed",
  "procurementImport:state", "procurementImport:beginJob", "procurementImport:jobProgress",
  "procurementImport:beginTaxonomy", "procurementImport:countPage", "procurementImport:activate", "procurementImport:commit",
  "procurementTaxonomy:finishTaxonomy", "procurementSync:begin", "procurementSync:applyBatch", "procurementSync:finish", "procurementSync:fail",
]);
export type OperatorOptions = {
  cwd?: string;
  home?: string;
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  readText?: (path: string) => string | undefined;
};

/**
 * Mirrors Convex 1.42.1 CLI handleDeploymentName + runFunctionAndLog.
 * The CLI source imports optional build dependencies absent from installations,
 * so this narrow fallback pins its authorization contract and refuses alternate
 * auth/host modes rather than silently changing the CLI's precedence rules.
 */
export async function createPersistentOperator(deployment: string, options: OperatorOptions = {}) {
  const require = createRequire(import.meta.url);
  const version = JSON.parse(readFileSync(require.resolve("convex/package.json"), "utf8")).version;
  if (version !== "1.42.1") throw new Error("Persistent operator requires reviewed Convex CLI version 1.42.1.");
  if (!/^[a-z][a-z0-9-]*-[0-9]+$/.test(deployment)) throw new Error("Persistent operator requires an explicit cloud deployment name.");
  const cwd = options.cwd ?? process.cwd(), environment = options.environment ?? process.env;
  const readText = options.readText ?? ((path: string) => existsSync(path) ? readFileSync(path, "utf8") : undefined);
  if (alternateSettings.some(key => environment[key])) throw new Error("Persistent operator refuses alternate CLI authentication or provision hosts; use the CLI transport.");
  for (const name of [".env.local", ".env"]) {
    const contents = readText(join(cwd, name));
    if (contents && alternateSettings.some(key => new RegExp("^\\s*(?:export\\s+)?" + key + "\\s*=", "m").test(contents))) throw new Error("Persistent operator refuses alternate authentication or provision hosts in env files; use the CLI transport.");
  }
  let login: unknown;
  try { login = JSON.parse(readText(join(options.home ?? homedir(), ".convex", "config.json")) ?? "null"); }
  catch { throw new Error("Existing Convex CLI login could not be read."); }
  const accessToken = (login as { accessToken?: unknown } | null)?.accessToken;
  if (typeof accessToken !== "string" || !accessToken.trim()) throw new Error("An existing Convex CLI login is required; no credentials will be created.");
  const transport = options.fetch ?? fetch;
  const response = await transport("https://api.convex.dev/api/deployment/authorize_within_current_project", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "Convex-Client": `npm-cli-${version}` },
    body: JSON.stringify({ selectedDeploymentName: deployment, projectSelection: { kind: "deploymentName", deploymentName: deployment, deploymentType: null } }),
  });
  if (!response.ok) throw new Error(`Existing Convex CLI authorization failed (HTTP ${response.status}); no credentials were saved.`);
  let credentials: any;
  try { credentials = await response.json(); }
  catch { throw new Error("Convex CLI authorization returned an invalid response."); }
  const url = `https://${deployment}.convex.cloud`;
  if (!credentials || credentials.deploymentName !== deployment || credentials.deploymentType !== "prod" || credentials.url !== url || typeof credentials.adminKey !== "string" || !credentials.adminKey) throw new Error("Convex authorization returned an unexpected production deployment.");
  const client = new ConvexHttpClient(url, { logger: false, fetch: (resource, init) => transport(resource, { ...init, redirect: "error", signal: AbortSignal.timeout(660000) }) });
  // These methods are @internal in the installed SDK and omitted from its
  // declaration bundle; the pinned CLI calls this exact runtime interface.
  const admin = client as ConvexHttpClient & {
    setAdminAuth(token: string): void;
    function(name: string, component: undefined, args: Record<string, Value>): Promise<Value>;
  };
  admin.setAdminAuth(credentials.adminKey);
  return {
    async run(name: string, argsString: string) {
      if (!functions.has(name)) throw new Error("Function is outside the procurement operator transport allowlist.");
      return admin.function(name, undefined, jsonToConvex(JSON.parse(argsString)) as Record<string, Value>);
    },
    close() { client.clearAuth(); },
  };
}
