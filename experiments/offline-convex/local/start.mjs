import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const envPath = resolve(cwd, ".env.local");
let saved = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (!saved.includes("PILOT_INSTANCE_SECRET=")) {
  saved += `PILOT_INSTANCE_SECRET=${randomBytes(32).toString("hex")}\n`;
}
writeFileSync(envPath, saved, { mode: 0o600 });
chmodSync(envPath, 0o600);
const compose = ["compose", "--env-file", envPath, "-f", "local/docker-compose.yaml"];
const up = spawnSync("docker", [...compose, "up", "-d", "--wait"], { cwd, stdio: "inherit" });
if (up.status !== 0) process.exit(up.status ?? 1);
const key = spawnSync("docker", [...compose, "exec", "-T", "backend", "./generate_admin_key.sh"], { cwd, encoding: "utf8" });
if (key.status !== 0) throw new Error("Could not generate the pilot admin key.");
const adminKey = key.stdout.trim().split("\n").at(-1);
if (!adminKey?.includes("|")) throw new Error("Unexpected admin-key format; value withheld.");
saved = saved.replace(/^CONVEX_SELF_HOSTED_(URL|ADMIN_KEY)=.*\n?/gm, "");
saved += `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:43210\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`;
writeFileSync(envPath, saved, { mode: 0o600 });
console.log("Pilot Convex is healthy at http://127.0.0.1:43210; private credentials saved in .env.local.");
