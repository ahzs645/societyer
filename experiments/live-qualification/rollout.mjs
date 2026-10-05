/** Reproducible isolated production transport qualification. Never a public deployment. */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, X509Certificate, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../.."), privateDirectory = resolve(root, "tmp/offline-rollout-tls");
process.chdir(root);
process.loadEnvFile(resolve(here, ".env.local"));
const accounts = JSON.parse(readFileSync(resolve(here, ".env.accounts.local"), "utf8"));
if (process.env.CONVEX_SELF_HOSTED_URL !== "http://127.0.0.1:43230" || accounts.convexUrl !== "http://127.0.0.1:43230"
    || !process.env.CONVEX_SELF_HOSTED_ADMIN_KEY?.startsWith("societyer-live-qualification|")) throw new Error("Only the isolated qualification backend is permitted.");
const issuer = "https://societyer-qualification.test:43479", originalIssuer = "http://127.0.0.1:43477";
const endpoint = "https://sync-qualification.test:43229";
const baseEnvironment = { ...process.env };
const httpsEnvironment = { ...baseEnvironment, AUTH_SERVER_PORT: "43488", AUTH_DB_PATH: resolve(privateDirectory, "auth.sqlite"),
  BETTER_AUTH_BASE_URL: issuer, VITE_AUTH_BASE_URL: issuer, BETTER_AUTH_JWKS_URL: "http://host.docker.internal:43488/api/auth/jwks",
  VITE_POWERSYNC_MEETING_PREPARATION: "1", SOCIETYER_POWERSYNC_ENABLED: "1", PS_PUBLIC_ORIGIN: endpoint, SOCIETYER_FROZEN_QUALIFICATION: "1" };
function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: root, env: baseEnvironment, encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`Qualification command failed: ${binary}; private command output is withheld.`);
  return result.stdout ?? "";
}
function foreground(binary, args, env = baseEnvironment) {
  const child = spawn(binary, args, { cwd: root, env, stdio: "inherit" });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
const command = process.argv[2];
if (command === "prepare") {
  mkdirSync(privateDirectory, { recursive: true, mode: 0o755 });
  if (!existsSync(resolve(privateDirectory, "server.key"))) {
    run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", resolve(privateDirectory, "ca.key"), "-out", resolve(privateDirectory, "ca.crt"), "-days", "2", "-subj", "/CN=Disposable Societyer qualification CA", "-addext", "basicConstraints=critical,CA:TRUE"]);
    run("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", resolve(privateDirectory, "server.key"), "-out", resolve(privateDirectory, "server.csr"), "-subj", "/CN=societyer-qualification.test"]);
    writeFileSync(resolve(privateDirectory, "server.ext"), "subjectAltName=DNS:societyer-qualification.test,DNS:sync-qualification.test\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n");
    run("openssl", ["x509", "-req", "-in", resolve(privateDirectory, "server.csr"), "-CA", resolve(privateDirectory, "ca.crt"), "-CAkey", resolve(privateDirectory, "ca.key"), "-CAcreateserial", "-out", resolve(privateDirectory, "server.crt"), "-days", "2", "-extfile", resolve(privateDirectory, "server.ext")]);
    chmodSync(resolve(privateDirectory, "ca.key"), 0o600); chmodSync(resolve(privateDirectory, "server.key"), 0o600);
  }
  if (!existsSync(resolve(privateDirectory, "auth.sqlite"))) {
    const database = new DatabaseSync(process.env.AUTH_DB_PATH);
    database.exec(`VACUUM INTO '${resolve(privateDirectory, "auth.sqlite").replaceAll("'", "''")}'`); database.close();
    chmodSync(resolve(privateDirectory, "auth.sqlite"), 0o600);
  }
  if (!existsSync(resolve(privateDirectory, "sync.env"))) {
    writeFileSync(resolve(privateDirectory, "sync.env"), `PS_CONVEX_DEPLOY_KEY=${accounts.adminKey}\nSYNC_STORAGE_PASSWORD=${randomBytes(24).toString("hex")}\n`, { mode: 0o600 });
  }
  console.log("Disposable certificate, private Better Auth database backup and separate replication credentials prepared.");
} else if (command === "proxy") {
  foreground(process.execPath, [resolve(here, "rollout/tls-proxy.mjs")]);
} else if (command === "auth") {
  foreground(resolve(root, "node_modules/.bin/tsx"), ["server/auth-server.ts"], httpsEnvironment);
} else if (command === "web") {
  foreground(resolve(root, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", "43478", "--strictPort"], httpsEnvironment);
} else if (command === "sync" || command === "stop-sync") {
  if (command === "sync") {
    // Both allowlist files contain configuration only; the service runs as a separate unprivileged container user.
    chmodSync(resolve(here, "rollout/service.yaml"), 0o644);
    chmodSync(resolve(root, "deploy/powersync/sync-config.yaml"), 0o644);
  }
  const dockerEnvironment = { ...baseEnvironment };
  for (const name of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnvironment[name];
  run("docker", ["--host=unix:///var/run/docker.sock", "compose", "--env-file", resolve(privateDirectory, "sync.env"), "-f", resolve(here, "rollout/docker-compose.yaml"), ...(command === "sync" ? ["up", "-d", "--wait"] : ["stop"])], { stdio: "inherit", env: dockerEnvironment });
} else if (command === "deploy" || command === "restore") {
  const restoring = command === "restore";
  const env = restoring ? baseEnvironment : httpsEnvironment;
  const cli = resolve(root, "node_modules/.bin/convex");
  run(cli, ["env", "set", "OFFLINE_MEETING_PREPARATION_ENABLED", "1"], { cwd: here, env });
  run(process.execPath, ["setup.mjs", "deploy"], { cwd: here, env, stdio: "inherit" });
  const admin = new ConvexHttpClient(accounts.convexUrl, { logger: false }); admin.setAdminAuth(accounts.adminKey);
  const bindings = await admin.function(makeFunctionReference("offlineRolloutFixture:migrateIssuer"), undefined,
    { userIds: Object.values(accounts.fixture.users), from: restoring ? issuer : originalIssuer, to: restoring ? originalIssuer : issuer });
  console.log(`Disposable account issuer ${restoring ? "restoration" : "migration"} verified for ${bindings.changed} bindings.`);
} else if (command === "test") {
  const certificate = new X509Certificate(readFileSync(resolve(privateDirectory, "server.crt")));
  const spki = certificate.publicKey.export({ type: "spki", format: "der" });
  const env = { ...baseEnvironment, OFFLINE_ROLLOUT_URL: issuer, OFFLINE_ROLLOUT_TEST_DNS: "1",
    OFFLINE_ROLLOUT_TEST_CERT_SPKI: createHash("sha256").update(spki).digest("base64"),
    NO_PROXY: `${process.env.NO_PROXY ?? ""},societyer-qualification.test,sync-qualification.test`,
    no_proxy: `${process.env.no_proxy ?? ""},societyer-qualification.test,sync-qualification.test` };
  foreground(resolve(root, "node_modules/.bin/playwright"), ["test", "-c", "playwright.offline-rollout.config.ts", ...process.argv.slice(3)], env);
} else if (command === "cleanup") {
  const admin = new ConvexHttpClient(accounts.convexUrl, { logger: false }); admin.setAdminAuth(accounts.adminKey);
  const meetings = await admin.function(makeFunctionReference("roleFixture:inspect"), undefined, { societyId: accounts.fixture.societyA, table: "meetings" });
  let removed = 0;
  for (const meeting of meetings) {
    const prefix = /^Rollout qualification [a-f0-9-]{36}/.exec(meeting.title ?? "")?.[0];
    if (prefix) removed += (await admin.function(makeFunctionReference("offlineRolloutFixture:cleanPreparedMeetings"), undefined, { societyId: accounts.fixture.societyA, prefix })).removed;
  }
  console.log(`Disposable qualification cleanup verified: ${removed} interrupted meeting graphs removed.`);
} else throw new Error("Use prepare, proxy, auth, web, sync, deploy, test, cleanup, restore or stop-sync.");
