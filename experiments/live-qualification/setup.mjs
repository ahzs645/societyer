import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, chmodSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const privateEnv = resolve(here, ".env.local");
const command = process.argv[2];
function run(bin, args, cwd = here, quiet = false) {
  const result = spawnSync(bin, args, { cwd, env: process.env, encoding: "utf8", stdio: quiet ? "pipe" : "inherit" });
  if (result.status !== 0) throw new Error(`Qualification command failed: ${bin} ${args[0]} (exit ${result.status}); inspect local logs.`);
  return result.stdout;
}
if (command === "start" && !existsSync(privateEnv)) {
  const secret = () => randomBytes(32).toString("hex");
  const settings = { QUALIFICATION_INSTANCE_SECRET: secret(), SOCIETYER_MAINTENANCE_TOKEN: secret(), SOCIETYER_API_PLATFORM_TOKEN: secret(),
    BETTER_AUTH_SECRET: secret(), AUTH_MODE: "better-auth", VITE_AUTH_MODE: "better-auth", AUTH_SERVER_PORT: "43487",
    AUTH_DB_PATH: resolve(root, "tmp/live-qualification-auth.sqlite"), BETTER_AUTH_BASE_URL: "http://127.0.0.1:43477",
    VITE_AUTH_BASE_URL: "http://127.0.0.1:43477", CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:43230",
    VITE_CONVEX_URL: "http://127.0.0.1:43230", CONVEX_URL: "http://127.0.0.1:43230", VITE_RUNTIME_MODE: "convex-self-hosted", VITE_DOCUMENT_STORAGE_PROVIDER: "convex",
    BETTER_AUTH_JWKS_URL: "http://host.docker.internal:43487/api/auth/jwks", OFFLINE_LOCAL_QUALIFICATION: "1", OFFLINE_MEETING_PREPARATION_ENABLED: "1", NODE_ENV: "development" };
  writeFileSync(privateEnv, Object.entries(settings).map(([key, value]) => `${key}=${value}\n`).join(""), { mode: 0o600 });
}
if (!existsSync(privateEnv)) throw new Error("Run npm start first.");
chmodSync(privateEnv, 0o600);
// Each disposable deployment keeps its own durable private vault key. Tests
// exercise actual encrypted storage without the development fallback key.
if (!/^SECRET_VAULT_ENCRYPTION_KEY=/m.test(readFileSync(privateEnv, "utf8"))) {
  writeFileSync(privateEnv, readFileSync(privateEnv, "utf8") + `SECRET_VAULT_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
}
process.loadEnvFile(privateEnv);
if (process.env.CONVEX_SELF_HOSTED_URL !== "http://127.0.0.1:43230") throw new Error("Qualification requires the isolated loopback backend.");
const compose = ["compose", "--env-file", privateEnv, "-f", "docker-compose.yaml"];
if (command === "start") {
  run("docker", [...compose, "up", "-d", "--wait"]);
  const key = run("docker", [...compose, "exec", "-T", "backend", "./generate_admin_key.sh"], here, true).trim().split("\n").at(-1);
  if (!key?.startsWith("societyer-live-qualification|")) throw new Error("Unexpected qualification admin key; value withheld.");
  const saved = readFileSync(privateEnv, "utf8").replace(/^CONVEX_SELF_HOSTED_ADMIN_KEY=.*\n?/gm, "");
  writeFileSync(privateEnv, saved + `CONVEX_SELF_HOSTED_ADMIN_KEY=${key}\n`, { mode: 0o600 });
  console.log("Qualification Convex is healthy at http://127.0.0.1:43230.");
} else if (command === "deploy") {
  if (!process.env.CONVEX_SELF_HOSTED_ADMIN_KEY?.startsWith("societyer-live-qualification|")) throw new Error("Isolated instance key required.");
  const overlay = resolve(root, "tmp/live-qualification-functions");
  rmSync(overlay, { recursive: true, force: true });
  mkdirSync(overlay, { recursive: true });
  // Convex's function glob ignores symlinks. Real entry wrappers preserve the
  // original imports/domain code and expose its actual registered functions.
  function entries(source, target) {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.name === "_generated") continue;
      const input = resolve(source, entry.name), output = resolve(target, entry.name);
      if (entry.isDirectory()) { mkdirSync(output, { recursive: true }); entries(input, output); }
      else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        if (existsSync(output)) throw new Error(`Fixture would shadow production function ${entry.name}.`);
        let module = relative(dirname(output), input).replaceAll("\\", "/").replace(/\.(ts|js)$/, "");
        if (!module.startsWith(".")) module = `./${module}`;
        const sourceText = readFileSync(input, "utf8");
        const nodeDirective = /^\s*["']use node["'];?/m.test(sourceText) ? '"use node";\n' : "";
        const defaultExport = /export\s+default\b/.test(sourceText) ? `export { default } from ${JSON.stringify(module)};\n` : "";
        writeFileSync(output, `${nodeDirective}${defaultExport}export * from ${JSON.stringify(module)};\n`);
      }
    }
  }
  entries(resolve(root, "convex"), overlay);
  entries(resolve(here, "convex"), overlay);
  const cli = resolve(root, "node_modules/.bin/convex");
  process.env.OFFLINE_MEETING_PREPARATION_ENABLED ??= "1";
  for (const name of ["OFFLINE_MEETING_PREPARATION_ENABLED", "AUTH_MODE", "VITE_AUTH_MODE", "BETTER_AUTH_BASE_URL", "VITE_AUTH_BASE_URL", "BETTER_AUTH_JWKS_URL", "OFFLINE_LOCAL_QUALIFICATION", "SOCIETYER_MAINTENANCE_TOKEN", "SOCIETYER_API_PLATFORM_TOKEN", "SECRET_VAULT_ENCRYPTION_KEY"]) {
    run(cli, ["env", "set", name, process.env[name]], here, true);
  }
  run(cli, ["dev", "--once", "--typecheck", "disable", "--codegen", "disable"]);
} else if (command === "auth") {
  run(resolve(root, "node_modules/.bin/tsx"), ["server/auth-server.ts"], root);
} else if (command === "web") {
  process.env.SOCIETYER_FROZEN_QUALIFICATION = "1";
  run(resolve(root, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", "43477", "--strictPort"], root);
} else if (command === "seed" || command === "accounts") {
  const client = new ConvexHttpClient(process.env.CONVEX_SELF_HOSTED_URL, { logger: false });
  client.setAdminAuth(process.env.CONVEX_SELF_HOSTED_ADMIN_KEY);
  const roles = ["Owner", "Admin", "Director", "Member", "Viewer"];
  const specs = roles.map(role => ({ key: `${role.toLowerCase()}-a`, role, status: "Active" }));
  specs.push({ key: "disabled-a", role: "Admin", status: "Disabled" }, { key: "invited-a", role: "Admin", status: "Invited" }, { key: "owner-b", role: "Owner", status: "Active" });
  const credentialsPath = resolve(here, ".env.accounts.local");
  if (existsSync(credentialsPath)) throw new Error("Refusing to reset a populated qualification dataset; use its existing fixture.");
  const draftPath = resolve(here, ".env.accountdraft.local");
  const accounts = existsSync(draftPath) ? JSON.parse(readFileSync(draftPath, "utf8")) : [];
  const runId = randomBytes(6).toString("hex");
  for (const spec of specs) {
    if (accounts.some(value => value.key === spec.key)) continue;
    const email = `${spec.key}-${runId}@qualification.example.test`, password = `Pilot-${randomBytes(18).toString("hex")}`;
    const response = await fetch("http://127.0.0.1:43487/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: process.env.BETTER_AUTH_BASE_URL }, body: JSON.stringify({ email, password, name: spec.key }) });
    if (!response.ok) throw new Error(`Qualification signup ${spec.key} failed with ${response.status}.`);
    const body = await response.json();
    accounts.push({ ...spec, email, password, subject: body.user.id });
    writeFileSync(draftPath, JSON.stringify(accounts), { mode: 0o600 });
  }
  if (command === "accounts") { console.log("Real qualification accounts prepared; private draft saved."); process.exit(0); }
  const owner = accounts.find(value => value.key === "owner-a");
  const seeded = await client.function(makeFunctionReference("roleFixture:seedDemo"), undefined, { owner: { issuer: process.env.BETTER_AUTH_BASE_URL, subject: owner.subject, email: owner.email } });
  const fixture = await client.function(makeFunctionReference("roleFixture:seed"), undefined, { societyId: seeded.societyId, issuer: process.env.BETTER_AUTH_BASE_URL,
    identities: accounts.map(({ key, subject, email, role, status }) => ({ key, subject, email, role, status })) });
  await client.mutation(makeFunctionReference("seedRecordTableMetadata:runForSociety"), { societyId: fixture.societyA, serviceToken: process.env.SOCIETYER_MAINTENANCE_TOKEN });
  const config = { convexUrl: process.env.CONVEX_SELF_HOSTED_URL, authUrl: "http://127.0.0.1:43487", appUrl: "http://127.0.0.1:43477", issuer: process.env.BETTER_AUTH_BASE_URL,
    adminKey: process.env.CONVEX_SELF_HOSTED_ADMIN_KEY, fixture, accounts };
  writeFileSync(credentialsPath, JSON.stringify(config), { mode: 0o600 });
  const publicRows = {};
  for (const table of ["societies", "users", "members", "directors", "meetings", "minutes", "committees", "documents", "elections", "motions", "proxies", "conflicts", "filings", "deadlines", "tasks", "assets", "volunteers", "grants", "workflows", "objectMetadata", "views"]) {
    publicRows[table] = await client.function(makeFunctionReference("roleFixture:inspect"), undefined, { societyId: fixture.societyA, table });
  }
  const identities = Object.fromEntries(accounts.map(value => [value.key === "owner-b" ? "ForeignOwner" : value.role, { email: value.email, password: value.password, key: value.key }]).filter(([, value]) => !value.key.startsWith("disabled") && !value.key.startsWith("invited")));
  writeFileSync(resolve(root, "tmp/live-interface-fixture.json"), JSON.stringify({ societyId: fixture.societyA, societyB: fixture.societyB, identities, rows: publicRows, ids: {}, issuer: config.issuer, appUrl: config.appUrl }), { mode: 0o600 });
  console.log(`Seeded isolated production dataset and ${accounts.length} real Better Auth identities; private fixture configuration saved.`);
} else throw new Error("Use start, deploy, auth, web, accounts or seed.");
