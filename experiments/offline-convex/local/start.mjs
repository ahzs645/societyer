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
if (!saved.includes("PILOT_SYNC_STORAGE_PASSWORD=")) {
  saved += `PILOT_SYNC_STORAGE_PASSWORD=${randomBytes(32).toString("hex")}\n`;
}
writeFileSync(envPath, saved, { mode: 0o600 });
chmodSync(envPath, 0o600);
const compose = ["compose", "--env-file", envPath, "-f", "local/docker-compose.yaml"];
const docker = existsSync("/var/run/docker.sock") ? ["--host=unix:///var/run/docker.sock"] : [];
const dockerEnv = { ...process.env };
if (docker.length) for (const name of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnv[name];
const up = spawnSync("docker", [...docker, ...compose, "up", "-d", "--wait", "backend"], { cwd, stdio: "inherit", env: dockerEnv });
if (up.status !== 0) process.exit(up.status ?? 1);
const key = spawnSync("docker", [...docker, ...compose, "exec", "-T", "backend", "./generate_admin_key.sh"], { cwd, encoding: "utf8", env: dockerEnv });
if (key.status !== 0) throw new Error("Could not generate the pilot admin key.");
const adminKey = key.stdout.trim().split("\n").at(-1);
if (!adminKey?.includes("|")) throw new Error("Unexpected admin-key format; value withheld.");
saved = saved.replace(/^CONVEX_SELF_HOSTED_(URL|ADMIN_KEY)=.*\n?/gm, "");
saved += `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:43210\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`;
writeFileSync(envPath, saved, { mode: 0o600 });
console.log("Pilot Convex is healthy at http://127.0.0.1:43210; private credentials saved in .env.local.");
if (process.argv.includes("--powersync")) {
  // The service runs as UID 901; these templates contain no credential values.
  for (const file of ["powersync/service.yaml", "powersync/sync-config.yaml"]) chmodSync(resolve(cwd, file), 0o644);
  // PostgreSQL here is an isolated Docker-only service without a TLS listener.
  // PowerSync does not read sslmode from URI parameters. Keep this local choice
  // out of the deployment template, which retains verified TLS by default.
  const config = readFileSync(resolve(cwd, "powersync/service.yaml"), "utf8");
  writeFileSync(resolve(cwd, "local/.runtime-service.local.yaml"), config.replace("storage:\n  type: postgresql\n", "storage:\n  type: postgresql\n  sslmode: disable\n"), { mode: 0o644 });
  chmodSync(resolve(cwd, "local/.runtime-service.local.yaml"), 0o644);
  // Extend CA trust inside Node without baking this session's public CA into an image.
  if (process.env.CODEX_PROXY_CERT && existsSync(process.env.CODEX_PROXY_CERT)) {
    const override = resolve(cwd, "local/.runtime.compose.local.yaml");
    writeFileSync(override, JSON.stringify({ services: { powersync: { environment: { NODE_EXTRA_CA_CERTS: "/run/proxy-ca.pem" }, volumes: [`${process.env.CODEX_PROXY_CERT}:/run/proxy-ca.pem:ro`] } } }), { mode: 0o600 });
    compose.push("-f", override);
  }
  const result = spawnSync("docker", [...docker, ...compose, "--profile", "powersync", "up", "-d", "--wait", "powersync"], { cwd, stdio: "inherit", env: dockerEnv });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log("Pilot PowerSync is healthy at http://127.0.0.1:43220 (local-only HTTP audience).");
}
