import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// An unsigned, unpublished Linux directory package qualification, never a release command.
assert.equal(process.platform, "linux", "This smoke check qualifies the available Linux runtime only.");
const root = process.cwd();
const require = createRequire(import.meta.url);
const renderer = path.resolve(process.env.SOCIETYER_TEST_DESKTOP_DIST || "tmp/desktop-dual-mode-dist");
assert.ok(existsSync(path.join(renderer, "index.html")), "Build an electron-local renderer first.");
const scratch = path.join(root, "tmp/desktop-linux-package");
await mkdir(scratch, { recursive: true });
const config = JSON.parse(await readFile(path.join(root, "electron-builder.json"), "utf8"));
config.directories = { ...config.directories, output: path.join(scratch, "output") };
config.electronDist = path.join(root, "node_modules/electron/dist");
config.files = [{ from: renderer, to: "dist", filter: ["**/*"] }, ...config.files.filter((entry) => entry !== "dist/**/*")];
config.publish = null;
const configFile = path.join(scratch, "qualification-builder.json");
await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
const builderLog = path.join(scratch, "builder.log");
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [require.resolve("electron-builder/cli.js"), "--config", configFile,
    "--linux", "--x64", "--dir", "--publish", "never"], { cwd: root, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
  let output = "";
  child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
  child.on("error", reject);
  child.on("exit", async (code) => { await writeFile(builderLog, output); code === 0 ? resolve() : reject(new Error(`Linux packaging failed; inspect the private log ${builderLog}.`)); });
});
const executable = path.join(scratch, "output/linux-unpacked/societyer");
assert.ok(existsSync(executable));
const archive = path.join(scratch, "output/linux-unpacked/resources/app.asar");
const asar = require("@electron/asar");
const entries = asar.listPackage(archive);
for (const entry of ["/dist/index.html", "/dist-electron/electron/main.js", "/dist-electron/electron/mediaPermissions.js", "/assets/electron/icon.png"]) {
  assert.ok(entries.includes(entry), `Packaged archive must include ${entry}.`);
}
for (const entry of entries) {
  assert.ok(!/\/(\.env[^/]*|certificate\.pem|private-key\.pem|desktopModeQualification\.mjs)$/.test(entry), "Package must exclude test certificates, harness and environment files.");
}
const profile = await mkdtemp(path.join(scratch, "profile-"));
let application, xServer;
let display = process.env.DISPLAY;
try {
  if (!display) {
    const xExecutable = process.env.SOCIETYER_TEST_XVFB || path.join(root, "tmp/desktop-runtime/xvfb/usr/bin/Xvfb");
    assert.ok(existsSync(xExecutable), "Provide DISPLAY or SOCIETYER_TEST_XVFB.");
    display = ":93";
    xServer = spawn(xExecutable, [display, "-screen", "0", "1600x1000x24", "-ac", "-nolisten", "tcp"], {
      stdio: "ignore", env: { ...process.env, LD_LIBRARY_PATH: path.join(root, "tmp/desktop-runtime/xvfb/usr/lib/x86_64-linux-gnu") },
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(xServer.exitCode, null);
  }
  application = await electron.launch({ executablePath: executable, args: ["--no-sandbox", `--user-data-dir=${profile}`], timeout: 30000,
    env: { ...process.env, DISPLAY: display, XDG_CONFIG_HOME: path.join(profile, "config"), XDG_CACHE_HOME: path.join(profile, "cache"),
      VITE_DEV_SERVER_URL: "", SOCIETYER_ELECTRON_DEV: "", SOCIETYER_WORKSPACE_DIR: path.join(profile, "local-vault") } });
  const page = await application.firstWindow();
  await page.waitForFunction(() => !!window.societyerDesktop);
  await page.getByRole("heading", { name: "Welcome to Societyer Desktop" }).waitFor({ timeout: 30000 });
  const metadata = await page.evaluate(() => window.societyerDesktop.getAppInfo());
  assert.equal(metadata.isPackaged, true);
  assert.equal(metadata.runtimeMode, "electron-local");
  assert.ok(metadata.userDataPath.startsWith(`${profile}${path.sep}`), "The production userData migration must remain inside the disposable appData profile.");
  const contents = "Packaged Linux offline vault verification.";
  const data = await page.evaluate(async (contents) => {
    const version = await window.societyerDesktop.writeDocumentVersion({ societyId: "package-qualification", documentId: "offline-file",
      fileName: "offline.txt", bytes: new TextEncoder().encode(contents).buffer });
    return new TextDecoder().decode(await window.societyerDesktop.readDocumentVersion({ key: version.key }));
  }, contents);
  assert.equal(data, contents);
  await application.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }));
  await page.reload();
  await page.getByRole("heading", { name: "Welcome to Societyer Desktop" }).waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  const results = { kind: "actual-unsigned-unpublished-linux-directory-package", platform: "linux", arch: "x64",
    electronVersion: metadata.electronVersion, cases: ["Linux electron-builder directory package produced", "ASAR contains bundled renderer, native main, camera policy and assets",
      "ASAR excludes qualification harness, environment files and test certificates", "Actual packaged app boots bundled desktop screen", "Production userData/migration is isolated inside disposable appData", "Packaged native vault writes and reads file bytes", "Bundled screen reloads offline"].map((name) => ({ name, passed: true })),
    limits: ["Directory package only; AppImage installer not qualified", "No macOS or Windows execution, signing or notarization", "No public release or deployment", "No physical camera or enterprise SSO qualification"] };
  await mkdir(path.join(root, "artifacts/offline"), { recursive: true });
  await writeFile(path.join(root, "artifacts/offline/desktop-linux-package.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Packaged Linux directory smoke passed (${results.cases.length}/${results.cases.length}).`);
} finally {
  if (application) await application.close().catch(() => {});
  xServer?.kill(); await rm(profile, { recursive: true, force: true });
}
