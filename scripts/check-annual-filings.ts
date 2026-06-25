import assert from "node:assert/strict";
import {
  filingFor,
  filingHistory,
  isFiledFor,
  jurisdictionsTracked,
  outstandingYears,
  type FilingRecord,
} from "../shared/annualFilings.ts";

const records: FilingRecord[] = [
  { jurisdiction: "BC", year: "2021", filed: true, filedOn: "2021-03-01" },
  { jurisdiction: "BC", year: "2023", filed: true, filedOn: "2023-03-15" },
  { jurisdiction: "BC", year: "2022", filed: false, filedOn: null },
  { jurisdiction: "Federal", year: "2022", filed: true, filedOn: "2022-06-01" },
  { jurisdiction: "Federal", year: "2023", filed: false },
];

// filingFor lookups.
assert.deepEqual(filingFor(records, "BC", "2021"), {
  jurisdiction: "BC",
  year: "2021",
  filed: true,
  filedOn: "2021-03-01",
});
assert.equal(filingFor(records, "BC", "2022")?.filed, false);
assert.equal(filingFor(records, "BC", "2099"), null);
assert.equal(filingFor(records, "Nowhere", "2021"), null);

// isFiledFor lookups.
assert.equal(isFiledFor(records, "BC", "2021"), true);
assert.equal(isFiledFor(records, "BC", "2022"), false);
assert.equal(isFiledFor(records, "BC", "2099"), false);
assert.equal(isFiledFor(records, "Federal", "2022"), true);
assert.equal(isFiledFor(records, "Federal", "2023"), false);

// filingFor prefers a filed record when both exist.
const mixed: FilingRecord[] = [
  { jurisdiction: "BC", year: "2024", filed: false },
  { jurisdiction: "BC", year: "2024", filed: true, filedOn: "2024-02-02" },
];
assert.equal(filingFor(mixed, "BC", "2024")?.filed, true);
assert.equal(isFiledFor(mixed, "BC", "2024"), true);

// outstandingYears computes missing years across a range.
assert.deepEqual(outstandingYears(records, "BC", "2021", "2024"), ["2022", "2024"]);
assert.deepEqual(outstandingYears(records, "BC", "2021", "2021"), []);
assert.deepEqual(outstandingYears(records, "Federal", "2021", "2023"), ["2021", "2023"]);
// Inverted range yields nothing.
assert.deepEqual(outstandingYears(records, "BC", "2024", "2021"), []);

// filingHistory: that jurisdiction only, sorted ascending by year.
const bcHistory = filingHistory(records, "BC");
assert.deepEqual(
  bcHistory.map((record) => record.year),
  ["2021", "2022", "2023"],
);
assert.ok(bcHistory.every((record) => record.jurisdiction === "BC"));
assert.deepEqual(filingHistory(records, "Nowhere"), []);

// jurisdictionsTracked: distinct, first-seen order.
assert.deepEqual(jurisdictionsTracked(records), ["BC", "Federal"]);
assert.deepEqual(jurisdictionsTracked([]), []);

console.log("OK annual-filings");
