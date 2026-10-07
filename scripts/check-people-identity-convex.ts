/**
 * WP-H: the new people/members/tasks functions against the real Convex schema
 * and argument validators (convex-test, no live backend). Synthetic data.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const api: any = anyApi;
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./personHistory.js": () => import("../convex/personHistory"),
  "./memberGovernance.js": () => import("../convex/memberGovernance"),
  "./peopleDirectory.js": () => import("../convex/peopleDirectory"),
  "./tasks.js": () => import("../convex/tasks"),
  "./committees.js": () => import("../convex/committees"),
  "./directors.js": () => import("../convex/directors"),
} as any);
const issuer = betterAuthIssuer();
const now = "2026-01-01T00:00:00.000Z";
const ids = await t.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Fictional identity fixture", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const other = await ctx.db.insert("societies", { name: "Other fictional workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const [subject, role, sid] of [["identity-owner", "Owner", societyId], ["identity-viewer", "Viewer", societyId]] as const) {
    await ctx.db.insert("users", { societyId: sid, email: `${subject}@example.invalid`, displayName: subject, role, status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: now });
  }
  const a = await ctx.db.insert("peopleDirectory", { societyId, fullName: "Jordan Sample", searchName: "jordan sample", createdAtISO: now, updatedAtISO: now });
  const b = await ctx.db.insert("peopleDirectory", { societyId, fullName: "Jordon Sample", searchName: "jordon sample", createdAtISO: now, updatedAtISO: now });
  const foreign = await ctx.db.insert("peopleDirectory", { societyId: other, fullName: "Foreign Person", searchName: "foreign person", createdAtISO: now, updatedAtISO: now });
  const meetingId = await ctx.db.insert("meetings", { societyId, title: "Fictional meeting", scheduledAt: "2019-03-01", electronic: false, type: "Board", status: "Held", attendeeIds: [] });
  const minutesId = await ctx.db.insert("minutes", { societyId, meetingId, heldAt: "2019-03-01", attendees: [], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [] });
  const occurrenceId = await ctx.db.insert("personOccurrences", { societyId, occurrenceKey: "k1", recordTable: "minutes", recordId: minutesId, personName: "Jordon Sample", context: "Attendance (Present)", observedDate: "2019-03-01", meetingId, sourceUrl: "https://example.invalid/m", sourceReference: "p. 1", personId: b, matchStatus: "suggested", reviewHistory: [], createdAtISO: now });
  await ctx.db.insert("personHistoryEvents", { societyId, personId: b, eventKey: "e1", kind: "observation", title: "Attended", scope: "Meeting", effectiveDate: "2019-03-01", transition: "observed", reviewStatus: "pending", sourceOccurrenceId: occurrenceId, sourceUrl: "https://example.invalid/m", sourceReference: "p. 1", createdAtISO: now, createdByUserId: "u" });
  const seatId = await ctx.db.insert("organizationSeats", { societyId, seatKey: "Fictional Org / Board", organizationName: "Fictional Org", observations: [{ id: "o1", kind: "contact", personName: "Jordan Sample", roleTitle: "Director", observedDate: "2025-03", reviewStatus: "pending", sourceUrl: "https://example.invalid/r", sourceReference: "Board!A2" }], createdAtISO: now });
  const taskId = await ctx.db.insert("tasks", { societyId, title: "Review historical action: Taylor to draft", status: "Todo", priority: "Medium", tags: ["historical-source-action"], meetingId, createdAtISO: now });
  return { societyId, a, b, foreign, seatId, taskId };
});
const owner = t.withIdentity({ subject: "identity-owner", issuer });
const viewer = t.withIdentity({ subject: "identity-viewer", issuer });
const source = { sourceUrl: "https://example.invalid/s", sourceReference: "Fictional citation", reviewStatus: "verified" };

assert.ok((await owner.query(api.personHistory.duplicateSuggestions, { societyId: ids.societyId })).some((s: any) => s.ids.includes(ids.a) && s.ids.includes(ids.b)));
await assert.rejects(() => viewer.mutation(api.personHistory.mergePeople, { societyId: ids.societyId, survivorId: ids.a, mergedIds: [ids.b], rationale: "x" }), /Permission members:write/);
await assert.rejects(() => owner.mutation(api.personHistory.mergePeople, { societyId: ids.societyId, survivorId: ids.a, mergedIds: [ids.foreign], rationale: "x" }), /not found/i);
const merged = await owner.mutation(api.personHistory.mergePeople, { societyId: ids.societyId, survivorId: ids.a, mergedIds: [ids.b], rationale: "Spelling variant" });
assert.equal(merged.merges.length, 1);
assert.equal(await t.run(async (ctx) => (await ctx.db.get(ids.b))?.mergedIntoId), ids.a, "schema accepts the merge tombstone");
const [mergeRow] = await owner.query(api.personHistory.mergeHistory, { societyId: ids.societyId });
await owner.mutation(api.personHistory.unmergePeople, { societyId: ids.societyId, mergeId: mergeRow._id });
assert.equal(await t.run(async (ctx) => (await ctx.db.get(ids.b))?.mergedIntoId ?? null), null);
await assert.rejects(() => owner.query(api.personHistory.profile, { societyId: ids.societyId, personId: ids.foreign }), /not found/i);
assert.equal((await owner.mutation(api.personHistory.repairOrphanedEvents, { societyId: ids.societyId, dryRun: true })).count, 0);

const memberId = await owner.mutation(api.memberGovernance.saveOrganizationMember, { societyId: ids.societyId, organizationName: "Fictional Org", membershipClass: "Organization", status: "Active", joinedAt: "2015", votingRights: true, linkSeatIds: [ids.seatId] });
assert.equal(await t.run(async (ctx) => (await ctx.db.get(memberId))?.memberKind), "organization");
await owner.mutation(api.memberGovernance.recordRepresentative, { seatId: ids.seatId, personId: ids.a, termStart: "2021-09", endPreviousObservationId: "o1", source });
const seat = await owner.query(api.memberGovernance.seatDetail, { seatId: ids.seatId });
assert.equal(seat.memberId, memberId);
assert.equal(seat.current[0].personId, ids.a);
await owner.mutation(api.memberGovernance.updateSeat, { seatId: ids.seatId, memberId: null, status: "active" });
assert.equal(await t.run(async (ctx) => (await ctx.db.get(ids.seatId))?.memberId ?? null), null);
await assert.rejects(() => viewer.mutation(api.memberGovernance.recordRepresentative, { seatId: ids.seatId, personName: "X", source }), /Permission/);

const summary = await owner.mutation(api.tasks.consolidateHistoricalActions, { societyId: ids.societyId, dryRun: false });
assert.equal(summary.statusUnknown, 1);
assert.equal(await t.run(async (ctx) => (await ctx.db.get(ids.taskId))?.status), "Unknown");
await owner.mutation(api.tasks.promoteHistoricalAction, { id: ids.taskId });
assert.equal(await t.run(async (ctx) => (await ctx.db.get(ids.taskId))?.status), "Todo");

await owner.mutation(api.directors.promoteRosterObservation, { seatId: ids.seatId, observationId: (seat.observations as any[]).find((o) => o.supersedes === "o1").id }).catch((e: Error) => assert.match(e.message, /not found|already/i));
const roster = await owner.mutation(api.committees.buildRostersFromSeats, { societyId: ids.societyId, dryRun: true });
assert.equal(roster.dryRun, true);
await owner.mutation(api.peopleDirectory.addToSociety, { societyId: ids.societyId, directoryPersonId: ids.a, roleType: "director", startDate: "2024", sourceReference: "Fictional AGM", nowISO: now });
assert.ok(await t.run(async (ctx) => (await ctx.db.query("directors").collect()).some((d) => d.directoryPersonId === ids.a && d.status === "Active")));
console.log("OK people identity on the Convex schema: merge/unmerge tombstone, foreign profile denial, organization member and representative term, historical action statuses, roster dry run, director register entry");
