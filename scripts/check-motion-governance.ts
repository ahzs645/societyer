import assert from "node:assert/strict";
import {
  isAdjournmentMotion,
  isPreviousMinutesMotion,
  isRoutineMotion,
} from "../src/lib/motionGovernance";
import {
  classifyProceduralMotion,
  defaultDecidedByFor,
  applyProceduralTags,
  isDecidedWithoutVote,
  ROUTINE_MOTION_TAGS,
} from "../shared/proceduralMotions";

// --- isAdjournmentMotion ---
assert.equal(isAdjournmentMotion({ text: "Motion to adjourn the meeting" }), true, "adjourn verb");
assert.equal(isAdjournmentMotion({ text: "BE IT RESOLVED the adjournment stand" }), true, "adjournment noun");
assert.equal(isAdjournmentMotion({ text: "Approve the annual budget" }), false, "non-adjournment");

// --- isPreviousMinutesMotion ---
assert.equal(isPreviousMinutesMotion({ text: "Motion to approve the minutes of the last meeting" }), true, "approve minutes");
assert.equal(isPreviousMinutesMotion({ text: "Adopt previous meeting minutes" }), true, "adopt minutes");
assert.equal(isPreviousMinutesMotion({ text: "Confirm the minutes as circulated" }), true, "confirm minutes");
assert.equal(isPreviousMinutesMotion({ text: "Approve the new budget" }), false, "approve non-minutes");
assert.equal(isPreviousMinutesMotion({ text: "Record the minutes taker" }), false, "minutes without approve verb");

// --- isRoutineMotion (drives the master-list default filter) ---
assert.equal(isRoutineMotion({ text: "Motion to adjourn" }), true, "adjournment is routine");
assert.equal(isRoutineMotion({ text: "Approve minutes of the prior meeting" }), true, "previous-minutes is routine");
assert.equal(
  isRoutineMotion({ text: "Adopt the new bylaws", tags: ["routine"] }),
  true,
  "explicit routine tag",
);
assert.equal(
  isRoutineMotion({ text: "Adopt the new bylaws", tags: ["adjournment"] }),
  true,
  "explicit adjournment tag",
);
assert.equal(
  isRoutineMotion({ text: "Make Times New Roman the official font", tags: ["governance"] }),
  false,
  "substantive motion is not routine",
);

// --- classifyProceduralMotion (the shared catalogue) ---
assert.equal(classifyProceduralMotion({ text: "Motion to adjourn" })?.key, "adjournment", "adjourn → adjournment kind");
assert.equal(
  classifyProceduralMotion({ text: "Approve the minutes of the last meeting" })?.key,
  "previous-minutes",
  "approve minutes → previous-minutes kind",
);
assert.equal(
  classifyProceduralMotion({ text: "Approve the agenda as circulated" })?.key,
  "approve-agenda",
  "approve agenda → approve-agenda kind",
);
assert.equal(classifyProceduralMotion({ text: "Motion to recess for 10 minutes" })?.key, "recess", "recess kind");
assert.equal(
  classifyProceduralMotion({ text: "Receive the treasurer's report" })?.key,
  "receive-reports",
  "receive report → receive-reports kind",
);
assert.equal(classifyProceduralMotion({ text: "Approve the annual budget" }), null, "substantive motion → no procedural kind");
// An explicit stored kind/tag wins over wording.
assert.equal(
  classifyProceduralMotion({ text: "Some custom wording", proceduralKind: "adjournment" })?.key,
  "adjournment",
  "explicit proceduralKind wins",
);

// --- defaultDecidedByFor (most procedural motions pass by general consent) ---
assert.equal(defaultDecidedByFor({ text: "Motion to adjourn" }), "consent", "adjournment defaults to consent");
assert.equal(defaultDecidedByFor({ text: "Approve the prior minutes" }), "consent", "approve-minutes defaults to consent");
assert.equal(defaultDecidedByFor({ text: "Motion to recess" }), "vote", "recess defaults to a recorded vote");
assert.equal(defaultDecidedByFor({ text: "Approve the annual budget" }), "vote", "substantive motions default to a recorded vote");

// --- applyProceduralTags (auto-label so the master list filters by a stored tag) ---
assert.deepEqual(
  applyProceduralTags(undefined, { text: "Motion to adjourn the meeting" }),
  ["adjournment"],
  "adjournment motion is auto-tagged 'adjournment'",
);
assert.deepEqual(
  applyProceduralTags(["finance"], { text: "Approve the minutes of the last AGM" }),
  ["finance", "previous-minutes"],
  "auto-tag merges with existing tags and dedupes",
);
assert.deepEqual(
  applyProceduralTags(["adjournment"], { text: "Motion to adjourn" }),
  ["adjournment"],
  "re-tagging is idempotent",
);
assert.deepEqual(
  applyProceduralTags(["governance"], { text: "Approve the annual budget" }),
  ["governance"],
  "substantive motions get no procedural tag",
);

// --- isDecidedWithoutVote ---
assert.equal(isDecidedWithoutVote("consent"), true, "consent → decided without a vote");
assert.equal(isDecidedWithoutVote("automatic"), true, "automatic → decided without a vote");
assert.equal(isDecidedWithoutVote("vote"), false, "vote → has a tally");
assert.equal(isDecidedWithoutVote(undefined), false, "missing → defaults to a tally");

// --- routine breadth: approve-agenda / receive-reports are routine, recess is not ---
assert.equal(isRoutineMotion({ text: "Approve the agenda" }), true, "approve-agenda is routine");
assert.equal(isRoutineMotion({ text: "Receive the committee report" }), true, "receive-reports is routine");
assert.equal(isRoutineMotion({ text: "Motion to recess for lunch" }), false, "recess is not routine bookkeeping");
assert.ok(ROUTINE_MOTION_TAGS.includes("adjournment"), "adjournment is a routine tag");
assert.ok(ROUTINE_MOTION_TAGS.includes("previous-minutes"), "previous-minutes is a routine tag");

console.log("motion governance checks passed");
