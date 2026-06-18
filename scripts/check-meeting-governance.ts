import assert from "node:assert/strict";
import {
  thresholdFor,
  motionMeetsThreshold,
  isAdjournmentMotion,
  isPostponedOutcome,
  normalizeMotionOutcome,
  MOTION_OUTCOMES,
} from "../src/lib/motionGovernance";
import { redactText } from "../src/lib/redactPii";

// ---------------------------------------------------------------------------
// thresholdFor — resolution thresholds per the Societies Act
// ---------------------------------------------------------------------------
assert.equal(thresholdFor(undefined), 0.5, "default/ordinary is simple majority");
assert.equal(thresholdFor("Ordinary"), 0.5, "ordinary is simple majority");
assert.equal(thresholdFor("Procedural"), 0.5, "unknown kinds fall back to majority");
assert.equal(thresholdFor("Special"), 2 / 3, "special resolution needs 2/3");
assert.equal(thresholdFor("Unanimous"), 1, "unanimous needs everyone");

// ---------------------------------------------------------------------------
// motionMeetsThreshold — abstentions excluded from "votes cast"
// ---------------------------------------------------------------------------
assert.equal(
  motionMeetsThreshold({ votesFor: 0, votesAgainst: 0, abstentions: 5 } as any),
  null,
  "no votes cast → null (not a fail)",
);
assert.equal(
  motionMeetsThreshold({ votesFor: 3, votesAgainst: 2 }),
  true,
  "ordinary majority: 3 of 5 cast passes",
);
assert.equal(
  motionMeetsThreshold({ votesFor: 2, votesAgainst: 3 }),
  false,
  "ordinary majority: 2 of 5 cast fails",
);
assert.equal(
  motionMeetsThreshold({ votesFor: 5, votesAgainst: 5 }),
  false,
  "an exact tie does not carry an ordinary motion (needs > 50%)",
);
// Abstentions must NOT count against the threshold.
assert.equal(
  motionMeetsThreshold({ votesFor: 3, votesAgainst: 2, abstentions: 10 } as any),
  true,
  "abstentions are excluded from votes cast",
);
// Special resolution (2/3).
assert.equal(
  motionMeetsThreshold({ votesFor: 2, votesAgainst: 1, resolutionType: "Special" }),
  true,
  "special: 2 of 3 cast meets exactly 2/3",
);
assert.equal(
  motionMeetsThreshold({ votesFor: 3, votesAgainst: 2, resolutionType: "Special" }),
  false,
  "special: 3 of 5 (60%) does not reach 2/3",
);
// Unanimous.
assert.equal(
  motionMeetsThreshold({ votesFor: 4, votesAgainst: 0, resolutionType: "Unanimous" }),
  true,
  "unanimous: no opposition passes",
);
assert.equal(
  motionMeetsThreshold({ votesFor: 4, votesAgainst: 1, resolutionType: "Unanimous" }),
  false,
  "unanimous: any opposition fails",
);

// ---------------------------------------------------------------------------
// isAdjournmentMotion — heuristic across text / section / resolution type
// ---------------------------------------------------------------------------
assert.equal(isAdjournmentMotion({ text: "Adjourn the meeting" }), true);
assert.equal(isAdjournmentMotion({ text: "Motion to adjourn" }), true);
assert.equal(isAdjournmentMotion({ text: "The meeting was adjourned" }), true);
assert.equal(isAdjournmentMotion({ sectionTitle: "Adjournment" }), true);
assert.equal(isAdjournmentMotion({ text: "Approve the budget" }), false);
assert.equal(
  isAdjournmentMotion({ text: "Discuss journal subscriptions" }),
  false,
  "word boundary: 'journal' must not match 'adjourn'",
);

// ---------------------------------------------------------------------------
// Outcome vocabulary helpers
// ---------------------------------------------------------------------------
assert.deepEqual(
  MOTION_OUTCOMES.map((meta) => meta.id),
  ["Pending", "Carried", "Defeated", "Tabled", "Deferred"],
  "canonical outcome order",
);
assert.equal(isPostponedOutcome("Tabled"), true);
assert.equal(isPostponedOutcome("Deferred"), true);
assert.equal(isPostponedOutcome("deferred"), true, "case-insensitive for legacy data");
assert.equal(isPostponedOutcome("Carried"), false);
assert.equal(isPostponedOutcome(undefined), false);
assert.equal(normalizeMotionOutcome("carried"), "Carried", "legacy lowercase normalized");
assert.equal(normalizeMotionOutcome(""), "Pending", "empty defaults to Pending");
assert.equal(normalizeMotionOutcome("Withdrawn"), "Withdrawn", "unknown values pass through");

// ---------------------------------------------------------------------------
// redactText — public-copy redaction for minutes export. Emails / phones /
// postal codes / IDs / addresses are always scanned; names are opt-in.
// ---------------------------------------------------------------------------
const email = redactText("Contact jane@example.org for details");
assert.ok(!email.includes("jane@example.org"), "emails are redacted");
const phone = redactText("Call 250-555-0199 today");
assert.ok(!phone.includes("250-555-0199"), "phone numbers are redacted");
const named = redactText("Director Jordan Nakamura abstained", { names: ["Jordan Nakamura"] });
assert.ok(!named.includes("Jordan Nakamura"), "supplied names are redacted");
assert.ok(named.includes("[redacted]"), "default placeholder is used");
const typed = redactText("Email jane@example.org", { typeLabels: true });
assert.ok(typed.includes("[email]"), "typeLabels renders a typed placeholder");
const untouched = redactText("Nothing sensitive here");
assert.equal(untouched, "Nothing sensitive here", "clean text is returned unchanged");

console.log(
  "Checked meeting governance logic: thresholds, vote tallies, adjournment heuristic, outcome vocabulary, and minutes redaction.",
);
