import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { meetingBinding, safeGraphContinuation, transcriptPath, validateDateWindow, verifyTranscriptMetadata, type TeamsSource } from "../shared/microsoftMeetings";
import { TeamsGraphClient, boundedGraphBody } from "../shared/teamsGraphClient";
const api: any = anyApi;
const tenant = "220c85f6-1111-4111-8111-55d9fd163b55", organizer = "11111111-2222-4333-8444-555555555555";
const source: TeamsSource = { kind: "adhoc", resourceId: "call-one", transcriptId: "transcript-one", organizerId: organizer, createdAt: "2026-11-09T23:00:00.000Z", title: "Fictional Teams call" };
const metadata = { id: source.transcriptId, callId: source.resourceId, createdDateTime: source.createdAt, meetingOrganizer: { user: { id: organizer, tenantId: tenant } } };
assert.throws(() => validateDateWindow("bad", "2026-11-09"));
assert.throws(() => validateDateWindow("2026-01-01", "2026-11-09"));
assert.equal(meetingBinding({ MICROSOFT_MEETINGS_BINDINGS: "[]" }, "other"), null);
assert.throws(() => safeGraphContinuation(`https://example.invalid/users/${organizer}/adhocCalls/getAllTranscripts`, organizer, "adhoc"));
assert.throws(() => safeGraphContinuation(`https://graph.microsoft.com/v1.0/users/other/adhocCalls/getAllTranscripts`, organizer, "adhoc"));
assert.throws(() => verifyTranscriptMetadata(source, { ...metadata, callId: "other" }, tenant));
assert.throws(() => verifyTranscriptMetadata(source, metadata, "other-tenant"));
let requests = 0;
const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Fictional speaker>Hello.</v>\n";
const client = new TeamsGraphClient("fixture-token", tenant, (async (url: any, init: any) => {
  requests++; assert.equal(init.redirect, "error"); assert.equal(init.headers.Authorization, "Bearer fixture-token");
  assert(String(url).includes(`/users/${organizer}/adhocCalls/getAllTranscripts(userId='${organizer}',`));
  const path = new URL(String(url)).pathname;
  return Response.json(path.includes("getAllTranscripts") ? { value: [metadata] } : metadata);
}) as typeof fetch);
assert.equal((await client.discover("adhoc", organizer, "2026-11-09T00:00:00.000Z", "2026-11-10T00:00:00.000Z")).sources.length, 1);
assert.equal(requests, 1);
const wrong = new TeamsGraphClient("fixture-token", tenant, (async () => Response.json({ ...metadata, callId: "foreign" })) as typeof fetch);
await assert.rejects(wrong.transcript(source), /identity/);
await assert.rejects(boundedGraphBody(new Response("too big"), 3), /size/);
const successful = new TeamsGraphClient("fixture-token", tenant, (async (url: any) => String(url).endsWith("/content") ? new Response(vtt) : Response.json(metadata)) as typeof fetch);
assert.equal(await successful.transcript(source), vtt);
assert(transcriptPath(source).startsWith(`/users/${organizer}/adhocCalls/`));

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api"),
  "./_generated/server.js": () => import("../convex/_generated/server"),
  "./microsoftMeetings.js": () => import("../convex/microsoftMeetings"),
} as any);
const issuer = betterAuthIssuer();
const ids = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Fictional DDC", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const other = await ctx.db.insert("societies", { name: "Fictional separate workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const userId = await ctx.db.insert("users", { societyId, email: "owner@example.invalid", displayName: "Fictional Owner", role: "Owner", status: "Active", authSubject: "teams-owner", authIssuer: issuer, authProvider: "better-auth", createdAtISO: source.createdAt });
  await ctx.db.insert("users", { societyId, email: "viewer@example.invalid", displayName: "Fictional Viewer", role: "Viewer", status: "Active", authSubject: "teams-viewer", authIssuer: issuer, authProvider: "better-auth", createdAtISO: source.createdAt });
  return { societyId, other, userId };
});
const binding = { societyId: ids.societyId, organizerIds: [organizer], chats: [{ id: "chat-one", name: "Fictional chat" }] };
process.env.MICROSOFT_MEETINGS_BINDINGS = JSON.stringify([binding]);
const owner = t.withIdentity({ subject: "teams-owner", issuer, tokenIdentifier: `${issuer}|teams-owner`, email: "owner@example.invalid" });
const viewer = t.withIdentity({ subject: "teams-viewer", issuer, tokenIdentifier: `${issuer}|teams-viewer`, email: "viewer@example.invalid" });
await assert.rejects(viewer.query(api.microsoftMeetings.settings, { societyId: ids.societyId }));
await assert.rejects(owner.query(api.microsoftMeetings.settings, { societyId: ids.other }));
const staged = await owner.mutation(api.microsoftMeetings.stage, { societyId: ids.societyId, sources: [source] });
assert.equal(staged.length, 1);
const payload = { societyId: ids.societyId, candidateId: staged[0].id, title: "Reviewed ordinary discussion", transcriptId: source.transcriptId, transcriptHash: "a".repeat(64), segments: [{ speaker: "Fictional speaker", text: "Hello.", startSec: 1, endSec: 3 }], participants: [{ name: "Fictional Owner", objectId: organizer, tenantId: tenant, userId: ids.userId }], contextChatId: "chat-one", contextChatConfirmed: true };
await assert.rejects(owner.mutation(api.microsoftMeetings.commitImport, { ...payload, contextChatConfirmed: false }), /Confirm/);
await assert.rejects(owner.mutation(api.microsoftMeetings.commitImport, { ...payload, transcriptId: "changed" }), /changed/);
const meetingId = await owner.mutation(api.microsoftMeetings.commitImport, payload);
assert.equal(await owner.mutation(api.microsoftMeetings.commitImport, payload), meetingId);
await t.run(async ctx => {
  const meeting = await ctx.db.get(meetingId); assert.equal(meeting?.recordKind, "notes"); assert.deepEqual(meeting?.attendeeIds, []);
  // The existing meeting creator keeps an empty minutes stub for every kind;
  // importing notes must not turn that stub into an approved record.
  const stub = meeting?.minutesId ? await ctx.db.get(meeting.minutesId) : null;
  assert.equal(stub?.discussion ?? "", ""); assert.equal(stub?.approvedAtISO, undefined);
  const transcript = await ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", meetingId)).unique(); assert(transcript); await ctx.db.patch(transcript._id, { text: "An editor corrected this." });
});
await owner.mutation(api.microsoftMeetings.commitImport, payload);
await t.run(async ctx => { assert.equal((await ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", meetingId)).unique())?.text, "An editor corrected this."); });
await owner.mutation(api.microsoftMeetings.assignSpeakerToUser, { societyId: ids.societyId, meetingId, userId: ids.userId, label: "Fictional speaker" });
await t.run(async ctx => {
  const people = await ctx.db.query("peopleDirectory").withIndex("by_society", q => q.eq("societyId", ids.societyId)).take(10); assert.equal(people.length, 1);
  const transcript = await ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", meetingId)).unique(); assert.equal(transcript?.speakers?.[0].personId, people[0]._id);
  assert.equal((await ctx.db.get(ids.userId))?.role, "Owner");
  await ctx.db.patch(ids.userId, { status: "Disabled" });
});
await assert.rejects(owner.mutation(api.microsoftMeetings.commitImport, payload));
console.log("Teams meeting connector: workspace/organizer boundaries, Graph identity checks, size limits, repeat-import preservation, informal records and explicit user/speaker links passed.");
