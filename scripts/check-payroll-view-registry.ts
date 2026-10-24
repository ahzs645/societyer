import assert from "node:assert/strict";
import {
  PAYROLL_VIEWS,
  PAYROLL_VIEW_IDS,
  cleanPayrollViewPreferences,
  payrollView,
  payrollViewPreferenceKey,
  visiblePayrollViews,
} from "../src/features/payrollCalculation/payrollViewRegistry";
import {
  blankTd1Review,
  parsedTd1Review,
  reviewedTd1Form,
} from "../src/features/payrollCalculation/td1ReviewFields";
import type { PayrollTd1ParseResult } from "../shared/payrollTd1";

const legacy = [
  "calculate",
  "profiles",
  "work",
  "leave",
  "openings",
  "employer",
  "codes",
  "records",
  "tools",
  "filings",
];
assert.equal(new Set(PAYROLL_VIEW_IDS).size, PAYROLL_VIEWS.length);
for (const id of legacy)
  assert.equal(payrollView(id).id, id, `existing deep link ${id}`);
for (const id of ["td1", "rules", "roe", "remittances"])
  assert.equal(payrollView(id).id, id);
assert.equal(
  payrollView("https://untrusted.invalid/module.js").id,
  "calculate",
);
const hostile = cleanPayrollViewPreferences({
  order: ["tools", "tools", "external", "calculate", "profiles"],
  hidden: ["calculate", "profiles", "external"],
  favorites: ["td1", "td1", "external"],
  expanded: { calculate: false, td1: "false", external: true },
  renderer: "https://untrusted.invalid/module.js",
});
assert.equal(hostile.order[0], "calculate");
assert.deepEqual(new Set(hostile.order), new Set(PAYROLL_VIEW_IDS));
assert.deepEqual(hostile.hidden, ["profiles"]);
assert.deepEqual(hostile.favorites, ["td1"]);
assert.equal(hostile.expanded.calculate, false);
assert.equal(hostile.expanded.td1, true);
assert.ok(!JSON.stringify(hostile).includes("external"));
assert.deepEqual(
  visiblePayrollViews(hostile, () => false).map((v) => v.id),
  [],
);
const finance = visiblePayrollViews(
  hostile,
  (p) => p === "financials:read",
).map((v) => v.id);
assert.ok(finance.includes("tools") && finance.includes("rules"));
assert.ok(!finance.includes("td1") && !finance.includes("records"));
const all = visiblePayrollViews(hostile, () => true).map((v) => v.id);
assert.deepEqual(all.slice(0, 2), ["calculate", "td1"]);
assert.ok(!all.includes("profiles"));
assert.notEqual(
  payrollViewPreferenceKey("a:b", "c"),
  payrollViewPreferenceKey("a", "b:c"),
);
assert.notEqual(
  payrollViewPreferenceKey("org", "one"),
  payrollViewPreferenceKey("org", "two"),
);
assert.notEqual(
  payrollViewPreferenceKey("one", "user"),
  payrollViewPreferenceKey("two", "user"),
);
assert.deepEqual(
  cleanPayrollViewPreferences(null),
  cleanPayrollViewPreferences({}),
);

function manual(form: "federal" | "BC") {
  return {
    ...blankTd1Review(form),
    mode: "manual" as const,
    claim: "20,000.00",
    multiple: "no" as const,
    below: "no" as const,
    additional: "25.50",
    zone: "0.00",
    sourcePages: "2",
    signed: true,
    fieldsReviewed: true,
    resident: true,
    reference: "Reviewed paper declaration held in restricted employee records",
  };
}
const federal = reviewedTd1Form(manual("federal"), 2026);
assert.equal(federal.totalClaimCents, 2_000_000);
assert.equal(federal.additionalTaxCents, 2550);
assert.deepEqual(federal.source, {
  method: "manual",
  mediaType: "text/plain",
  pageCount: 2,
});
assert.equal(
  "sha256" in federal.source,
  false,
  "manual review does not invent a document digest",
);
const bc = reviewedTd1Form(
  { ...manual("BC"), claim: "0", multiple: "yes" },
  2026,
);
assert.equal(bc.multipleEmployers, true);
assert.equal(
  federal.multipleEmployers,
  false,
  "jurisdictions stay independent",
);
assert.equal("additionalTaxCents" in bc, false);
assert.equal("annualZoneDeductionCents" in bc, false);
for (const change of [
  { signed: false },
  { fieldsReviewed: false },
  { resident: false },
  { multiple: "unknown" as const },
  { below: "unknown" as const },
  { sourcePages: "0" },
  { sourcePages: "" },
  { claim: "1.001" },
  { claim: "-1" },
  { multiple: "yes" as const },
  { reference: "" },
]) {
  assert.throws(() =>
    reviewedTd1Form({ ...manual("federal"), ...change }, 2026),
  );
}
assert.throws(
  () => reviewedTd1Form({ ...manual("BC"), claim: "0", below: "yes" }, 2026),
  /contradictory/,
);
assert.throws(
  () => reviewedTd1Form({ ...manual("BC"), sourceYear: "2025" }, 2026),
  /prior-year/,
);
const carried = reviewedTd1Form(
  {
    ...manual("BC"),
    sourceYear: "2025",
    priorYearReviewed: true,
    priorYearReference:
      "Unchanged circumstances and indexed 2026 amount reviewed",
  },
  2026,
);
assert.equal(carried.sourceFormYear, 2025);
assert.equal(carried.year, 2026);
assert.equal(carried.priorYearReviewed, true);
const field = <T extends number | boolean>(value: T | null) => ({
  value,
  confidence: "high" as const,
  evidence: [],
  needsReview: true,
});
const parsed: PayrollTd1ParseResult = {
  schemaVersion: 1,
  expectedForm: "federal",
  expectedYear: 2026,
  form: "federal",
  year: 2026,
  source: {
    sha256: "a".repeat(64),
    mediaType: "application/pdf",
    pageCount: 2,
    method: "acroform",
    originalStored: false,
  },
  fields: {
    totalClaimCents: field(2_000_000),
    multipleEmployers: field<boolean>(null),
    totalIncomeLessThanClaims: field(false),
    additionalTaxCents: field(2550),
    annualZoneDeductionCents: field<number>(null),
    nonResident90Percent: field<boolean>(null),
  },
  claimLines: [],
  status: "review_required",
  requiresManualReview: true,
  signatureVerified: false,
  requiredReviewFields: [],
  blockers: [],
  warnings: [],
  sources: [],
};
const draft = parsedTd1Review(parsed);
assert.equal(draft.claim, "20000.00");
assert.equal(draft.multiple, "unknown");
assert.equal(draft.zone, "");
assert.equal(draft.signed, false);
assert.equal(draft.fieldsReviewed, false);
assert.equal(draft.resident, false);
assert.throws(() => reviewedTd1Form(draft, 2026));
const reviewed = reviewedTd1Form(
  {
    ...draft,
    multiple: "no",
    zone: "0",
    signed: true,
    fieldsReviewed: true,
    resident: true,
    reference: "Local upload reviewed against signed and dated original",
  },
  2026,
);
assert.equal(reviewed.source.sha256, "a".repeat(64));
assert.equal("evidence" in reviewed, false);
assert.equal("rawText" in reviewed, false);
assert.throws(
  () =>
    reviewedTd1Form(
      {
        ...draft,
        parsed: { ...parsed, status: "blocked" },
        signed: true,
        fieldsReviewed: true,
        resident: true,
      },
      2026,
    ),
  /supported form/,
);
console.log("Payroll view registry and TD1 review boundary checks passed.");
