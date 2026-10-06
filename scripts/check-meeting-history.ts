import { validateMeetingEvidence, type QuorumCheckpoint } from "../shared/evidenceReview";
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { normalizeMeetingHistory, normalizeImportedSourceVersions, normalizeActionObservations, type MeetingHistory } from "../shared/meetingHistory";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { PORTABLE_TEST_AUTH_SUBJECT } from "./portable-test-fixture";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { PortableDoc } from "../shared/portable/ctx";
import type { ActionObservation } from "../shared/meetingHistory";
const issuer = betterAuthIssuer();

const history: MeetingHistory & { quorumCheckpoints: QuorumCheckpoint[] } = {
  actionObservations: [{ entryId: "action-1", actionKey: "committee:7:2025-01-01", sourceActionId: "7", text: "Review report", status: "on_hold", statusAsOf: "2025-01-10", dateAssigned: "2025-01-01", sourceExternalIds: ["google-drive:a"], sourceLocator: "Table 2 row 4" }],
  quorumCheckpoints: [{ id: "q-1", boundary: "Source boundary", sourceReference: "Source table row", sourceExternalIds: ["google-drive:a"], reviewStatus: "pending", scope: "session", scopeLabel: "AGM opening", assertion: "confirmed", atTime: "5:11 pm", eligibleCount: 12, eligiblePopulation: 15, evidence: "Chair declared quorum" }, { id: "q-2", boundary: "Source boundary", sourceReference: "Source table row", sourceExternalIds: ["google-drive:a"], reviewStatus: "pending", scope: "session", scopeLabel: "Board", assertion: "not_recorded" }],
  importedSourceVersions: [{ versionId: "v1", label: "Draft source", status: "draft", sourceExternalIds: ["google-drive:a"], contentJson: '{"discussion":"Original"}' }],
};
assert.deepEqual({ ...normalizeMeetingHistory(history), ...validateMeetingEvidence(history) }, history);
assert.throws(() => normalizeActionObservations([{ ...history.actionObservations![0], statusAsOf: "2025-02-30" }]), /valid YYYY/);
assert.throws(() => normalizeActionObservations([{ ...history.actionObservations![0], bogus: true }]), /unsupported history field/);
assert.throws(() => normalizeActionObservations([history.actionObservations![0], history.actionObservations![0]]), /duplicate entryId/);
assert.throws(() => normalizeImportedSourceVersions([{ versionId: "a", label: "A", status: "adopted", sourceExternalIds: ["x"] }]), /adoptedAt/);
assert.throws(() => normalizeImportedSourceVersions([{ ...history.importedSourceVersions![0], contentJson: "bad" }]), /invalid JSON/);
assert.throws(() => normalizeImportedSourceVersions([{ ...history.importedSourceVersions![0], supersedesVersionId: "v1" }]), /cycle/);
assert.throws(() => normalizeImportedSourceVersions([{ ...history.importedSourceVersions![0], supersedesVersionId: "missing" }]), /missing supersedes/);
assert.throws(() => normalizeImportedSourceVersions([{ ...history.importedSourceVersions![0], supersedesVersionId: "v2" }, { versionId: "v2", label: "V2", status: "revised", sourceExternalIds: ["x"], supersedesVersionId: "v1" }]), /cycle/);

type CarryArgs = { sourceMinutesId: string; targetMinutesId: string; sourceEntryId: string; notes?: string };
type HistoryDoc = PortableDoc & { actionObservations: ActionObservation[] };
type Driver = { update: (id: string, patch: Record<string, unknown>) => Promise<unknown>; carry: (args: CarryArgs) => Promise<{ entryId: string; created: boolean }>; get: (id: string) => Promise<HistoryDoc> };
async function scenario(d: Driver, sourceId: string, targetId: string, foreignId: string) {
  const before = await d.get(sourceId);
  const carried = await d.carry({ sourceMinutesId: sourceId, targetMinutesId: targetId, sourceEntryId: "action-1" });
  assert.equal(carried.created, true);
  const target = await d.get(targetId);
  const cited={id:'draft-q',boundary:'Opening',sourceExternalIds:['external:no-url'],sourceReference:'Opening',reviewStatus:'pending',assertion:'confirmed'};
  await d.update(targetId,{quorumCheckpoints:[cited]});
  await assert.rejects(()=>d.update(targetId,{quorumCheckpoints:[{...cited,eligibleCount:-1}]}),/nonnegative/);
  await assert.rejects(()=>d.update(targetId,{quorumCheckpoints:[{...cited,reviewStatus:'verified'}]}),/source URL/);
  await assert.rejects(()=>d.update(targetId,{quorumCheckpoints:[cited,cited]}),/distinct stable ID/);
  await assert.rejects(()=>d.update(targetId,{attendanceEvents:[{...cited,kind:'invented',personName:'Someone'}]}),/attendance event/);
  await assert.rejects(()=>d.update(targetId,{consentItems:[{...cited,outcome:'adopted',pinnedVersion:{sha256:'forged'}}]}),/saveEvidence/);

  assert.equal(target.actionObservations[0].actionKey, history.actionObservations![0].actionKey);
  assert.equal(target.actionObservations[0].status, "unknown");
  assert.equal(target.actionObservations[0].statusAsOf, undefined);
  assert.equal(target.actionObservations[0].sourceStatus, undefined);
  assert.deepEqual(await d.get(sourceId), before, "carry must not mutate prior observation");
  assert.equal((await d.carry({ sourceMinutesId: sourceId, targetMinutesId: targetId, sourceEntryId: "action-1" })).created, false);
  assert.equal((await d.get(targetId)).actionObservations.length, 1);
  await d.update(targetId, { heldAt: "2025-02-10" });
  await assert.rejects(() => d.carry({ sourceMinutesId: targetId, targetMinutesId: sourceId, sourceEntryId: carried.entryId }), /later meeting/);
  await d.update(targetId, { heldAt: before.heldAt });
  await assert.rejects(() => d.update(targetId, { heldAt: "2024-12-01" }), /later meeting/);
  await d.update(targetId, { heldAt: "Date not recorded" });
  assert.equal((await d.carry({ sourceMinutesId: sourceId, targetMinutesId: targetId, sourceEntryId: "action-1" })).created, false);
  assert.equal((await d.get(targetId)).heldAt, "Date not recorded", "unknown dates are not invented by carry validation");
  await d.update(targetId, { heldAt: before.heldAt });
  await assert.rejects(() => d.update(sourceId, { actionObservations: [{ ...history.actionObservations![0], carriedFromMinutesId: targetId, carriedFromEntryId: carried.entryId }] }), /ancestry contains a cycle/);
  await d.update(targetId, { motions: [{ text: "Review source adoption", outcome: "Carried" }] });
  const targetMotionId = (await d.get(targetId)).motionIds[0];
  await assert.rejects(() => d.update(sourceId, { importedSourceVersions: [{ ...history.importedSourceVersions![0], status: "adopted", adoptedAt: "2025-02-01", adoptionEvidence: "Explicit source evidence", adoptedInMeetingId: before.meetingId, adoptionMotionId: targetMotionId }] }), /motion and adopting meeting do not match/);
  await assert.rejects(() => d.carry({ sourceMinutesId: foreignId, targetMinutesId: targetId, sourceEntryId: "action-1" }), /not found/i);
  await assert.rejects(() => d.update(targetId, { actionObservations: [{ ...target.actionObservations[0], carriedFromMinutesId: foreignId }] }), /not found/i);
  await assert.rejects(() => d.update(targetId, { actionObservations: [{ ...target.actionObservations[0], actionKey: "invented" }] }), /identity/);
  const foreign = await d.get(foreignId);
  await assert.rejects(() => d.update(sourceId, { importedSourceVersions: [{ ...history.importedSourceVersions![0], status: "adopted", adoptedAt: "2025-02-01", adoptionEvidence: "Claim", adoptedInMeetingId: foreign.meetingId }] }), /not found/i);
  await assert.rejects(() => d.update(sourceId, { importedSourceVersions: [{ ...history.importedSourceVersions![0], status: "adopted", adoptedAt: "2025-02-01", adoptedInMeetingId: target.meetingId }] }), /explicit evidence|carried motion/);
  await d.update(sourceId, { approvedAt: "2025-02-01" });
  await assert.rejects(() => d.update(sourceId, { actionObservations: [] }), /frozen/);
  await assert.rejects(() => d.update(sourceId, { discussion: "Unrelated edit" }), /frozen/, "upstream freezes all adopted content");
  assert.equal((await d.get(sourceId)).actionObservations.length, 1);
  await d.update(sourceId, { clearApproval: true, actionObservations: history.actionObservations });
  const adopted = { ...history.importedSourceVersions![0], status: "adopted", adoptedAt: "2025-02-01", adoptionEvidence: "Resolution recorded in approved February minutes, item 2" };
  await d.update(sourceId, { importedSourceVersions: [adopted] });
  await assert.rejects(() => d.update(sourceId, { importedSourceVersions: [] }), /immutable/);
  await assert.rejects(() => d.update(sourceId, { clearApproval: true, importedSourceVersions: [{ ...adopted, contentJson: '{}' }] }), /immutable/);
  await d.update(sourceId, { importedSourceVersions: [adopted, { versionId: "v2", label: "Revised draft", status: "revised", sourceExternalIds: ["google-drive:b"], supersedesVersionId: "v1" }] });
  assert.equal((await d.get(sourceId)).importedSourceVersions.length, 2);
  await d.update(targetId, { approvedAt: "2025-03-01" });
  await assert.rejects(() => d.carry({ sourceMinutesId: sourceId, targetMinutesId: targetId, sourceEntryId: "action-1" }), /approved/);
}
const societyId = "history_society";
const baseMinutes = { heldAt: "2025-01-10", attendees: [], absent: [], quorumMet: false, quorumStatus: "not_recorded" as const, discussion: "Source discussion", decisions: [], actionItems: [] };
const seed = { societies: [{ _id: societyId, name: "History" }, { _id: "foreign", name: "Foreign" }], meetings: [
  { _id: "m1", societyId, title: "Source", type: "Board", scheduledAt: "2025-01-10", electronic: false, status: "Held", attendeeIds: [] },
  { _id: "m2", societyId, title: "Target", type: "Board", scheduledAt: "2025-02-10", electronic: false, status: "Held", attendeeIds: [] },
], minutes: [{ _id: "source", societyId, meetingId: "m1", ...baseMinutes, ...history }, { _id: "target", societyId, meetingId: "m2", ...baseMinutes }, { _id: "foreign_minutes", societyId: "foreign", meetingId: "other", ...baseMinutes, ...history }] };
const client = new StaticConvexClient({ seed }); await client.whenLocalWorkspaceReady();
const driver: Driver = { update: (id, patch) => client.mutation("minutes:update", { id, patch }), carry: (args) => client.mutation("minutes:carryForwardAction", args), get: async (id) => client.exportLocalWorkspaceSnapshot().tables.minutes.find((row) => row._id === id)! as HistoryDoc };
await scenario(driver, "source", "target", "foreign_minutes");
await assert.rejects(() => client.mutation("minutes:upsertFromDraft", { societyId, meetingId: "m1", ...baseMinutes, motions: [], importedSourceVersions: [] }), /immutable/);
await assert.rejects(() => client.mutation("minutes:upsertFromDraft", { societyId, meetingId: "m2", ...baseMinutes, motions: [], actionObservations: [] }), /frozen/);

await assert.rejects(()=>client.mutation('minutes:create',{societyId,meetingId:'m1',...baseMinutes,attendanceEvents:[{id:'bad',personName:'Someone',kind:'invented',boundary:'Opening',sourceUrl:'https://example.org',sourceReference:'Row'}]}),/attendance event/);
await assert.rejects(()=>client.mutation('minutes:upsertFromDraft',{societyId,meetingId:'m1',...baseMinutes,motions:[],consentItems:[{id:'adopted',outcome:'adopted',sourceUrl:'https://example.org',sourceReference:'Row',reviewStatus:'verified'}]}),/saveEvidence/);
await driver.update("source", { actionObservations: undefined });
assert.equal((await driver.get("source")).actionObservations.length, 1, "undefined optional patch must not delete history");
const restored = new StaticConvexClient({ seed: { societies: [] } });
await restored.importLocalWorkspaceSnapshot(JSON.parse(JSON.stringify(client.exportLocalWorkspaceSnapshot())));
for (const before of client.exportLocalWorkspaceSnapshot().tables.minutes) {
  const after = restored.exportLocalWorkspaceSnapshot().tables.minutes.find((row) => row._id === before._id);
  for (const key of ["actionObservations", "quorumCheckpoints", "importedSourceVersions"] as const) assert.deepEqual(after[key], before[key], `Backup preserves ${key}`);
}

// Real hosted schema and mutation validators, with authenticated ownership.
const hostedHistory = history as unknown as Pick<Doc<"minutes">, "actionObservations" | "quorumCheckpoints" | "importedSourceVersions">;
const t = convexTest(schema, { "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"), "./minutes.js": () => import("../convex/minutes") });
const testIds = await t.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "History", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  await ctx.db.insert("users", { societyId, email: "owner@portable-fixture.test", displayName: "Owner", role: "Owner", status: "Active", authProvider: "better-auth", authIssuer: issuer, authSubject: PORTABLE_TEST_AUTH_SUBJECT, createdAtISO: "2025-01-01T00:00:00Z" });
  const meeting = (societyId: Id<"societies">, title: string) => ctx.db.insert("meetings", { societyId, title, type: "Board", scheduledAt: "2025-01-10", electronic: false, status: "Held", attendeeIds: [] });
  const source = await ctx.db.insert("minutes", { societyId, meetingId: await meeting(societyId, "Source"), ...baseMinutes, ...hostedHistory });
  const target = await ctx.db.insert("minutes", { societyId, meetingId: await meeting(societyId, "Target"), ...baseMinutes });
  const foreign = await ctx.db.insert("minutes", { societyId: foreignSocietyId, meetingId: await meeting(foreignSocietyId, "Foreign"), ...baseMinutes, ...hostedHistory });
  return { source, target, foreign };
});
const auth = t.withIdentity({ subject: PORTABLE_TEST_AUTH_SUBJECT, issuer });
await assert.rejects(() => t.mutation(api.minutes.carryForwardAction, { sourceMinutesId: testIds.source, targetMinutesId: testIds.target, sourceEntryId: "action-1" }), /Authentication required/);
await t.run(async ctx => {
  await ctx.db.insert("users", { societyId: (await ctx.db.get(testIds.source))!.societyId, email: "viewer@portable-fixture.test", displayName: "Viewer", role: "Viewer", status: "Active", authProvider: "better-auth", authIssuer: issuer, authSubject: "history-viewer", createdAtISO: "2025-01-01T00:00:00Z" });
});
await assert.rejects(() => t.withIdentity({ subject: "history-viewer", issuer }).mutation(api.minutes.carryForwardAction, { sourceMinutesId: testIds.source, targetMinutesId: testIds.target, sourceEntryId: "action-1" }), /Permission minutes:write/);

await scenario({ update: (id, patch) => auth.mutation(api.minutes.update, { id: id as Id<"minutes">, patch }), carry: (args) => auth.mutation(api.minutes.carryForwardAction, { ...args, sourceMinutesId: args.sourceMinutesId as Id<"minutes">, targetMinutesId: args.targetMinutesId as Id<"minutes"> }), get: (id) => t.run(async ctx => await ctx.db.get(id as Id<"minutes">) as unknown as HistoryDoc) }, testIds.source, testIds.target, testIds.foreign);

// The exact offline import path carries all arrays into native rows.
const intake = new StaticConvexClient({ seed: { societies: [{ _id: societyId, name: "History" }] } }); await intake.whenLocalWorkspaceReady();
const bundle = { meetingMinutes: [{ meetingTitle: "History source", meetingDate: "2025-01-10", sourceExternalIds: ["google-drive:a"], ...history }] };
const sessionId = await intake.mutation("importSessions:createFromBundle", { societyId, bundle });
await intake.mutation("importSessions:bulkSetStatus", { sessionId, status: "Approved" });
await intake.mutation("importSessions:applyApprovedMeetings", { sessionId });
const native = intake.exportLocalWorkspaceSnapshot().tables.minutes[0];
for (const key of ["actionObservations", "quorumCheckpoints", "importedSourceVersions"] as const) assert.deepEqual(native[key], history[key]);
const secondSession = await intake.mutation("importSessions:createFromBundle", { societyId, bundle: { meetingMinutes: [{ meetingTitle: "History source", meetingDate: "2025-01-10", sourceExternalIds: ["google-drive:a"], quorumCheckpoints: [{ id: "q-3", boundary: "Source boundary", sourceReference: "Source table row", sourceExternalIds: ["google-drive:a"], reviewStatus: "pending", scope: "meeting", assertion: "not_recorded", reason: "Later review" }] }] } });
await intake.mutation("importSessions:bulkSetStatus", { sessionId: secondSession, status: "Approved" });
await intake.mutation("importSessions:applyApprovedMeetings", { sessionId: secondSession });
assert.equal(intake.exportLocalWorkspaceSnapshot().tables.minutes.length, 1);
assert.equal(intake.exportLocalWorkspaceSnapshot().tables.minutes[0].quorumCheckpoints.length, 3, "new observation appends rather than overwriting prior events");
const conflictingSession = await intake.mutation("importSessions:createFromBundle", { societyId, bundle: { meetingMinutes: [{ meetingTitle: "History source", meetingDate: "2025-01-10", sourceExternalIds: ["google-drive:a"], quorumCheckpoints: [{ id: "q-3", boundary: "Source boundary", sourceReference: "Source table row", sourceExternalIds: ["google-drive:a"], reviewStatus: "pending", scope: "meeting", assertion: "confirmed" }] }] } });
await intake.mutation("importSessions:bulkSetStatus", { sessionId: conflictingSession, status: "Approved" });
await assert.rejects(() => intake.mutation("importSessions:applyApprovedMeetings", { sessionId: conflictingSession }), /conflicting evidence identity/);
assert.equal(intake.exportLocalWorkspaceSnapshot().tables.minutes[0].quorumCheckpoints[2].assertion, "not_recorded", "conflicting import leaves native observation unchanged");
console.log("Meeting history passed: strict normalization, native import, backup, local and real Convex ownership, idempotent carry, approval freeze, immutable adoption, revision append.");
