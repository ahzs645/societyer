// WP-B Convex oracle: the import core, the new model fields and the repair
// mutation validate against the REAL Convex schema (convex-test with schema
// validation), not only the local row store. Synthetic data only.
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const api: any = anyApi;
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./importSessions.js": () => import("../convex/importSessions"),
  "./minutes.js": () => import("../convex/minutes"),
  "./motions.js": () => import("../convex/motions"),
  "./meetings.js": () => import("../convex/meetings"),
  "./conflicts.js": () => import("../convex/conflicts"),
} as any);
const issuer = betterAuthIssuer();
const now = new Date().toISOString();
const ids = await t.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Fictional import oracle", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  await ctx.db.insert("users", { societyId, email: "oracle-owner@example.invalid", displayName: "Oracle owner", role: "Owner", status: "Active", authSubject: "oracle-owner", authIssuer: issuer, authProvider: "better-auth", createdAtISO: now });
  const personId = await ctx.db.insert("peopleDirectory", { societyId, fullName: "Alex Example", searchName: "alex example", createdAtISO: now, updatedAtISO: now });
  // A legacy-shaped meeting for the repair mutation.
  const meetingId = await ctx.db.insert("meetings", { societyId, type: "Board", title: "2014-03-04 ExampleExecutiveMinutes DRAFT.docx", scheduledAt: "2014-03-04T12:00:00.000Z", electronic: false, status: "Held", attendeeIds: [] });
  const minutesId = await ctx.db.insert("minutes", { societyId, meetingId, heldAt: "2014-03-04T12:00:00.000Z", attendees: ["Members", "Alex Example"], absent: [], quorumMet: false, quorumStatus: "not_recorded", discussion: "Quorum reached at 6:05.", decisions: [], actionItems: [], sourceExternalIds: ["google-drive:legacy"], sections: [{ title: "| Welcome" }], motions: [{ text: "Embedded legacy motion", outcome: "Passed" }] });
  await ctx.db.patch(meetingId, { minutesId });
  return { societyId, personId, meetingId, minutesId };
});
const owner = t.withIdentity({ subject: "oracle-owner", issuer });

const bundle = {
  sources: [{ externalSystem: "google-drive", externalId: "google-drive:oracle", title: "Oracle minutes", url: "https://drive.google.com/file/d/oracle/view" }],
  meetingMinutes: [{
    meetingDate: "2021-05-18", meetingTitle: "2021-05-18 Example Operations Minutes DRAFT.docx", confidence: "High", sourceExternalIds: ["google-drive:oracle"],
    meetingStatus: "Held", localStartText: "6:00 PM", localEndText: "7:00 PM",
    attendees: ["Alex Example", "Public Member", "Members"], absent: ["Blair Sample"],
    agendaItems: [{ title: "Approve minutes", number: "4", requestedAction: "approve", startTime: "6:13", presenter: "Chair", consent: false }],
    sections: [{ title: "| Minutes", depth: 0, motionIndex: 0, actionItems: [{ text: "Follow up", assignee: "Alex Example", status: "ongoing" }] }],
    actionItems: [{ text: "No status given" }],
    nextMeetings: [{ at: "2021-06-15" }],
    motions: [{ motionText: "To approve the agenda", outcome: "Passed", movedByName: "Alex Example", voteSummary: "Carried", pageRef: "p. 1", abstainedBy: ["Blair Sample"] }],
  }],
  committees: [{ name: "Planning Committee", quorumRule: { quorumType: "all_members" }, confidence: "High" }],
  tasks: [{ title: "Imported historical action", assignee: "Alex Example", confidence: "High" }],
  conflicts: [{ personName: "Alex Example", natureOfInterest: "Employer", contractOrMatter: "Contract", declaredAt: "2021-05-18", confidence: "High" }],
  bylawRuleSets: [{ bodyQuorumRules: [{ body: "board", quorumType: "percentage", quorumValue: 60 }], confidence: "High" }],
  signingAuthorities: [{ personName: "Alex Example", effectiveDate: "2021-01-01", tiers: [{ maxCents: 500000, signaturesRequired: 1 }], confidence: "High" }],
};
const sessionId = await owner.mutation(api.importSessions.createFromBundle, { societyId: ids.societyId, bundle });
await owner.mutation(api.importSessions.bulkSetStatus, { sessionId, status: "Approved" });
const applied = await owner.mutation(api.importSessions.applyApprovedMeetings, { sessionId });
assert.equal(applied.meetings, 1);
const sections = await owner.mutation(api.importSessions.applyApprovedSectionRecords, { sessionId });
assert.equal(sections.preflightBlocked, undefined, JSON.stringify(sections));
const snapshot = await t.run(async (ctx) => ({
  meetings: await ctx.db.query("meetings").collect(),
  minutes: await ctx.db.query("minutes").collect(),
  motions: await ctx.db.query("motions").collect(),
  agendaItems: await ctx.db.query("agendaItems").collect(),
  committees: await ctx.db.query("committees").collect(),
  tasks: await ctx.db.query("tasks").collect(),
  conflicts: await ctx.db.query("conflicts").collect(),
  bylawRuleSets: await ctx.db.query("bylawRuleSets").collect(),
  signingAuthorities: await ctx.db.query("signingAuthorities").collect(),
}));
const meeting = snapshot.meetings.find((row: any) => row.scheduledAt.startsWith("2021-05-18"))!;
assert.equal(meeting.title, "Operations Committee meeting — 2021-05-18");
assert.equal(meeting.scheduledAtPrecision, "date");
const minutes = snapshot.minutes.find((row: any) => row.meetingId === meeting._id)!;
assert.deepEqual(minutes.attendees, ["Alex Example"]);
assert.equal(minutes.detailedAttendance!.find((row: any) => row.name === "Alex Example")!.personId, ids.personId);
assert.equal(minutes.actionItems[0].status, "unknown");
assert.equal(minutes.sections![0].motionId, minutes.motionIds![0]);
const motion = snapshot.motions.find((row: any) => row.minutesId === minutes._id)!;
assert.deepEqual([motion.status, motion.outcome, motion.sourceOutcomeText, motion.movedByPersonId], ["Voted", "Carried", "Passed", ids.personId]);
assert.equal(motion.sourceLocator!.pageRef, "p. 1");
assert.ok(snapshot.agendaItems.some((row: any) => row.itemNumber === "4" && row.requestedAction === "approve" && row.scheduledTimeText === "6:13"));
assert.equal(snapshot.committees.find((row: any) => row.name === "Planning Committee")!.quorumRule!.quorumType, "all_members");
assert.equal(snapshot.tasks[0].assigneePersonId, ids.personId);
assert.equal(snapshot.conflicts[0].directorId, undefined);
assert.equal(snapshot.bylawRuleSets[0].status, "Draft");
assert.equal(snapshot.signingAuthorities[0].tiers!.length, 1);

const repair = await owner.mutation(api.minutes.repairImported, { societyId: ids.societyId });
assert.equal(repair.embeddedMotionsSynced, 1);
assert.equal(repair.quorumFromSource, 1);
const repaired = await t.run(async (ctx) => ({ meeting: await ctx.db.get(ids.meetingId), minutes: await ctx.db.get(ids.minutesId) }));
assert.equal(repaired.meeting!.title, "Executive Committee meeting — 2014-03-04");
assert.equal(repaired.minutes!.motions, undefined);
assert.equal(repaired.minutes!.quorumStatus, "confirmed");
assert.equal((await owner.mutation(api.minutes.repairImported, { societyId: ids.societyId })).meetingTitlesCleaned, 0);

await assert.rejects(owner.mutation(api.motions.create, { societyId: ids.societyId, text: "Bad", status: "Voted", outcome: "Carried", votesFor: 1, votesAgainst: 10, abstentions: -2 }), /negative/);
await assert.rejects(owner.mutation(api.motions.create, { societyId: ids.societyId, text: "Bad", status: "Voted", outcome: "Carried", votesFor: 1, votesAgainst: 10 }), /majority/);
assert.ok(await owner.mutation(api.motions.create, { societyId: ids.societyId, text: "Consensus", status: "Voted", outcome: "Carried", votesFor: 1, votesAgainst: 10, decidedBy: "consent", outcomeOverrideNote: "Consensus before the count", movedByPersonId: ids.personId }));
assert.ok(await owner.mutation(api.conflicts.create, { societyId: ids.societyId, personId: ids.personId, declaredAt: "2021-05-18", contractOrMatter: "Lease", natureOfInterest: "Landlord", abstainedFromVote: true, leftRoom: true }));
assert.ok(await owner.mutation(api.meetings.create, { societyId: ids.societyId, type: "Board", title: "External", scheduledAt: "2021-06-01", scheduledAtPrecision: "date", localStartText: "5:00 PM", hostBody: "external", externalOrganization: "Regional Air Group", electronic: false, status: "Held", attendeeIds: [] }));
console.log("✓ Convex schema accepts the import core, model extensions, repair and G-04 validation.");
