import assert from "node:assert/strict";

import { computeVotingPower, votesPerShareOf } from "../shared/votingPower";
import { StaticConvexClient } from "../src/lib/staticConvex";

/**
 * #4 Voting-power roll-up + eligibility gating. Total votes = Σ(shares ×
 * votes-per-share) per holder, partitioned voting/non-voting, plus the eligible
 * voting-signatory set (natural persons at the age of majority; minors and
 * corporate holders excluded).
 */

// --- votes-per-share resolution / inference ----------------------------------
assert.equal(votesPerShareOf({ rightsClassId: "x", votesPerShare: 10 }), 10);
assert.equal(votesPerShareOf({ rightsClassId: "x", votingRights: "Non-Voting" }), 0);
assert.equal(votesPerShareOf({ rightsClassId: "x", votingRights: "1 vote per share" }), 1);
assert.equal(votesPerShareOf({ rightsClassId: "x", classType: "non_voting" }), 0);
assert.equal(votesPerShareOf({ rightsClassId: "x" }), 0);

// --- the roll-up + eligibility partition -------------------------------------
const result = computeVotingPower(
  [
    { holderKey: "alice", holderName: "Alice Stone", rightsClassId: "A", quantity: 100 },
    { holderKey: "vane", holderName: "Vane Holdings Ltd.", rightsClassId: "A", quantity: 50 },
    { holderKey: "minor", holderName: "Tim Young", rightsClassId: "A", quantity: 10 },
    { holderKey: "carol", holderName: "Carol Reed", rightsClassId: "B", quantity: 300 },
  ],
  [
    { rightsClassId: "A", votesPerShare: 10 },
    { rightsClassId: "B", votingRights: "Non-Voting" },
  ],
  { minor: { atAgeOfMajority: false } },
);

assert.equal(result.totalVotes, 1600); // 1000 + 500 + 100 + 0
assert.deepEqual(result.voting.map((h) => h.holderKey), ["alice", "vane", "minor"]); // votes desc
assert.deepEqual(result.nonVoting.map((h) => h.holderKey), ["carol"]);
// only Alice is an eligible voting signatory: Vane is a corporation, Tim is a minor.
assert.deepEqual(result.eligibleSigners.map((h) => h.holderKey), ["alice"]);
const alice = result.holders.find((h) => h.holderKey === "alice")!;
assert.equal(alice.totalVotes, 1000);
assert.equal(alice.totalShares, 100);

// --- wired through the static mirror -----------------------------------------
const SOC = "soc-vp";
const seed = {
  societies: [{ _id: SOC, name: "Acme Inc.", entityType: "corporation__business_" }],
  rightsClasses: [
    { _id: "rc-a", societyId: SOC, className: "Class A", classType: "share", status: "active", votesPerShare: 10 },
    { _id: "rc-b", societyId: SOC, className: "Class B", classType: "share", status: "active", votingRights: "Non-Voting" },
  ],
  roleHolders: [
    { _id: "rh-1", societyId: SOC, roleType: "shareholder", fullName: "Alice Stone", directoryPersonId: "pd-1" },
    { _id: "rh-2", societyId: SOC, roleType: "shareholder", fullName: "Carol Reed", directoryPersonId: "pd-2" },
  ],
  peopleDirectory: [
    { _id: "pd-1", fullName: "Alice Stone", searchName: "alice stone", isIndividual: true, atAgeOfMajority: true },
    { _id: "pd-2", fullName: "Carol Reed", searchName: "carol reed", isIndividual: true, atAgeOfMajority: true },
  ],
  rightsHoldings: [
    { _id: "h-1", societyId: SOC, rightsClassId: "rc-a", holderKey: "k-1", holderRoleHolderId: "rh-1", quantity: 100, status: "current" },
    { _id: "h-2", societyId: SOC, rightsClassId: "rc-b", holderKey: "k-2", holderRoleHolderId: "rh-2", quantity: 300, status: "current" },
  ],
} as unknown as Record<string, unknown[]>;

const client = new StaticConvexClient({ databaseName: `societyer-vp-${Date.now()}`, seed: seed as never });
const vp = (await client.query("legalOperations:votingPower", { societyId: SOC })) as ReturnType<typeof computeVotingPower>;
assert.equal(vp.totalVotes, 1000, "Alice's 100 Class-A shares × 10 votes");
assert.deepEqual(vp.voting.map((h) => h.holderName), ["Alice Stone"]);
assert.deepEqual(vp.nonVoting.map((h) => h.holderName), ["Carol Reed"]);
assert.deepEqual(vp.eligibleSigners.map((h) => h.holderName), ["Alice Stone"]);

console.log("OK voting-power");
