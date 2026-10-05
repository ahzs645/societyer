import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { WebSocketServer } from "ws";
import { BlitzBrowserBackend } from "../services/connector-runner/src/blitzBrowserBackend";

let mode = "ok", probes = 0;
const server = createServer();
const webSockets = new WebSocketServer({ server });
webSockets.on("connection", socket => {
  probes++;
  if (mode === "closed") { socket.close(); return; }
  socket.on("message", raw => {
    const request = JSON.parse(raw.toString());
    if (mode === "malformed") { socket.send("not-json"); return; }
    if (mode === "silent") return;
    socket.send(JSON.stringify({ id: request.id, result: { product: "Chrome/Fixture", protocolVersion: "1.3" } }));
  });
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const cdp = `ws://127.0.0.1:${(server.address() as any).port}`;
const cases: string[] = [];
const pass = (name: string) => { cases.push(name); console.log(`PASS ${name}`); };
const backend = new BlitzBrowserBackend(cdp);
const freePort = createServer();
await new Promise<void>(resolve => freePort.listen(0, "127.0.0.1", resolve));
const runnerPort = (freePort.address() as any).port;
await new Promise<void>(resolve => freePort.close(() => resolve()));
const privateSecret = randomUUID();
const runner = spawn(process.execPath, ["--import", "tsx", "services/connector-runner/src/server.ts"], { cwd: process.cwd(), env: { ...process.env, CONNECTOR_RUNNER_PORT: String(runnerPort), CONNECTOR_RUNNER_SECRET: privateSecret, BLITZBROWSER_CDP_URL: cdp, NODE_ENV: "production" }, stdio: ["ignore", "ignore", "ignore"] });
const base = `http://127.0.0.1:${runnerPort}`;
const auth = { "x-connector-runner-secret": privateSecret };
const tenant = "ct1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (runner.exitCode !== null) throw new Error("Fixture runner exited before readiness");
    try { if ((await fetch(`${base}/livez`)).ok) break; } catch { /* bounded startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await new BlitzBrowserBackend("not-a-url").healthCheck()).ok, false);
  assert.equal((await new BlitzBrowserBackend("https://provider.example.test").healthCheck()).ok, false);
  assert.equal((await backend.healthCheck()).ok, true); pass("Blitz health validates protocol and receives a real local WebSocket CDP response");
  for (const failure of ["closed", "malformed", "silent"]) { mode = failure; assert.equal((await backend.healthCheck()).ok, false); }
  mode = "ok"; assert.equal((await backend.healthCheck()).ok, true); pass("closed, malformed and timed-out CDP fail readiness; subsequent read-only retry recovers");
  const beforeUnauthorized = probes;
  assert.equal((await fetch(`${base}/healthz`)).status, 401);
  assert.equal((await fetch(`${base}/healthz`, { headers: { "x-connector-runner-secret": "wrong-fixture-secret" } })).status, 401);
  const live = await fetch(`${base}/livez`); assert.equal(live.status, 200); assert.equal((await live.json()).ok, true);
  assert.equal(probes, beforeUnauthorized); pass("unauthorized readiness cannot allocate a browser connection; cheap liveness stays public");
  const ready = await fetch(`${base}/healthz`, { headers: auth }); assert.equal(ready.status, 200); assert.equal((await ready.json()).browser.ok, true);
  mode = "closed"; const unavailable = await fetch(`${base}/healthz`, { headers: auth }); assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).ok, false);
  mode = "ok"; assert.equal((await fetch(`${base}/healthz`, { headers: auth })).status, 200); pass("actual runner HTTP readiness reports 503 for unavailable provider and 200 after recovery");
  assert.equal((await fetch(`${base}/sessions`)).status, 401);
  assert.equal((await fetch(`${base}/sessions`, { headers: auth })).status, 400);
  const sessions = await fetch(`${base}/sessions`, { headers: { ...auth, "x-connector-tenant-key": tenant } }); assert.equal(sessions.status, 200); assert.deepEqual((await sessions.json()).sessions, []);
  const foreignSession = await fetch(`${base}/sessions/${randomUUID()}/stop`, { method: "POST", headers: { ...auth, "x-connector-tenant-key": tenant, "content-type": "application/json" }, body: "{}" }); assert.equal(foreignSession.status, 404); pass("actual runner secret, tenant namespace and unknown/foreign session checks fail closed");
  mode = "closed";
  const failedLogin = await fetch(`${base}/sessions/start-login`, { method: "POST", headers: { ...auth, "x-connector-tenant-key": tenant, "content-type": "application/json" }, body: JSON.stringify({ profileKey: "fixture-profile", liveView: false }) });
  assert.equal(failedLogin.status, 500);
  const failureBody = await failedLogin.text(); assert.ok(!failureBody.includes(privateSecret)); assert.ok(!failureBody.includes(cdp));
  const afterFailure = await fetch(`${base}/sessions`, { headers: { ...auth, "x-connector-tenant-key": tenant } }); assert.deepEqual((await afterFailure.json()).sessions, []); pass("real runner CDP login failure creates no active session and hides provider URL/credentials");
  await mkdir("artifacts/offline", { recursive: true });
  await writeFile("artifacts/offline/provider-runner-qualification.json", JSON.stringify({ sourceBaseline: "66b8dcd", executedAt: new Date().toISOString(), fixtureOnly: true, actualRunnerHttp: true, realBrowserProviderContacted: false, cases, count: cases.length, remaining: ["Configured BlitzBrowser runtime and authenticated external provider session qualification", "No physical browser/login or external account operation was exercised"] }, null, 2) + "\n");
  console.log(`Runner provider qualification: ${cases.length}/${cases.length} local protocol groups passed.`);
} finally {
  runner.kill("SIGTERM");
  for (const socket of webSockets.clients) socket.terminate();
  await new Promise<void>(resolve => webSockets.close(() => resolve()));
  await new Promise<void>(resolve => server.close(() => resolve()));
}
