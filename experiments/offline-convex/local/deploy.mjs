import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("..", import.meta.url));
process.loadEnvFile(new URL("../.env.local", import.meta.url));
if (process.env.CONVEX_SELF_HOSTED_URL !== "http://127.0.0.1:43210"
    || !process.env.CONVEX_SELF_HOSTED_ADMIN_KEY?.startsWith("societyer-offline-pilot|")) {
  throw new Error("Refusing to deploy local fixtures outside the isolated pilot instance.");
}
const cli = fileURLToPath(new URL("../../../node_modules/.bin/convex", import.meta.url));
for (const [name, value] of Object.entries({ AUTH_MODE: "better-auth", VITE_AUTH_MODE: "better-auth", BETTER_AUTH_BASE_URL: "http://127.0.0.1:43212",
  BETTER_AUTH_JWKS_URL: "http://host.docker.internal:43212/jwks.json", OFFLINE_LOCAL_PILOT: "1", OFFLINE_MEETING_PREPARATION_ENABLED: "1" })) {
  const result = spawnSync(cli, ["env", "set", name, value], { cwd, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const result = spawnSync(cli, ["dev", "--once", "--typecheck", "disable", "--codegen", "disable"], { cwd, stdio: "inherit" });
process.exit(result.status ?? 1);
