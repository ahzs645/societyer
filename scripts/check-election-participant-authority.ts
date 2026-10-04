import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./elections.js": () => import("../convex/elections"),
} as any);
const fixture = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Election participants", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign election participants", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const memberId = await ctx.db.insert("members", { societyId, firstName: "Eligible", lastName: "Member", membershipClass: "Regular", status: "Active", joinedAt: "2026-01-01", votingRights: true });
  const membership = { status: "Active", authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() };
  const ownerUserId = await ctx.db.insert("users", { ...membership, societyId, role: "Owner", authSubject: "operator", email: "operator@example.test", displayName: "Operator" });
  const memberUserId = await ctx.db.insert("users", { ...membership, societyId, role: "Member", authSubject: "participant", email: "participant@example.test", displayName: "Participant", memberId });
  await ctx.db.insert("users", { ...membership, societyId: foreignSocietyId, role: "Owner", authSubject: "foreign", email: "foreign@example.test", displayName: "Foreign" });
  return { societyId, memberId, ownerUserId, memberUserId };
});
const owner = test.withIdentity({ subject: "operator", issuer });
const participant = test.withIdentity({ subject: "participant", issuer });
const foreign = test.withIdentity({ subject: "foreign", issuer });
const electionId = await owner.mutation(api.elections.create, { societyId: fixture.societyId, title: "Eligible participant", opensAtISO: "2026-01-01T00:00:00Z", closesAtISO: "2030-01-01T00:00:00Z" });
const questionId = await owner.mutation(api.elections.addQuestion, { electionId, title: "Choose a candidate", maxSelections: 1, options: [{ id: "candidate", label: "Candidate" }] });
assert.deepEqual(await owner.mutation(api.elections.snapshotEligibleVoters, { electionId }), { eligibleCount: 1 });
await assert.rejects(() => participant.mutation(api.elections.submitNomination, { electionId, nomineeName: "Forged nomination", actingUserId: fixture.ownerUserId }), /does not match the current principal/);
assert.equal((await owner.query(api.elections.listNominations, { electionId })).length, 0);
await participant.mutation(api.elections.submitNomination, { electionId, nomineeName: "Real nomination", actingUserId: fixture.memberUserId });
const nominations = await participant.query(api.elections.listNominations, { electionId });
assert.equal(nominations.length, 1); assert.equal(nominations[0].submittedByUserId, fixture.memberUserId);
const ballot = { electionId, choices: [{ questionId, optionIds: ["candidate"] }] };
await assert.rejects(() => participant.mutation(api.elections.castBallot, { ...ballot, actingUserId: fixture.ownerUserId }), /does not match the current principal/);
await assert.rejects(() => foreign.mutation(api.elections.castBallot, ballot), /membership|not found/i);
assert.equal((await owner.query(api.elections.get, { id: electionId })).ballotCount, 0);
await participant.mutation(api.elections.castBallot, { ...ballot, actingUserId: fixture.memberUserId });
await assert.rejects(() => participant.mutation(api.elections.castBallot, ballot), /already been cast/);
const memberBundle = await participant.query(api.elections.get, { id: electionId });
assert.equal(memberBundle.ballotCount, 1); assert.equal(memberBundle.eligible[0].status, "Voted"); assert.deepEqual(memberBundle.ballots, []);
console.log("Election participant authority passed: actual eligible Member nominations/ballot, explicit self actor, forged actor and foreign denial without side effects, duplicate ballot and private eligibility/ballot separation.");
