import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { createServer } from "node:https";
import { createHash, X509Certificate } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Uses real Electron/main-process code and a pinned disposable HTTPS fixture. This is not a live SSO/Convex qualification.
const root = process.cwd();
const require = createRequire(import.meta.url);
const executablePath = process.env.SOCIETYER_TEST_ELECTRON_EXECUTABLE || require("electron");
const distRoot = path.resolve(process.env.SOCIETYER_TEST_DESKTOP_DIST || "tmp/desktop-dual-mode-dist");
assert.ok(existsSync(path.join(distRoot, "index.html")), "Build the desktop renderer first; set SOCIETYER_TEST_DESKTOP_DIST if using another output directory.");
assert.ok(existsSync(path.join(root, "dist-electron/electron/desktopMode.js")), "Compile Electron main with npm run desktop:build:main first.");
await mkdir(path.join(root, "tmp"), { recursive: true });
const temporary = await mkdtemp(path.join(root, "tmp/desktop-mode-runtime-"));
await mkdir(path.join(temporary, "user-data"));
const certificate = path.join(temporary, "certificate.pem");
const privateKey = path.join(temporary, "private-key.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", privateKey,
  "-out", certificate, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
const cert = await readFile(certificate);
const pin = createHash("sha256").update(new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" })).digest("base64");
const tls = { key: await readFile(privateKey), cert };
const html = (title) => `<!doctype html><title>${title}</title><h1>${title}</h1><p>Isolated hosted app fixture</p>`;
const server = createServer(tls, (_request, response) => { response.setHeader("content-type", "text/html"); response.end(html("Hosted fixture")); });
const sockets = new Set();
server.on("upgrade", (request, socket) => {
  const accepted = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accepted}\r\n\r\n`);
  sockets.add(socket);
  socket.on("data", (frame) => { if ((frame[0] & 0x0f) === 8) socket.end(Buffer.from([0x88, 0x00])); });
  socket.on("end", () => socket.end());
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => {});
});
const identityServer = createServer(tls, (_request, response) => { response.setHeader("content-type", "text/html"); response.end(html("Sign-in fixture")); });
const listen = (target) => new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
await listen(server);
await listen(identityServer);
const origin = `https://localhost:${server.address().port}`;
const authenticationOrigin = `https://localhost:${identityServer.address().port}`;
const harness = path.join(root, "dist-electron/electron/desktopModeQualification.mjs");
await writeFile(harness, `
import { app, dialog } from "electron";
import { createDesktopEnvironment } from "./environment.js";
import { registerIpc } from "./ipc.js";
import { registerDesktopProtocolPrivileges, registerDesktopAppProtocol } from "./protocol.js";
import { createMainWindow } from "./window.js";
import { configureDesktopModes, getDesktopModeState, openHostedMode, returnToLocalMode, resumeDesktopMode } from "./desktopMode.js";
import { ensureWorkspace } from "./workspace.js";
import { configureApplicationMenu } from "./menu.js";
app.setPath("userData", process.env.SOCIETYER_QUALIFICATION_USER_DATA);
app.commandLine.appendSwitch("ignore-certificate-errors-spki-list", process.env.SOCIETYER_QUALIFICATION_CERTIFICATE_PIN);
app.commandLine.appendSwitch("no-proxy-server");
registerDesktopProtocolPrivileges();
const environment = createDesktopEnvironment(import.meta.dirname);
environment.distIndexPath = process.env.SOCIETYER_QUALIFICATION_DIST_INDEX;
environment.isDev = false;
environment.devServerUrl = undefined;
let local;
configureDesktopModes(async () => {
 if (!local || local.isDestroyed()) local = await createMainWindow({environment});
 return local;
});
registerIpc(environment);
globalThis.__desktopQualification = {getDesktopModeState, openHostedMode, returnToLocalMode};
globalThis.__blockedNavigation = 0;
dialog.showMessageBox = async () => { globalThis.__blockedNavigation += 1; return {response:0, checkboxChecked:false}; };
app.on("window-all-closed", () => app.quit());
app.whenReady().then(async () => {
 registerDesktopAppProtocol(environment);
 configureApplicationMenu(environment);
 await ensureWorkspace();
 local = await createMainWindow({environment});
 await resumeDesktopMode();
});
`);
let application;
let xServer;
let display = process.env.DISPLAY;
const cases = [];
const record = (name) => { cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
try {
  if (!display) {
    const xExecutable = process.env.SOCIETYER_TEST_XVFB || path.join(root, "tmp/desktop-runtime/xvfb/usr/bin/Xvfb");
    assert.ok(existsSync(xExecutable), "Provide DISPLAY or SOCIETYER_TEST_XVFB for headless Electron checks.");
    display = ":93";
    xServer = spawn(xExecutable, [display, "-screen", "0", "1600x1000x24", "-ac", "-nolisten", "tcp"], {
      stdio: "ignore", env: { ...process.env, LD_LIBRARY_PATH: path.join(root, "tmp/desktop-runtime/xvfb/usr/lib/x86_64-linux-gnu") },
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(xServer.exitCode, null, "Xvfb did not start.");
  }
  const launch = () => electron.launch({ executablePath, args: ["--no-sandbox", harness], timeout: 30000,
    env: { ...process.env, DISPLAY: display, VITE_DEV_SERVER_URL: "", SOCIETYER_ELECTRON_DEV: "",
      SOCIETYER_QUALIFICATION_USER_DATA: path.join(temporary, "user-data"),
      SOCIETYER_QUALIFICATION_CERTIFICATE_PIN: pin,
      SOCIETYER_QUALIFICATION_DIST_INDEX: path.join(distRoot, "index.html"),
      SOCIETYER_WORKSPACE_DIR: path.join(temporary, "local-vault"),
    } });
  application = await launch();
  const local = await application.firstWindow();
  await local.waitForFunction(() => !!window.societyerDesktop);
  const file = await local.evaluate(async () => {
    localStorage.setItem("desktop-qualification-local", "retained");
    const bridge = window.societyerDesktop;
    const version = await bridge.writeDocumentVersion({ societyId: "local-qualification", documentId: "retained-file",
      fileName: "retained.txt", bytes: new TextEncoder().encode("Offline local vault stays intact.").buffer });
    return { key: version.key, workspace: await bridge.getWorkspaceInfo() };
  });
  assert.ok(file.workspace.rootPath);
  record("Bundled local renderer and native workspace/file APIs");
  await assert.rejects(local.evaluate(() => window.societyerDesktop.openHostedMode({ origin: "http://example.com", authenticationOrigins: [] })));
  record("HTTP hosted origin rejected before navigation");
  await local.evaluate(async ({ origin, authenticationOrigin }) => {
    await window.societyerDesktop.openHostedMode({ origin, authenticationOrigins: [authenticationOrigin] });
  }, { origin, authenticationOrigin });
  let hosted = application.windows().find((page) => page.url().startsWith(origin));
  assert.ok(hosted);
  assert.equal(await hosted.evaluate(() => typeof window.societyerDesktop), "undefined");
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().startsWith("https:"));
    const prefs = window.webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, preload: prefs.preload };
  });
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.ok(!preferences.preload);
  await hosted.evaluate(() => { localStorage.setItem("desktop-qualification-hosted", "retained"); document.cookie = "qualification=retained; Secure; SameSite=Lax; Path=/"; });
  record("HTTPS hosted mode sandboxed without native bridge");
  await hosted.evaluate(() => new Promise((resolve, reject) => {
    window.__qualificationSocket = new WebSocket(location.origin.replace("https:", "wss:"));
    window.__qualificationSocket.onopen = () => resolve(true);
    window.__qualificationSocket.onerror = () => reject(new Error("Fixture WebSocket did not open."));
  }));
  const popupPromise = application.waitForEvent("window");
  await hosted.evaluate((url) => window.open(url, "qualification-sign-in"), authenticationOrigin);
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(await popup.evaluate(() => typeof window.societyerDesktop), "undefined");
  await popup.evaluate((url) => { window.location.href = `${url}/api/auth/callback?code=fixture`; }, origin);
  await popup.waitForURL(`${origin}/api/auth/callback?code=fixture`);
  record("Explicit HTTPS SSO popup and callback isolated from native APIs");
  await popup.close();
  await hosted.evaluate(() => { window.location.href = "https://untrusted-qualification.invalid/?code=fixture"; });
  await hosted.waitForTimeout(200);
  assert.equal(new URL(hosted.url()).origin, origin);
  assert.equal(await application.evaluate(() => globalThis.__blockedNavigation), 1);
  record("Unlisted authentication navigation blocked");
  await application.evaluate(({ Menu }) => {
    Menu.getApplicationMenu().items.find((item) => item.label === "File").submenu.items
      .find((item) => item.label === "Return to Local Workspace").click();
  });
  await assertMode(application, "local");
  assert.equal(hosted.isClosed(), true);
  for (let attempt = 0; sockets.size && attempt < 50; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(sockets.size, 0);
  record("Returning locally closes hosted renderer and existing WebSockets");
  assert.equal(await local.evaluate(() => localStorage.getItem("desktop-qualification-local")), "retained");
  assert.equal(await local.evaluate(async (key) => new TextDecoder().decode(await window.societyerDesktop.readDocumentVersion({ key })), file.key), "Offline local vault stays intact.");
  record("Returning locally retains records and native file bytes");
  await local.evaluate(() => window.societyerDesktop.openHostedMode());
  hosted = application.windows().find((page) => page.url().startsWith(origin));
  assert.equal(await hosted.evaluate(async () => (await fetch(`/probe?online-mode=${Date.now()}`)).ok), true);
  assert.equal(await hosted.evaluate(() => localStorage.getItem("desktop-qualification-hosted")), "retained");
  assert.match(await hosted.evaluate(() => document.cookie), /qualification=retained/);
  record("Reopening hosted mode retains origin-scoped web session");
  await application.close(); application = undefined;
  application = await launch();
  await application.firstWindow();
  await assertMode(application, "online");
  const resumed = application.windows().find((page) => page.url().startsWith(origin));
  assert.ok(resumed);
  await resumed.waitForLoadState();
  assert.equal(await resumed.evaluate(() => localStorage.getItem("desktop-qualification-hosted")), "retained");
  record("Restart resumes configured online mode and persistent session");
  await application.evaluate(() => globalThis.__desktopQualification.returnToLocalMode());
  await application.evaluate((_electron, next) => globalThis.__desktopQualification.openHostedMode({ origin: next, authenticationOrigins: [] }), authenticationOrigin);
  await assertMode(application, "online");
  const other = application.windows().find((page) => page.url().startsWith(authenticationOrigin));
  assert.equal(await other.evaluate(() => localStorage.getItem("desktop-qualification-hosted")), null);
  record("Different hosted origins use separate persistent partitions");
  await application.evaluate(() => globalThis.__desktopQualification.returnToLocalMode());
  await assert.rejects(application.evaluate(() => globalThis.__desktopQualification.openHostedMode({ origin: "https://localhost:1", authenticationOrigins: [] })));
  await assertMode(application, "local");
  const restored = application.windows().find((page) => page.url().startsWith("societyer-app:"));
  assert.equal(await restored.evaluate(async (key) => new TextDecoder().decode(await window.societyerDesktop.readDocumentVersion({ key })), file.key), "Offline local vault stays intact.");
  record("Unavailable online endpoint falls back safely with local file intact");
  // Exercise narrow layout on the actual bundled setup screen, not on the hosted fixture.
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().startsWith("societyer-app:"));
    window.setSize(390, 844);
  });
  await restored.evaluate(() => { location.hash = "#/app/setup"; });
  await restored.getByRole("region", { name: "Desktop workspace modes" }).waitFor();
  assert.equal(await restored.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  record("Actual bundled desktop setup fits narrow 390px window");
  await mkdir(path.join(root, "artifacts/offline"), { recursive: true });
  await writeFile(path.join(root, "artifacts/offline/desktop-dual-mode-runtime.json"), `${JSON.stringify({
    kind: "actual-electron-main-and-bundled-renderer-with-disposable-https-fixture", electronVersion: "42.3.0", cases,
    limits: ["Hosted fixture is not live Convex or enterprise SSO", "No signed macOS or Windows installer qualification", "Local and hosted datasets are separate"],
  }, null, 2)}\n`);
  console.log(`Desktop dual-mode runtime checks passed (${cases.length}/${cases.length}).`);
} finally {
  if (application) await application.close().catch(() => {});
  xServer?.kill();
  for (const socket of sockets) socket.destroy();
  server.close(); identityServer.close();
  await rm(harness, { force: true });
  await rm(temporary, { recursive: true, force: true });
}

async function assertMode(application, mode) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await application.evaluate(() => globalThis.__desktopQualification.getDesktopModeState()).then((state) => state.mode === mode && state.startupMode === mode)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Desktop mode did not become ${mode}.`);
}
