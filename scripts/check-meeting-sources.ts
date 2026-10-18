import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mock } from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import worker from "../workers/meeting-transfer/index";
import { MEETING_SOURCE_CHUNK_BYTES as CHUNK, MEETING_SOURCE_MAX_BYTES, validateMeetingSource } from "../shared/storage/meetingSourceProtocol";
import { meetingTranscriptChunks } from "../src/lib/meetingTranscriptImport";
import { StreamingZipWriter } from "../src/lib/zipStream";

Object.assign(process.env, {
  AUTH_MODE: "convex", CONVEX_SITE_URL: "https://source-test.convex.site", SITE_URL: "https://app.example.test",
  BETTER_AUTH_SECRET: "fixture-only-societyer-secret-that-is-not-real", SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS: "ddcnorth.com", SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT: "1",
  SOCIETYER_STORAGE_PROVIDER: "sharepoint", SHAREPOINT_TENANT_ID: "11111111-1111-1111-1111-111111111111", SHAREPOINT_CLIENT_ID: "22222222-2222-2222-2222-222222222222",
  SHAREPOINT_CLIENT_SECRET: "fixture-not-a-real-secret", SHAREPOINT_SITE_ID: "approved-site", SHAREPOINT_DRIVE_ID: "approved-drive", SHAREPOINT_TRANSFER_HOSTS: "files.example.test",
  MEETING_SOURCE_BROKER_KEY: "fixture-only-broker-key-with-32-characters",
});
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./http.js": () => import("../convex/http"), "./meetingSources.js": () => import("../convex/meetingSources"),
  "./meetingSourceSpeech.js": () => import("../convex/meetingSourceSpeech"),
  "./authorization.js": () => import("../convex/authorization"),
} as any);
const meetingId = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Source test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignId = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const [subject, role, society] of [["owner", "Owner", societyId], ["director", "Director", societyId], ["member", "Member", societyId], ["foreign", "Owner", foreignId]] as const) {
    await ctx.db.insert("users", { societyId: society, displayName: subject, email: `${subject}@ddcnorth.com`, authIssuer: process.env.CONVEX_SITE_URL, authSubject: subject, role, status: "Active", createdAtISO: new Date().toISOString() });
  }
  return ctx.db.insert("meetings", { societyId, type: "Board", title: "Fixture", scheduledAt: new Date().toISOString(), electronic: true, status: "Scheduled", attendeeIds: [] });
});
const actor = (subject: string, overrides: object = {}) => test.withIdentity({ issuer: process.env.CONVEX_SITE_URL, subject, email: `${subject}@ddcnorth.com`, emailVerified: true, ...overrides });
const env = { CONVEX_SITE_URL: process.env.CONVEX_SITE_URL!, SITE_ORIGIN: process.env.SITE_URL!, MEETING_SOURCE_BROKER_KEY: process.env.MEETING_SOURCE_BROKER_KEY!, SHAREPOINT_TRANSFER_HOSTS: "files.example.test" };
const realFetch = globalThis.fetch;
type Remote = { id: string; name: string; offset: number; size: number; deleted?: boolean; eTag?: string };
const remotes = new Map<string, Remote>();
let graphCalls = 0; let loseAck = false; let tamper = false; let largestBody = 0;
let submittedJob = ""; let speechReady = false; let submittedCount = 0;
let redirectControl = false;
const bytesAt = (offset: number, length: number) => new Uint8Array(length).fill(Math.floor(offset / CHUNK) % 251);
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)); const headers = new Headers(init?.headers);
  if (url.hostname === "speech.example.test") {
    assert.equal(headers.get("authorization"), "Bearer fixture-speech-service-key-of-32-characters");
    if (init?.method === "POST") {
      const job = JSON.parse(String(init.body)); submittedJob = job.id; submittedCount++;
      assert.ok(job.downloadUrl.startsWith("https://files.example.test/content/")); assert.ok(job.downloadUrl.includes("private-token"));
      return Response.json({ id: job.id }, { status: 202 });
    }
    assert.equal(url.pathname, `/jobs/${submittedJob}`);
    return Response.json(speechReady ? { status: "complete", text: "Speech 🌿 ".repeat(2000) } : { status: "processing" });
  }
  if (url.hostname === "source-test.convex.site") {
    // Match the actual Workers runtime, which rejects this mode before sending.
    assert.notEqual(init?.redirect, "error", 'Cloudflare Workers does not implement redirect:"error"');
    if (redirectControl) return new Response(null, { status: 307, headers: { location: "https://untrusted.example.test/control" } });
    const request = JSON.parse(String(init?.body));
    if (loseAck && request.operation === "ack") { loseAck = false; return Response.json({ error: "Transfer unavailable." }, { status: 500 }); }
    const subject = headers.get("authorization")?.replace("Bearer ", "") ?? "";
    return (subject ? actor(subject) : test).fetch(url.pathname, init);
  }
  if (url.hostname === "login.microsoftonline.com") return Response.json({ access_token: "fixture-graph-token", token_type: "Bearer", expires_in: 3600 });
  if (url.hostname === "graph.microsoft.com") {
    graphCalls++; assert.equal(headers.get("authorization"), "Bearer fixture-graph-token");
    if (/\/drives\/approved-drive\/$/.test(url.pathname)) return Response.json({ id: "approved-drive", sharePointIds: { tenantId: process.env.SHAREPOINT_TENANT_ID } });
    if (url.pathname.includes("/sites/")) return Response.json({ id: "approved-drive" });
    if (url.pathname.endsWith("/createUploadSession")) {
      const name = JSON.parse(String(init?.body)).item.name;
      const id = String(remotes.size + 1); remotes.set(id, { id, name, offset: 0, size: 0 });
      return Response.json({ uploadUrl: `https://files.example.test/upload/${id}?private-token`, expirationDateTime: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (url.pathname.includes("/root:/")) {
      const name = decodeURIComponent(url.pathname.split("/root:/")[1]);
      const item = [...remotes.values()].find(r => r.name === name); assert.ok(item);
      return Response.json({ id: item.id, name, size: item.size, eTag: "etag-1", file: {}, parentReference: { driveId: "approved-drive" } });
    }
    if (url.pathname.endsWith("/versions")) {
      const id = url.pathname.split("/items/")[1].split("/")[0];
      return Response.json({ value: [{ id: "1.0", size: remotes.get(id)!.size }] });
    }
    if (/\/items\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split("/items/")[1]; const item = remotes.get(id)!;
      return Response.json({ id, size: item.size, eTag: item.eTag ?? "etag-1", file: {}, parentReference: { driveId: "approved-drive" } });
    }
    if (/\/items\/[^/]+\/(versions\/1\.0\/)?content$/.test(url.pathname)) {
      const id = url.pathname.split("/items/")[1].split("/")[0];
      if (url.pathname.includes("/versions/") && !remotes.get(id)!.eTag) return Response.json({ error: "Current version cannot use version content API" }, { status: 400 });
      return new Response(null, { status: 302, headers: { location: `https://files.example.test/content/${id}?private-token` } });
    }
    throw new Error(`Unexpected fixture Graph path ${url.pathname}`);
  }
  assert.equal(url.hostname, "files.example.test"); assert.equal(headers.has("authorization"), false, "Never send a Microsoft or app token to a transfer URL");
  const id = url.pathname.split("/")[2]; const remote = remotes.get(id)!;
  if (url.pathname.startsWith("/upload/")) {
    if (init?.method === "DELETE") { remote.deleted = true; return new Response(null, { status: 204 }); }
    if (init?.method !== "PUT") return remote.offset === remote.size && remote.size ? new Response(null, { status: 404 }) : Response.json({ nextExpectedRanges: [`${remote.offset}-`] });
    assert.equal(remote.deleted, undefined);
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get("content-range")!); assert.ok(range);
    const offset = Number(range[1]); const end = Number(range[2]) + 1; const total = Number(range[3]);
    const bytes = new Uint8Array(init.body as Uint8Array); largestBody = Math.max(largestBody, bytes.length);
    assert.equal(offset, remote.offset); assert.equal(end - offset, bytes.length); assert.ok(bytes.length <= CHUNK);
    assert.equal(bytes[0], Math.floor(offset / CHUNK) % 251); assert.equal(bytes.at(-1), bytes[0]);
    remote.offset = end; remote.size = total;
    return end === total ? Response.json({ id }, { status: 201 }) : Response.json({ nextExpectedRanges: [`${end}-${total - 1}`] }, { status: 202 });
  }
  const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") ?? "");
  if (range) {
    const start = Number(range[1]); const end = Number(range[2]); const bytes = bytesAt(start, end - start + 1);
    if (tamper) bytes[0] ^= 1;
    return new Response(bytes, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${remote.size}`, "content-length": String(bytes.length) } });
  }
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) { if (offset === remote.size) { controller.close(); return; } const bytes = bytesAt(offset, Math.min(CHUNK, remote.size - offset)); offset += bytes.length; controller.enqueue(bytes); } }), { headers: { "content-length": String(remote.size) } });
};

const call = (operation: string, data: object, subject = "owner", origin = env.SITE_ORIGIN) => worker.fetch(new Request(`https://broker.example.test/meeting-sources/${operation}`, {
  method: "POST", headers: { Authorization: `Bearer ${subject}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(data),
}), env);
const start = async (size: number, fingerprint = "a".repeat(64)) => {
  const response = await call("start", { meetingId, fileName: "fixture.mp4", size, fingerprint });
  assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<any>;
};
const chunk = (sourceId: string, offset: number, size: number, subject = "owner") => worker.fetch(new Request(`https://broker.example.test/meeting-sources/chunk?${new URLSearchParams({ sourceId, offset: String(offset), size: String(size) })}`, {
  method: "PUT", headers: { Authorization: `Bearer ${subject}`, Origin: env.SITE_ORIGIN }, body: bytesAt(offset, size),
}), env);
try {
  assert.equal(validateMeetingSource("recording.mp4", MEETING_SOURCE_MAX_BYTES), "recording");
  assert.throws(() => validateMeetingSource("too-large.mp4", MEETING_SOURCE_MAX_BYTES + 1));
  for (const subject of ["member", "foreign"]) assert.equal((await call("start", { meetingId, fileName: "fixture.mp4", size: 3, fingerprint: "b".repeat(64) }, subject)).status, 400);
  assert.equal(graphCalls, 0, "Reject unauthorized users before contacting Microsoft");
  assert.equal((await call("list", { meetingId }, "owner", "https://evil.test")).status, 403);
  assert.equal((await test.fetch("/meeting-sources/control", { method: "POST", body: "{}" })).status, 403, "Worker-only control plane");
  const unverified = actor("owner", { emailVerified: false });
  assert.equal((await unverified.fetch("/meeting-sources/control", { method: "POST", headers: { "x-societyer-broker": env.MEETING_SOURCE_BROKER_KEY }, body: JSON.stringify({ operation: "list", meetingId }) })).status, 401);

  redirectControl = true;
  const redirectedControl = await call("list", { meetingId });
  assert.equal(redirectedControl.status, 400, "Control redirects fail closed instead of forwarding credentials");
  assert.match((await redirectedControl.json() as any).error, /Unexpected control redirect/);
  redirectControl = false;

  let state = await start(MEETING_SOURCE_MAX_BYTES);
  assert.ok(!JSON.stringify(state).includes("private-token"));
  assert.equal((await chunk(state.id, 0, CHUNK, "director")).status, 400, "Another editor cannot write into the uploader's session");
  // Lose the control-plane acknowledgement after Microsoft accepted the first chunk.
  loseAck = true; assert.equal((await chunk(state.id, 0, CHUNK)).status, 400);
  assert.equal((await call("resume", { sourceId: state.id })).status, 400, "Do not race an active lease");
  await test.run(ctx => ctx.db.patch(state.id, { leaseUntil: 1 }));
  state = await (await call("resume", { sourceId: state.id })).json(); assert.equal(state.offset, CHUNK);
  while (state.offset < state.size) {
    const response = await chunk(state.id, state.offset, Math.min(CHUNK, state.size - state.offset));
    assert.equal(response.status, 200, await response.clone().text()); state = await response.json();
  }
  assert.equal(state.status, "verifying");
  assert.equal((await call("download", { sourceId: state.id, offset: 0 })).status, 400, "Unverified content must not be delivered");
  tamper = true; assert.equal((await call("verify", { sourceId: state.id })).status, 400); tamper = false;
  while (state.status === "verifying") { const response = await call("verify", { sourceId: state.id }); assert.equal(response.status, 200, await response.clone().text()); state = await response.json(); }
  assert.equal(state.status, "ready"); assert.equal(state.verifiedOffset, MEETING_SOURCE_MAX_BYTES); assert.equal(largestBody, CHUNK);
  assert.equal((await chunk(state.id, 0, CHUNK)).status, 400, "No overwrites after commit");
  let total = 0;
  for (let offset = 0; offset < state.size; offset += CHUNK) {
    const download = await call("download", { sourceId: state.id, offset }); assert.equal(download.status, 200, await download.clone().text().then(text => text.slice(0, 120)));
    assert.equal(download.headers.get("content-length"), String(Math.min(CHUNK, state.size - offset)));
    total += (await download.arrayBuffer()).byteLength;
  }
  assert.equal(total, MEETING_SOURCE_MAX_BYTES);
  tamper = true; assert.equal((await call("download", { sourceId: state.id, offset: 0 })).status, 400, "Out-of-band storage changes fail checksum validation"); tamper = false;
  remotes.get("1")!.eTag = "changed-current-version";
  assert.equal((await call("download", { sourceId: state.id, offset: 0 })).status, 200, "After a direct edit, deliver the pinned historical version");
  assert.equal((await call("download", { sourceId: state.id }, "member")).status, 400);
  assert.equal((await call("download", { sourceId: state.id }, "foreign")).status, 400);

  await assert.rejects(() => actor("member").mutation(api.meetingSources.appendText, { sourceId: state.id, index: 0, text: "secret", complete: true }), /Permission/);
  await actor("owner").mutation(api.meetingSources.appendText, { sourceId: state.id, index: 0, text: "Chair: Meeting opened.\n", complete: true });
  await actor("owner").mutation(api.meetingSources.useTranscript, { sourceId: state.id });
  assert.equal((await test.run(ctx => ctx.db.query("transcripts").first()))?.text, "Chair: Meeting opened.\n");
  await assert.rejects(() => actor("owner").mutation(api.meetingSources.appendText, { sourceId: state.id, index: 1, text: "overwrite", complete: true }));
  const cancelled = await start(3, "c".repeat(64));
  assert.equal((await call("cancel", { sourceId: cancelled.id })).status, 200);
  assert.equal((await chunk(cancelled.id, 0, 3)).status, 400);
  const recording = await start(3, "d".repeat(64));
  assert.equal((await chunk(recording.id, 0, 3)).status, 200);
  assert.equal((await call("verify", { sourceId: recording.id })).status, 200);
  await assert.rejects(() => actor("owner").action(api.meetingSourceSpeech.start, { sourceId: recording.id }), /Configure/);
  process.env.MEETING_TRANSCRIPTION_ENDPOINT = "https://speech.example.test";
  process.env.MEETING_TRANSCRIPTION_KEY = "fixture-speech-service-key-of-32-characters";
  mock.timers.enable({ apis: ["setTimeout"] });
  await assert.rejects(() => actor("director").action(api.meetingSourceSpeech.start, { sourceId: recording.id }), /uploader/);
  await actor("owner").action(api.meetingSourceSpeech.start, { sourceId: recording.id });
  await actor("owner").action(api.meetingSourceSpeech.start, { sourceId: recording.id });
  assert.equal(submittedCount, 1, "Repeated start cannot create another provider job");
  await test.action(internal.meetingSourceSpeech.poll, { sourceId: recording.id, jobId: submittedJob });
  assert.equal((await actor("owner").query(internal.meetingSources.inspect, { sourceId: recording.id })).textComplete, undefined);
  speechReady = true;
  await test.action(internal.meetingSourceSpeech.poll, { sourceId: recording.id, jobId: submittedJob });
  const completed = await actor("owner").query(internal.meetingSources.inspect, { sourceId: recording.id });
  assert.equal(completed.textComplete, true); assert.equal(completed.jobStatus, "complete");
  const speechText = await test.run(ctx => ctx.db.query("meetingSourceText").withIndex("by_source_index", q => q.eq("sourceId", recording.id)).collect());
  assert.equal(speechText.map(row => row.text).join(""), "Speech 🌿 ".repeat(2000));
  mock.timers.reset();
  await test.run(async ctx => { const user = await ctx.db.query("users").withIndex("by_auth_subject", q => q.eq("authSubject", "owner")).first(); await ctx.db.patch(user!._id, { status: "Disabled" }); });
  assert.equal((await call("download", { sourceId: state.id })).status, 400, "Revocation applies on each new request");
  assert.equal((await test.run(ctx => ctx.db.system.query("_storage").collect())).length, 0);
} finally { globalThis.fetch = realFetch; }

async function extracted(name: string, body: string | Blob) {
  let text = "";
  for await (const chunk of meetingTranscriptChunks(new File([body], name) as globalThis.File)) { assert.ok(new TextEncoder().encode(chunk).length <= 48_000); text += chunk; }
  return text;
}
assert.equal(await extracted("meeting.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Chair>Hello &amp; welcome.</v>\n"), "Chair: Hello & welcome.\n");
assert.equal(await extracted("meeting.srt", "1\r\n00:00:01,000 --> 00:00:02,000\r\nHello.\r\n\r\n"), "Hello.\n");
assert.equal(await extracted("whisper.json", JSON.stringify({ segments: [{ text: "Hello", speaker: "Chair" }] })), "Chair: Hello");
const long = "🌿".repeat(70_000); assert.equal((await extracted("large.txt", long)).trim(), long);
const archive = new StreamingZipWriter(); await archive.add("audio.wav", new Uint8Array(8_000_000), { compress: false }); await archive.add("transcript.txt", new TextEncoder().encode("Chair: Hello"));
assert.equal((await extracted("whisper.zip", archive.finish())).trim(), "Chair: Hello");
const traversal = new StreamingZipWriter(); await traversal.add("../transcript.txt", new TextEncoder().encode("bad")); await assert.rejects(() => extracted("bad.zip", traversal.finish()), /Unsafe/);
await assert.rejects(() => extracted("broken.json", "{nonsense"));
console.log("Meeting sources passed: real Convex handlers and transfer Worker, synthetic 500 MB upload/readback/download with <=5 MiB bodies, lost-response recovery, leases, checksum corruption, replay/cancellation/revocation/tenant/role/origin checks, paged text and TXT/VTT/SRT/Whisper JSON/ZIP extraction. No Convex blobs.");
