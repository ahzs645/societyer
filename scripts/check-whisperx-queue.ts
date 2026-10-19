import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { DEFAULT_WHISPERX_SETTINGS as settings, validateTranscriptPage, validateWhisperXSettings } from "../shared/transcription/protocol";
Object.assign(process.env, { AUTH_MODE: "convex", CONVEX_SITE_URL: "https://transcription-test.convex.site", SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS: "ddcnorth.com", SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT: "1" });
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./meetingTranscription.js": () => import("../convex/meetingTranscription"),
  "./transcripts.js": () => import("../convex/transcripts"), "./authorization.js": () => import("../convex/authorization"),
} as any);
const api: any = anyApi;
const ids = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Synthetic WhisperX", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreign = await ctx.db.insert("societies", { name: "Other", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, any> = {};
  for (const [subject, role, sid] of [["owner", "Owner", societyId], ["director", "Director", societyId], ["member", "Member", societyId], ["foreign", "Owner", foreign]]) users[subject] = await ctx.db.insert("users", { societyId: sid as any, role, status: "Active", displayName: subject, email: `${subject}@ddcnorth.com`, authSubject: subject, authIssuer: process.env.CONVEX_SITE_URL, createdAtISO: "2026-10-18" });
  const meetingId = await ctx.db.insert("meetings", { societyId, title: "Synthetic recording", type: "Board", scheduledAt: "2026-10-18", electronic: true, status: "Scheduled", attendeeIds: [] });
  const sourceId = await ctx.db.insert("meetingSources", { societyId, meetingId, actorId: users.owner, fileName: "fixture.wav", size: 500 * 1024 * 1024, kind: "recording", fingerprint: "a".repeat(64), status: "ready", offset: 500 * 1024 * 1024, verifiedOffset: 500 * 1024 * 1024, hashes: Array(100).fill("b".repeat(64)), remoteName: "private.wav", itemId: "item", eTag: "etag", versionId: "1.0", createdAt: 0 });
  const minutesId = await ctx.db.insert("minutes", { societyId, meetingId, draftTranscript: "Keep approved minutes", approvedAt: "2026-10-18", decisions: [], heldAt: "2026-10-18", attendees: [], absent: [], quorumMet: true, discussion: "", motions: [], actionItems: [] } as any);
  return { societyId, foreign, meetingId, sourceId, users, minutesId };
});
const actor = (subject: string) => t.withIdentity({ issuer: process.env.CONVEX_SITE_URL, subject, email: `${subject}@ddcnorth.com`, emailVerified: true });
const owner = actor("owner"); const hash = "c".repeat(64);
for (const client of [t, actor("member"), actor("foreign")]) await assert.rejects(() => client.query(api.meetingTranscription.jobs, { meetingId: ids.meetingId }));
await owner.mutation(api.meetingTranscription.configure, { societyId: ids.societyId, enabled: true, name: "Fixture worker", settings, keyHash: hash, allowRecordingProcessing: true });
assert.equal(JSON.stringify(await owner.query(api.meetingTranscription.settings, { societyId: ids.societyId })).includes(hash), false);
await assert.rejects(() => actor("director").mutation(api.meetingTranscription.configure, { societyId: ids.societyId, enabled: true, name: "No", settings, keyHash: hash, allowRecordingProcessing: true }));
const jobId = await owner.mutation(api.meetingTranscription.enqueue, { sourceId: ids.sourceId });
assert.equal(await owner.mutation(api.meetingTranscription.enqueue, { sourceId: ids.sourceId }), jobId);
const workerCall = (operation: string, data: any = {}, keyHash = hash, nonce = "fixture-lease") => t.mutation(api.meetingTranscription.processor, { operation, data, keyHash, nonce });
await assert.rejects(() => workerCall("claim", { workerId: "fixture", capabilities: {} }, "d".repeat(64)));
const first = await workerCall("claim", { workerId: "fixture", capabilities: { cuda: false, diarization: false } });
assert.equal(first.job.size, 500 * 1024 * 1024); assert.equal(first.job.hashes.length, 100);
assert.equal((await workerCall("claim", { workerId: "other", capabilities: {} })).busy, true);
await assert.rejects(() => owner.query(api.meetingTranscription.page, { jobId, page: 0 }), "Partial results cannot be read");
const lease = { jobId, lease: first.job.lease };
// Repeated idle polls and unchanged progress should not rewrite shared rows.
const beforeHeartbeat = await t.run(async ctx => ({
  job: await ctx.db.get(jobId),
  connection: await ctx.db.query("meetingTranscriptionConnections").withIndex("by_society", q => q.eq("societyId", ids.societyId)).unique(),
}));
await workerCall("heartbeat", { ...lease, phase: "Downloading", progress: 0 });
assert.deepEqual(await t.run(ctx => ctx.db.get(jobId)), beforeHeartbeat.job);
assert.deepEqual(await t.run(ctx => ctx.db.get(beforeHeartbeat.connection!._id)), beforeHeartbeat.connection);
await workerCall("heartbeat", { ...lease, phase: "Transcribing", progress: 0.2 });
assert.equal((await t.run(ctx => ctx.db.get(jobId)))!.progress, 0.2, "Changed progress is still immediate");
await t.run(async ctx => {
  await ctx.db.patch(jobId, { leaseUntil: Date.now() + 60_000 });
  await ctx.db.patch(beforeHeartbeat.connection!._id, { heartbeatAt: Date.now() - 60_000 });
});
const renewalTime = Date.now();
await workerCall("heartbeat", { ...lease, phase: "Transcribing", progress: 0.2 });
assert.ok((await t.run(ctx => ctx.db.get(jobId)))!.leaseUntil! >= renewalTime + 119_000, "Unchanged work still renews its lease before expiry");
assert.ok((await t.run(ctx => ctx.db.get(beforeHeartbeat.connection!._id)))!.heartbeatAt! >= renewalTime);
await assert.rejects(() => workerCall("download", { ...lease, offset: 1 }));
assert.equal((await workerCall("download", { ...lease, offset: 99 * 5 * 1024 * 1024 })).source._id, ids.sourceId);
let count = 0;
for (let page = 0; page < 24; page++) {
  const segments = Array.from({ length: 50 }, (_, i) => { const start = page * 50 + i; return { speaker: "SPEAKER_00", text: `Needle procurement decision ${start} ` + "word ".repeat(160), startSec: start, endSec: start + 0.9, words: [{ text: "Needle", startSec: start, endSec: start + 0.1 }] }; });
  validateTranscriptPage(segments);
  const data = { ...lease, page, hash: String(page).padStart(64, "0"), segments };
  await workerCall("page", data); await workerCall("page", data); count += 50;
  if (!page) await assert.rejects(() => workerCall("page", { ...data, hash: "e".repeat(64) }));
}
await assert.rejects(() => workerCall("complete", { ...lease, pageCount: 24, segmentCount: count - 1, durationSeconds: 1200, language: "en" }));
await assert.rejects(() => workerCall("complete", { ...lease, pageCount: 24, segmentCount: count, durationSeconds: 1199, language: "en" }));
const result = { ...lease, pageCount: 24, segmentCount: count, durationSeconds: 1200, language: "en" };
assert.equal((await workerCall("complete", result)).status, "ready"); assert.equal((await workerCall("complete", result)).status, "ready");
const idleConnection = await t.run(ctx => ctx.db.get(beforeHeartbeat.connection!._id));
assert.equal((await workerCall("claim", { workerId: "fixture", capabilities: JSON.parse(idleConnection!.capabilities!) })).job, null);
assert.deepEqual(await t.run(ctx => ctx.db.get(idleConnection!._id)), idleConnection, "Idle polling with unchanged capabilities does not rewrite the connection");
const page = await owner.query(api.meetingTranscription.page, { jobId, page: 17 }); assert.equal(page.segments.length, 50); assert.equal(page.startIndex, 850);
assert.ok(JSON.stringify(page).length < 192_000); assert.equal(page.segments[0].words.length, 1);
assert.ok((await owner.query(api.meetingTranscription.search, { jobId, text: "Needle" })).length > 0);
assert.equal(await owner.query(api.meetingTranscription.pageAtTime, { jobId, seconds: 850 }), 17);
for (const client of [t, actor("member"), actor("foreign")]) await assert.rejects(() => client.query(api.meetingTranscription.page, { jobId, page: 0 }));
await owner.mutation(api.meetingTranscription.apply, { jobId, replace: false });
let transcript = await t.run(ctx => ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", ids.meetingId)).first());
assert.equal(transcript!.pagedJobId, jobId); assert.equal(transcript!.segmentCount, 1200); assert.equal(transcript!.segments.length, 0);
assert.equal((await t.run(ctx => ctx.db.get(ids.minutesId)))!.draftTranscript, "Keep approved minutes");
await owner.mutation(api.transcripts.assignSpeaker, { societyId: ids.societyId, meetingId: ids.meetingId, label: "SPEAKER_00", name: "Synthetic narrator" });
const named = await t.run(ctx => ctx.db.get(transcript!._id)); assert.equal(named!.pagedJobId, jobId); assert.equal(named!.speakers![0].name, "Synthetic narrator"); assert.equal(named!.segments.length, 0);
assert.equal((await t.run(ctx => ctx.db.get(ids.minutesId)))!.draftTranscript, "Keep approved minutes");
const edit = { jobId, page: 17, revision: 0, index: 0, text: "Edited complete segment", speaker: "SPEAKER_01" };
await owner.mutation(api.meetingTranscription.editSegment, edit);
await assert.rejects(() => owner.mutation(api.meetingTranscription.editSegment, edit), "Concurrent edits must not silently overwrite");
assert.equal((await owner.query(api.meetingTranscription.page, { jobId, page: 17 })).segments[0].words, undefined);
await owner.mutation(api.transcripts.mergeSpeakers, { societyId: ids.societyId, meetingId: ids.meetingId, from: ["SPEAKER_00"], to: "SPEAKER_01" });
let mapped = await t.run(ctx => ctx.db.get(transcript!._id)); assert.equal(mapped!.speakers!.find(s => s.label === "SPEAKER_00")!.mergedInto, "SPEAKER_01");
await owner.mutation(api.transcripts.unmergeSpeaker, { societyId: ids.societyId, meetingId: ids.meetingId, label: "SPEAKER_00" });
mapped = await t.run(ctx => ctx.db.get(transcript!._id)); assert.equal(mapped!.speakers!.find(s => s.label === "SPEAKER_00")!.mergedInto, undefined); assert.equal(mapped!.pagedJobId, jobId);
// A legacy timed import must detach a paged transcript and invalidate an open replacement dialog.
const reviewed = await t.run(ctx => ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", ids.meetingId)).first());
const replacementJob = await owner.mutation(api.meetingTranscription.enqueue, { sourceId: ids.sourceId });
const replacement = await workerCall("claim", { workerId: "fixture", capabilities: {} }, hash, "replacement-lease");
const replacementLease = { jobId: replacementJob, lease: replacement.job.lease };
await workerCall("page", { ...replacementLease, page: 0, hash: "a".repeat(64), segments: [{ speaker: "Speaker", text: "Replacement", startSec: 0, endSec: 1 }] });
await workerCall("complete", { ...replacementLease, pageCount: 1, segmentCount: 1, durationSeconds: 1, language: "en" });
await owner.mutation(api.transcripts.importTimed, { societyId: ids.societyId, meetingId: ids.meetingId, provider: "vtt", segments: [{ speaker: "Speaker", text: "Legacy import", startSec: 0, endSec: 1 }] });
const changed = await t.run(ctx => ctx.db.get(reviewed!._id)); assert.equal(changed!.pagedJobId, undefined); assert.notEqual(changed!.contentRevision, reviewed!.contentRevision);
await assert.rejects(() => owner.mutation(api.meetingTranscription.apply, { jobId: replacementJob, replace: true, expectedRevision: reviewed!.contentRevision }));
await owner.mutation(api.meetingTranscription.apply, { jobId: replacementJob, replace: true, expectedRevision: changed!.contentRevision });
const nextJob = await owner.mutation(api.meetingTranscription.enqueue, { sourceId: ids.sourceId });
const second = await workerCall("claim", { workerId: "fixture", capabilities: {} }, hash, "lease-two"); assert.equal(second.job.id, nextJob);
await owner.mutation(api.meetingTranscription.cancel, { jobId: nextJob });
await assert.rejects(() => workerCall("heartbeat", { jobId: nextJob, lease: "lease-two" }));
const interrupted = await owner.mutation(api.meetingTranscription.enqueue, { sourceId: ids.sourceId });
const old = await workerCall("claim", { workerId: "fixture", capabilities: {} }, hash, "old-lease");
await t.run(ctx => ctx.db.patch(interrupted, { leaseUntil: 1 }));
const fresh = await workerCall("claim", { workerId: "fixture", capabilities: {} }, hash, "fresh-lease"); assert.equal(fresh.job.attempt, 2);
await assert.rejects(() => workerCall("heartbeat", { jobId: interrupted, lease: old.job.lease }));
await t.run(ctx => ctx.db.patch(ids.users.owner, { status: "Disabled" }));
await assert.rejects(() => workerCall("heartbeat", { jobId: interrupted, lease: fresh.job.lease }));
await t.run(ctx => ctx.db.patch(ids.users.owner, { status: "Active" }));
await owner.mutation(api.meetingTranscription.configure, { societyId: ids.societyId, enabled: true, name: "Rotated", settings, keyHash: "f".repeat(64), allowRecordingProcessing: true });
await assert.rejects(() => workerCall("status"));
await owner.mutation(api.meetingTranscription.configure, { societyId: ids.societyId, enabled: false, name: "Disabled", settings, allowRecordingProcessing: true });
await assert.rejects(() => workerCall("status", {}, "f".repeat(64)));
assert.throws(() => validateWhisperXSettings({ ...settings, batchSize: 0 }));
assert.throws(() => validateTranscriptPage([{ speaker: "S", text: "Bad", startSec: 2, endSec: 1 }]));
console.log("WhisperX queue: access, 500 MB manifest, leases, retries, cancellation, idempotency, 1 MB paged transcript, editing, search, rotation and frozen minutes passed.");
