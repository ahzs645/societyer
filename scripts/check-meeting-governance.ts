import assert from "node:assert/strict";
import {
  thresholdFor,
  motionMeetsThreshold,
  bylawRulesToThresholds,
  STATUTORY_RESOLUTION_THRESHOLDS,
  resolveResolutionTypes,
  customResolutionTypes,
  findResolutionType,
  motionCarriesByType,
  motionCarriesForRules,
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
// Configured (per-society) thresholds — bylawRulesToThresholds + overrides
// ---------------------------------------------------------------------------
// No rule set → statutory baselines.
assert.deepEqual(
  bylawRulesToThresholds(undefined),
  STATUTORY_RESOLUTION_THRESHOLDS,
  "missing rules fall back to statutory thresholds",
);
// The stored 66.67 is snapped to an exact two-thirds so a 2-of-3 vote passes.
assert.equal(
  bylawRulesToThresholds({ specialResolutionThresholdPct: 66.67 }).special,
  2 / 3,
  "rounded 66.67 snaps back to exact two-thirds",
);
assert.equal(
  motionMeetsThreshold(
    { votesFor: 2, votesAgainst: 1, resolutionType: "Special" },
    bylawRulesToThresholds({ specialResolutionThresholdPct: 66.67 }),
  ),
  true,
  "configured special (66.67) still carries an exact two-thirds vote",
);
// A society can raise the ordinary bar above a simple majority. Any threshold
// other than an exact 50% is treated as "at least N%" (met exactly carries),
// matching how the statutory super-majorities behave.
const strictOrdinary = bylawRulesToThresholds({ ordinaryResolutionThresholdPct: 60 });
assert.equal(thresholdFor("Ordinary", strictOrdinary), 0.6, "configured ordinary = 60%");
assert.equal(
  motionMeetsThreshold({ votesFor: 3, votesAgainst: 2 }, strictOrdinary),
  true,
  "3 of 5 (60%) meets a configured 60% ordinary threshold exactly",
);
assert.equal(
  motionMeetsThreshold({ votesFor: 5, votesAgainst: 4 }, strictOrdinary),
  false,
  "5 of 9 (~56%) falls short of a configured 60% ordinary threshold",
);

// ---------------------------------------------------------------------------
// Resolution-type catalogue — built-ins derived, custom types stored
// ---------------------------------------------------------------------------
// With no rule set, the three statutory built-ins are derived.
const defaultTypes = resolveResolutionTypes(undefined);
assert.deepEqual(
  defaultTypes.map((t) => t.id),
  ["ordinary", "special", "unanimous"],
  "built-ins are derived when no rule set exists",
);
assert.ok(defaultTypes.every((t) => t.builtIn), "derived types are flagged builtIn");
assert.equal(
  defaultTypes.find((t) => t.id === "special")?.thresholdPct,
  66.67,
  "special built-in shows the rounded two-thirds percentage",
);
// Built-in thresholds track the bylaw percentages (not a separate source).
const raisedOrdinary = resolveResolutionTypes({ ordinaryResolutionThresholdPct: 60 });
assert.equal(
  raisedOrdinary.find((t) => t.id === "ordinary")?.thresholdPct,
  60,
  "ordinary built-in reflects a raised bylaw threshold",
);
// Custom types are appended after the built-ins and filtered from the stored list.
const withCustom = {
  ordinaryResolutionThresholdPct: 50,
  specialResolutionThresholdPct: 66.67,
  resolutionTypes: [
    { id: "founder", label: "Founder veto", base: "votesCast" as const, thresholdPct: 75, order: 1 },
  ],
};
assert.equal(customResolutionTypes(withCustom).length, 1, "custom types are read back");
assert.deepEqual(
  resolveResolutionTypes(withCustom).map((t) => t.label),
  ["Ordinary", "Special", "Unanimous", "Founder veto"],
  "catalogue = built-ins then custom",
);

// findResolutionType resolves by id and by legacy label.
const cat = resolveResolutionTypes(undefined);
assert.equal(findResolutionType(cat, "special")?.id, "special", "resolves by id");
assert.equal(findResolutionType(cat, "Special")?.id, "special", "resolves by legacy label");
assert.equal(findResolutionType(cat, "nonsense")?.id, "ordinary", "unknown falls back to ordinary");

// motionCarriesByType — votes-cast base, with the two-thirds snap preserved.
const specialType = findResolutionType(cat, "special");
assert.equal(
  motionCarriesByType({ votesFor: 2, votesAgainst: 1 }, specialType),
  true,
  "2 of 3 carries a derived (66.67) special type — snap preserved",
);
const founderType = findResolutionType(resolveResolutionTypes(withCustom), "Founder veto");
assert.equal(
  motionCarriesByType({ votesFor: 3, votesAgainst: 1 }, founderType),
  true,
  "3 of 4 (75%) meets a custom 75% threshold exactly",
);
assert.equal(
  motionCarriesByType({ votesFor: 2, votesAgainst: 1 }, founderType),
  false,
  "2 of 3 (~67%) falls short of a custom 75% threshold",
);

// motionCarriesForRules — end-to-end from a motion's stored resolutionType.
assert.equal(
  motionCarriesForRules({ votesFor: 3, votesAgainst: 1, resolutionType: "Founder veto" }, withCustom),
  true,
  "a motion tagged with a custom type is evaluated against that type",
);
// A motion adopted by general consent / automatic close carries by definition —
// there is no tally to weigh, so the threshold check returns null (no judgement),
// not a fail. This is the adjournment / approve-previous-minutes case.
assert.equal(
  motionCarriesForRules({ decidedBy: "consent", text: "Adjourn the meeting" }, withCustom),
  null,
  "consent-adopted motions have no tally to judge",
);
assert.equal(
  motionCarriesForRules({ decidedBy: "automatic", text: "Adjourn the meeting" }, withCustom),
  null,
  "automatic close has no tally to judge",
);
// But a procedural motion that IS put to an actual ballot is judged by a simple
// majority (RONR) rather than being exempted from the math — a 5–5 tie loses.
assert.equal(
  motionCarriesForRules({ votesFor: 5, votesAgainst: 5, resolutionType: "Procedural" }, withCustom),
  false,
  "a contested procedural motion is judged by majority — a tie does not carry",
);
assert.equal(
  motionCarriesForRules({ votesFor: 6, votesAgainst: 5, resolutionType: "Procedural" }, withCustom),
  true,
  "a procedural motion with a majority in favour carries",
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
