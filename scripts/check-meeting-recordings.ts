// Meeting recordings kept in workspace file storage, and the workspace's choice
// to keep recordings (shared/meetingRecordingStorage.ts,
// shared/functions/meetingRecordings.ts, convex/meetingRecordings.ts).
//
//   node --import tsx scripts/check-meeting-recordings.ts
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { StaticConvexClient } from "../src/lib/staticConvex";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { PORTABLE_TEST_AUTH_SUBJECT } from "./portable-test-fixture";
import { meetingRecordingPreference, meetingRecordingStore } from "../shared/meetingRecordingStorage";

// ---------- where recordings go ----------------------------------------------------
const native = { nativeUploads: true, documentVersionProvider: "native" as const };
const sharePoint = { nativeUploads: false, documentVersionProvider: "sharepoint" as const };
const noFiles = { nativeUploads: false, documentVersionProvider: "native" as const };
assert.equal(meetingRecordingPreference({}), "keep", "absent preference keeps recordings, as before");
assert.equal(meetingRecordingPreference({ meetingRecordingPreference: "transcripts_only" }), "transcripts_only");
assert.equal(meetingRecordingPreference({ meetingRecordingPreference: "bogus" }), "keep");
const store = (input: Parameters<typeof meetingRecordingStore>[0]) => meetingRecordingStore(input).store;
assert.equal(store({ runtime: "hosted", preference: "keep", policy: native }), "workspace");
assert.equal(store({ runtime: "hosted", preference: "keep", policy: sharePoint, sharePointBroker: true }), "sharepoint");
assert.equal(store({ runtime: "hosted", preference: "keep", policy: sharePoint, sharePointBroker: false }), "none", "SharePoint without the broker keeps nothing");
assert.equal(store({ runtime: "hosted", preference: "keep", policy: noFiles }), "none");
assert.equal(store({ runtime: "desktop", preference: "keep" }), "device");
assert.equal(store({ runtime: "browser-local", preference: "keep" }), "none");
for (const runtime of ["hosted", "desktop", "browser-local"] as const) {
  assert.equal(store({ runtime, preference: "transcripts_only", policy: native, sharePointBroker: true }), "none", `${runtime}: transcripts only wins`);
}
assert.match(meetingRecordingStore({ runtime: "hosted", preference: "keep", policy: noFiles }).detail, /turned off/);
console.log("✓ store: workspace, SharePoint, desktop disk or none; transcripts only always wins");

// ---------- local runtime (the desktop app's path) ---------------------------------
const societyId = "recordings_society";
const client = new StaticConvexClient({ seed: {
  societies: [{ _id: societyId, name: "Recordings test", jurisdictionCode: "CA-BC", entityType: "society" }],
  meetings: [{ _id: "m_rec", societyId, type: "Working", title: "Partner call", scheduledAt: "2026-03-03T16:00:00.000Z", electronic: true, status: "Held", attendeeIds: [], recordKind: "notes" }],
} });
await client.whenLocalWorkspaceReady();
assert.deepEqual(await client.query("meetingRecordings:settings", { societyId }), { preference: "keep", policy: null, serverTranscription: null });
const local = { meetingId: "m_rec", fileName: "call.m4a", size: 1200, mimeType: "audio/mp4", provider: "local-filesystem", storageKey: "workspace/m_rec/call.m4a", sha256: "a".repeat(64) };
const attached = await client.mutation("meetingRecordings:attach", local) as { id: string };
const rows = await client.query("meetingRecordings:list", { meetingId: "m_rec" }) as any[];
assert.equal(rows.length, 1);
assert.equal(rows[0].provider, "local-filesystem");
assert.equal(rows[0].url, null, "desktop files are read through the bridge, not a URL");
assert.equal(rows[0].storageKey, local.storageKey);
await assert.rejects(() => client.mutation("meetingRecordings:attach", { ...local, fileName: "minutes.vtt" }), /audio or video recording/);
await assert.rejects(() => client.mutation("meetingRecordings:attach", { ...local, size: 600_000_000 }), /500 MB/);
await assert.rejects(() => client.mutation("meetingRecordings:attach", { ...local, fileName: "../x.mp3" }), /Invalid file name/);
await assert.rejects(() => client.mutation("meetingRecordings:setPreference", { societyId, preference: "never" }), /keep recordings or transcripts only/);
await client.mutation("meetingRecordings:setPreference", { societyId, preference: "transcripts_only" });
await assert.rejects(() => client.mutation("meetingRecordings:attach", local), /transcripts only/);
assert.equal((await client.query("meetingRecordings:list", { meetingId: "m_rec" }) as any[]).length, 1, "existing recordings stay after switching to transcripts only");
assert.deepEqual(await client.mutation("meetingRecordings:remove", { id: attached.id }), { provider: "local-filesystem", storageKey: local.storageKey });
assert.equal((await client.query("meetingRecordings:list", { meetingId: "m_rec" }) as any[]).length, 0);
console.log("✓ local runtime: attach a desktop file, validation, transcripts only refuses new recordings, remove");

// ---------- hosted -----------------------------------------------------------------
const issuer = betterAuthIssuer();
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./meetingRecordings.js": () => import("../convex/meetingRecordings"),
  "./meetingSources.js": () => import("../convex/meetingSources"),
  "./authorization.js": () => import("../convex/authorization"),
});
const ids = await t.run(async (ctx) => {
  const hostedSocietyId = await ctx.db.insert("societies", { name: "Recordings hosted", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const otherSocietyId = await ctx.db.insert("societies", { name: "Other", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const user = (role: string, subject: string, society = hostedSocietyId) => ctx.db.insert("users", {
    societyId: society, email: `${subject}@portable-fixture.test`, displayName: role, role, status: "Active",
    authProvider: "better-auth", authIssuer: issuer, authSubject: subject, createdAtISO: "2026-01-01T00:00:00Z",
  });
  await user("Owner", PORTABLE_TEST_AUTH_SUBJECT);
  await user("Viewer", "recordings-viewer");
  await user("Owner", "recordings-other-owner", otherSocietyId);
  const meetingId = await ctx.db.insert("meetings", {
    societyId: hostedSocietyId, title: "Hosted call", type: "Working", scheduledAt: "2026-04-01T18:00:00.000Z",
    electronic: true, status: "Held", attendeeIds: [], recordKind: "notes",
  });
  const storageId = await ctx.storage.store(new Blob([new Uint8Array(2048)], { type: "audio/mpeg" }));
  const foreignStorageId = await ctx.storage.store(new Blob([new Uint8Array(16)], { type: "audio/mpeg" }));
  await ctx.db.insert("storageOwnership", { storageId: foreignStorageId, societyId: otherSocietyId, createdAtISO: "2026-01-01T00:00:00Z" });
  return { societyId: hostedSocietyId, meetingId, storageId, foreignStorageId };
});
const owner = t.withIdentity({ subject: PORTABLE_TEST_AUTH_SUBJECT, issuer });
const viewer = t.withIdentity({ subject: "recordings-viewer", issuer });
const meetingId = ids.meetingId as Id<"meetings">;
const hostedSocietyId = ids.societyId as Id<"societies">;

const hostedSettings = await owner.query(api.meetingRecordings.settings, { societyId: hostedSocietyId });
assert.deepEqual(hostedSettings.policy, { nativeUploads: true, documentVersionProvider: "native" });
assert.equal(hostedSettings.preference, "keep");
await assert.rejects(() => viewer.query(api.meetingRecordings.list, { meetingId }), /Permission meetings:write/, "raw recordings are for meeting editors");
await assert.rejects(() => viewer.mutation(api.meetingRecordings.setPreference, { societyId: hostedSocietyId, preference: "transcripts_only" }), /Permission settings:write/);
assert.equal(typeof await owner.mutation(api.meetingRecordings.generateUploadUrl, { meetingId, fileName: "call.mp3", size: 2048 }), "string");
await assert.rejects(() => owner.mutation(api.meetingRecordings.generateUploadUrl, { meetingId, fileName: "notes.txt", size: 10 }), /audio or video/);

await owner.mutation(api.meetingRecordings.attach, { meetingId, fileName: "call.mp3", storageId: ids.storageId, size: 1, provider: "local-filesystem", storageKey: "spoofed" });
const listed = await owner.query(api.meetingRecordings.list, { meetingId }) as any[];
assert.equal(listed.length, 1);
assert.equal(listed[0].size, 2048, "size comes from the stored blob, not the client");
assert.equal(listed[0].provider, "convex", "a hosted attach is always workspace storage");
assert.equal(listed[0].storageKey, ids.storageId);
assert.ok(listed[0].url, "a signed URL to play it");
await assert.rejects(
  () => owner.mutation(api.meetingRecordings.attach, { meetingId, fileName: "theirs.mp3", storageId: ids.foreignStorageId }),
  /not found/i,
  "another workspace's blob can't be attached",
);

await owner.mutation(api.meetingRecordings.setPreference, { societyId: hostedSocietyId, preference: "transcripts_only" });
await assert.rejects(() => owner.mutation(api.meetingRecordings.generateUploadUrl, { meetingId, fileName: "call2.mp3", size: 10 }), /transcripts only/);

await owner.mutation(api.meetingRecordings.remove, { id: listed[0].id });
const after = await t.run(async (ctx) => ({
  rows: await ctx.db.query("meetingRecordings").collect(),
  blob: await ctx.storage.get(ids.storageId),
  claims: await ctx.db.query("storageOwnership").withIndex("by_storage", (q) => q.eq("storageId", ids.storageId)).collect(),
}));
assert.equal(after.rows.length, 0);
assert.equal(after.blob, null, "the blob is deleted with the recording");
assert.equal(after.claims.length, 0, "and its workspace claim");
// A SharePoint workspace that keeps transcripts only: source files still take transcripts, never recordings.
await t.run((ctx) => ctx.db.insert("workspaceStoragePolicies", { societyId: hostedSocietyId, nativeUploads: "disabled", documentVersionProvider: "sharepoint", reason: "test", updatedAtISO: "2026-01-01T00:00:00Z" }));
assert.deepEqual((await owner.query(api.meetingRecordings.settings, { societyId: hostedSocietyId })).policy, { nativeUploads: false, documentVersionProvider: "sharepoint" });
const allocate = (fileName: string) => owner.mutation(internal.meetingSources.allocate, { meetingId, fileName, size: 10, fingerprint: "a".repeat(64), nonce: "00000000-0000-0000-0000-000000000000" });
await assert.rejects(() => allocate("call2.mp3"), /keeps transcripts only/, "SharePoint refuses recordings when the workspace keeps transcripts only");
assert.ok(await allocate("call2.vtt"), "transcript files are still accepted");
console.log("✓ hosted: settings, editors only, blob size and ownership from storage, transcripts only refuses uploads, remove deletes the blob, SharePoint refuses recordings too");
