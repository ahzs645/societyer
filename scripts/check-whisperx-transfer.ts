import assert from "node:assert/strict";
import { transcriptionRequest } from "../workers/meeting-transfer/transcription";
const env = { CONVEX_SITE_URL: "https://fixture.convex.site", MEETING_SOURCE_BROKER_KEY: "fixture-broker-with-32-characters", SHAREPOINT_TRANSFER_HOSTS: "storage.example.test" };
const key = "a".repeat(64); const payload = new TextEncoder().encode("synthetic audio");
const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", payload)), b => b.toString(16).padStart(2, "0")).join("");
const realFetch = globalThis.fetch; let corrupt = false; let redirect = false; let badHost = false; let controls = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)); const headers = new Headers(init?.headers);
  assert.equal(init?.redirect, "manual");
  if (url.hostname === "fixture.convex.site") {
    controls++; assert.equal(headers.get("x-transcription-key"), key); assert.equal(headers.get("x-societyer-broker"), env.MEETING_SOURCE_BROKER_KEY); assert.equal(headers.has("authorization"), false);
    if (redirect) return new Response(null, { status: 307, headers: { location: "https://untrusted.example.test" } });
    const data = JSON.parse(new TextDecoder().decode(init!.body as Uint8Array));
    if (data.operation === "claim") return Response.json({ job: null });
    return Response.json({ downloadUrl: badHost ? "https://attacker.example.test/recording" : "https://storage.example.test/pinned?private-token", offset: 0, length: payload.length, size: payload.length, hash });
  }
  assert.equal(url.hostname, "storage.example.test"); assert.equal(headers.has("authorization"), false); assert.equal(headers.has("x-transcription-key"), false); assert.equal(headers.get("range"), `bytes=0-${payload.length - 1}`);
  return new Response(corrupt ? new Uint8Array(payload.length).fill(1) : payload, { status: 206, headers: { "content-range": `bytes 0-${payload.length - 1}/${payload.length}`, "content-length": String(payload.length) } });
};
const call = (operation: string, token = key, body?: string) => transcriptionRequest(new Request("https://broker.example.test/meeting-transcription", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ?? JSON.stringify({ operation, data: { jobId: "fixture", lease: "lease", offset: 0 } }) }), env);
try {
  assert.equal((await call("claim", "wrong")).status, 403); assert.equal(controls, 0);
  assert.equal((await call("claim", key, "x".repeat(210_001))).status, 413);
  assert.deepEqual(await (await call("claim")).json(), { job: null });
  const downloaded = await call("download"); assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get("cache-control"), "no-store"); assert.equal(downloaded.headers.get("x-content-sha256"), hash); assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), payload);
  corrupt = true; assert.equal((await call("download")).status, 502); corrupt = false;
  badHost = true; assert.equal((await call("download")).status, 502); badHost = false;
  redirect = true; const denied = await call("claim"); assert.equal(denied.status, 403); assert.equal((await denied.text()).includes("private-token"), false);
  console.log("WhisperX transfer: bounded bodies, token isolation, pinned verified ranges, host allowlist and redirect rejection passed.");
} finally { globalThis.fetch = realFetch; }
