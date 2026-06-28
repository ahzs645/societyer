import assert from "node:assert/strict";
import {
  isAdjournmentMotion,
  isPreviousMinutesMotion,
  isRoutineMotion,
} from "../src/lib/motionGovernance";

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

console.log("motion governance checks passed");
