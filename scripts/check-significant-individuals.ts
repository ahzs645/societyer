import assert from "node:assert/strict";

import {
  SIGNIFICANT_INDIVIDUAL_FIELDS,
  currentSignificantIndividuals,
  deriveSignificanceStatus,
  reviewsDue,
  validateSignificantIndividual,
  type SignificanceStep,
  type SignificantIndividual,
} from "../shared/significantIndividuals";

// --- status: current / former / upcoming across asOf dates ---
const ada: SignificantIndividual = {
  name: "Ada Controller",
  becameSignificantOn: "2021-01-01",
  ceasedSignificantOn: "2023-06-30",
  reason: "Holds 30% of voting shares",
};
const ben: SignificantIndividual = {
  name: "Ben Controller",
  becameSignificantOn: "2024-01-01",
  ceasedSignificantOn: null,
  reason: "Right to appoint a majority of directors",
};

// Before Ada became significant: upcoming.
assert.equal(deriveSignificanceStatus(ada, "2020-06-01"), "upcoming");
// At the exact instant she became significant: current.
assert.equal(deriveSignificanceStatus(ada, "2021-01-01"), "current");
// In the window: current.
assert.equal(deriveSignificanceStatus(ada, "2022-06-01"), "current");
// At the cease instant: former.
assert.equal(deriveSignificanceStatus(ada, "2023-06-30"), "former");
// After cease: former.
assert.equal(deriveSignificanceStatus(ada, "2025-01-01"), "former");

// Ben has no cease date: upcoming then current forever after.
assert.equal(deriveSignificanceStatus(ben, "2023-01-01"), "upcoming");
assert.equal(deriveSignificanceStatus(ben, "2024-01-01"), "current");
assert.equal(deriveSignificanceStatus(ben, "2030-01-01"), "current");

// currentSignificantIndividuals filters by asOf.
const roster = [ada, ben];
assert.deepEqual(
  currentSignificantIndividuals(roster, "2022-06-01").map((si) => si.name),
  ["Ada Controller"],
  "only Ada current mid-2022",
);
assert.deepEqual(
  currentSignificantIndividuals(roster, "2025-01-01").map((si) => si.name),
  ["Ben Controller"],
  "only Ben current 2025 (Ada ceased)",
);
assert.deepEqual(
  currentSignificantIndividuals(roster, "2020-01-01").map((si) => si.name),
  [],
  "neither current before either began",
);

// --- validate: catches missing name / reason and reversed dates ---
const ok = validateSignificantIndividual(ben);
assert.equal(ok.ok, true);
assert.deepEqual(ok.errors, []);

const missingName = validateSignificantIndividual({
  name: "   ",
  becameSignificantOn: "2021-01-01",
  reason: "control",
});
assert.equal(missingName.ok, false);
assert.ok(missingName.errors.some((e) => e.includes("name")), "flags missing name");

const missingReason = validateSignificantIndividual({
  name: "Cara",
  becameSignificantOn: "2021-01-01",
  reason: "",
});
assert.equal(missingReason.ok, false);
assert.ok(missingReason.errors.some((e) => e.includes("reason")), "flags missing reason");

const reversed = validateSignificantIndividual({
  name: "Dee",
  becameSignificantOn: "2023-01-01",
  ceasedSignificantOn: "2022-01-01",
  reason: "control",
});
assert.equal(reversed.ok, false);
assert.ok(
  reversed.errors.some((e) => e.includes("before")),
  "flags ceased before became",
);

const badBecame = validateSignificantIndividual({
  name: "Eve",
  becameSignificantOn: "not-a-date",
  reason: "control",
});
assert.equal(badBecame.ok, false);
assert.ok(badBecame.errors.some((e) => e.includes("ISO")), "flags non-ISO becameSignificantOn");

// equal cease/became dates are allowed (not before).
const sameDay = validateSignificantIndividual({
  name: "Fay",
  becameSignificantOn: "2023-01-01",
  ceasedSignificantOn: "2023-01-01",
  reason: "control",
});
assert.equal(sameDay.ok, true, "same-day cease is valid");

// --- reviewsDue: filters by nextReviewDate ---
const steps: SignificanceStep[] = [
  {
    individualName: "Ada Controller",
    stepsNarrative: "Reviewed share register and confirmed holding.",
    stepDate: "2024-01-15",
    nextReviewDate: "2025-01-15",
  },
  {
    individualName: "Ben Controller",
    stepsNarrative: "Confirmed appointment rights in shareholders agreement.",
    stepDate: "2024-02-01",
    nextReviewDate: "2027-02-01",
  },
  {
    individualName: "Cara Watcher",
    stepsNarrative: "One-off identification; no recurring review scheduled.",
    stepDate: "2024-03-01",
  },
];

const due = reviewsDue(steps, "2026-06-25");
assert.deepEqual(
  due.map((s) => s.individualName),
  ["Ada Controller"],
  "only Ada's review is due (Ben future, Cara none)",
);
assert.deepEqual(reviewsDue(steps, "2024-12-01").map((s) => s.individualName), [], "none due before any review date");

// --- SIGNIFICANT_INDIVIDUAL_FIELDS metadata ---
const fieldKeys = SIGNIFICANT_INDIVIDUAL_FIELDS.map((f) => f.key);
for (const key of [
  "name",
  "address",
  "dateOfBirth",
  "citizenship",
  "taxResidentHomeJurisdiction",
  "becameSignificantOn",
  "ceasedSignificantOn",
  "reason",
]) {
  assert.ok(fieldKeys.includes(key), `fields include ${key}`);
}

const reasonField = SIGNIFICANT_INDIVIDUAL_FIELDS.find((f) => f.key === "reason");
assert.ok(reasonField && reasonField.required, "reason is a required field");
const taxField = SIGNIFICANT_INDIVIDUAL_FIELDS.find(
  (f) => f.key === "taxResidentHomeJurisdiction",
);
assert.ok(taxField && taxField.required, "taxResidentHomeJurisdiction is a required field");

// Every field carries a non-empty label and help string.
for (const f of SIGNIFICANT_INDIVIDUAL_FIELDS) {
  assert.ok(f.label.length > 0, `${f.key} has a label`);
  assert.ok(f.help.length > 0, `${f.key} has help text`);
}

console.log("OK significant-individuals");
