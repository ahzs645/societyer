import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities, definePortableMutation, definePortableQuery } from "../shared/portable/index";
import * as handlers from "../shared/functions/elections";
import { PORTABLE_TEST_IDENTITY } from "./portable-test-fixture";
import { toDateTimeLocalValue } from "../src/lib/format";

type Actor = { mutation(name: string, args: any): Promise<any>; query(name: string, args: any): Promise<any> };
const mutations = ["create", "addQuestion", "snapshotEligibleVoters", "castBallot", "close", "tallyElection", "submitNomination", "reviewNomination", "publishNominationToBallot"];
const questions = { title: "Choose a candidate", maxSelections: 2, options: [{ id: "a", label: "Candidate A" }, { id: "b", label: "Candidate B" }] };

async function qualify(label: string, owner: Actor, member: Actor, ids: { societyId: string; foreignMemberId: string }) {
  const create = (title: string, extra: any = {}) => owner.mutation("create", { societyId: ids.societyId, title, opensAtISO: "2020-01-01T00:00:00Z", closesAtISO: "2099-01-01T00:00:00Z", ...extra });
  for (const extra of [{ title: " " }, { opensAtISO: "not-a-date" }, { closesAtISO: "2019-01-01T00:00:00Z" }, { initialQuestion: { ...questions, options: [] } }]) {
    await assert.rejects(() => create("Invalid draft", extra));
  }
  const beforeAtomicFailure = (await owner.query("list", { societyId: ids.societyId })).length;
  await assert.rejects(() => create("Foreign atomic draft", { initialQuestion: { ...questions, options: [{ id: "a", label: "Foreign", memberId: ids.foreignMemberId }] , maxSelections: 1 } }));
  assert.equal((await owner.query("list", { societyId: ids.societyId })).length, beforeAtomicFailure, "Rejected initial question must roll back its parent election");
  const electionId = await create("Complete draft", { initialQuestion: questions });
  let bundle = await owner.query("get", { id: electionId });
  assert.equal(bundle.questions.length, 1, "Initial question is created in the parent transaction");
  const questionId = bundle.questions[0]._id;
  const nominationId = await member.mutation("submitNomination", { electionId, nomineeName: "Nominee" });
  await assert.rejects(() => owner.mutation("reviewNomination", { id: nominationId, status: "OnBallot" }), /Accepted or Rejected/);
  await assert.rejects(() => owner.mutation("publishNominationToBallot", { id: nominationId, questionId }), /Accept the nomination/);
  await owner.mutation("reviewNomination", { id: nominationId, status: "Accepted" });
  await owner.mutation("publishNominationToBallot", { id: nominationId, questionId });
  await assert.rejects(() => owner.mutation("reviewNomination", { id: nominationId, status: "Rejected" }), /already on the ballot/);
  const additionalQuestion = await owner.mutation("addQuestion", { electionId, ...questions, title: "Second question", maxSelections: 1 });
  assert.equal((await owner.mutation("snapshotEligibleVoters", { electionId })).eligibleCount, 1);
  const ballot = { electionId, choices: [{ questionId, optionIds: ["a"] }, { questionId: additionalQuestion, optionIds: ["b"] }] };
  await assert.rejects(() => member.mutation("castBallot", { ...ballot, choices: [] }), /every ballot question/);
  await assert.rejects(() => member.mutation("castBallot", { ...ballot, choices: [ballot.choices[0]] }), /every ballot question/);
  await assert.rejects(() => member.mutation("castBallot", { ...ballot, choices: [ballot.choices[0], ballot.choices[0]] }), /every ballot question/);
  await assert.rejects(() => member.mutation("castBallot", { ...ballot, choices: [{ questionId, optionIds: ["a", "a"] }, ballot.choices[1]] }), /only be selected once/);
  assert.equal((await owner.query("get", { id: electionId })).ballotCount, 0);
  await member.mutation("castBallot", ballot);
  await assert.rejects(() => owner.mutation("snapshotEligibleVoters", { electionId }), /before the election opens/);
  await assert.rejects(() => owner.mutation("addQuestion", { electionId, ...questions }), /draft/);
  await assert.rejects(() => owner.mutation("publishNominationToBallot", { id: nominationId, questionId }), /draft/);
  await assert.rejects(() => member.mutation("castBallot", ballot), /already been cast/);
  bundle = await owner.query("get", { id: electionId });
  assert.equal(bundle.ballotCount, 1);
  assert.equal(bundle.eligible[0].status, "Voted", "Denied re-snapshot preserves the recorded voter status");
  await owner.mutation("close", { electionId });
  await owner.mutation("tallyElection", { electionId });
  await assert.rejects(() => owner.mutation("close", { electionId }), /open election/);
  await assert.rejects(() => member.mutation("submitNomination", { electionId, nomineeName: "Late nomination" }), /closed/);
  const emptyId = await create("Legacy empty draft");
  await assert.rejects(() => owner.mutation("snapshotEligibleVoters", { electionId: emptyId }), /Add a ballot question/);
  await assert.rejects(() => owner.mutation("tallyElection", { electionId: emptyId }), /Close the election/);
  await owner.mutation("addQuestion", { electionId: emptyId, ...questions });
  await owner.mutation("snapshotEligibleVoters", { electionId: emptyId });
  const futureId = await create("Future election", { opensAtISO: "2098-01-01T00:00:00Z", initialQuestion: questions });
  await owner.mutation("snapshotEligibleVoters", { electionId: futureId });
  const futureQuestion = (await owner.query("get", { id: futureId })).questions[0]._id;
  await assert.rejects(() => member.mutation("castBallot", { electionId: futureId, choices: [{ questionId: futureQuestion, optionIds: ["a"] }] }), /opening and closing window/);
  console.log(`${label}: atomic initial ballot, draft recovery, frozen eligibility/ballot, complete distinct selections, voting window, nominations and close/tally lifecycle passed.`);
}

const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./elections.js": () => import("../convex/elections"),
} as any);
const issuer = betterAuthIssuer();
const nativeIds = await native.run(async ctx => {
  const society = { isCharity: false, isMemberFunded: false, updatedAt: Date.now() };
  const societyId = await ctx.db.insert("societies", { ...society, name: "Election lifecycle" });
  const foreignSocietyId = await ctx.db.insert("societies", { ...society, name: "Foreign lifecycle" });
  const member = { firstName: "Confirmed", lastName: "Member", status: "Active", membershipClass: "Regular", joinedAt: "2020-01-01", votingRights: true };
  const memberId = await ctx.db.insert("members", { ...member, societyId });
  const foreignMemberId = await ctx.db.insert("members", { ...member, societyId: foreignSocietyId });
  const user = { societyId, status: "Active", authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() };
  await ctx.db.insert("users", { ...user, role: "Owner", authSubject: "lifecycle-owner", email: "owner@example.test", displayName: "Owner" });
  await ctx.db.insert("users", { ...user, role: "Member", authSubject: "lifecycle-member", email: "member@example.test", displayName: "Member", memberId });
  return { societyId, foreignMemberId };
});
const nativeActor = (subject: string): Actor => {
  const actor = native.withIdentity({ subject, issuer });
  return { mutation: (name, args) => actor.mutation((api.elections as any)[name], args), query: (name, args) => actor.query((api.elections as any)[name], args) };
};
await qualify("Native Convex", nativeActor("lifecycle-owner"), nativeActor("lifecycle-member"), nativeIds);

for (const label of ["MemoryDb", "LocalStoreDb"]) {
  const societyId = "lifecycle_society";
  const user = { societyId, status: "Active", authIssuer: PORTABLE_TEST_IDENTITY.issuer, authProvider: "portable-fixture", createdAtISO: "2020-01-01T00:00:00Z" };
  const seed = {
    societies: [{ _id: societyId, name: "Election lifecycle" }, { _id: "foreign_society", name: "Foreign" }],
    members: [{ _id: "local_member", societyId, firstName: "Confirmed", lastName: "Member", status: "Active", votingRights: true }, { _id: "foreign_member", societyId: "foreign_society", firstName: "Foreign", lastName: "Member" }],
    users: [{ ...user, _id: "local_owner", role: "Owner", authSubject: "lifecycle-owner", displayName: "Owner" }, { ...user, _id: "local_user", role: "Member", authSubject: "lifecycle-member", displayName: "Member", memberId: "local_member" }],
  };
  const db = label === "MemoryDb" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed));
  const actor = (subject: string): Actor => {
    const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject }) });
    runtime.registerAll([...mutations.map((name) => definePortableMutation({ name, handler: (handlers as any)[`${name}Portable`] })), ...["get", "list"].map((name) => definePortableQuery({ name, handler: (handlers as any)[`${name}Portable`] }))]);
    return { mutation: (name, args) => runtime.runMutation(name, args), query: (name, args) => runtime.runQuery(name, args) };
  };
  await qualify(label, actor("lifecycle-owner"), actor("lifecycle-member"), { societyId, foreignMemberId: "foreign_member" });
}

const originalTimezone = process.env.TZ;
try {
  for (const timezone of ["America/Vancouver", "America/Toronto", "UTC"]) {
    process.env.TZ = timezone;
    const instant = new Date("2026-06-15T18:45:00Z");
    assert.equal(new Date(toDateTimeLocalValue(instant)).getTime(), instant.getTime(), `Date controls must round-trip without shifting ${timezone} schedules`);
  }
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}
console.log("Election datetime controls round-trip in Vancouver, Toronto and UTC.");
