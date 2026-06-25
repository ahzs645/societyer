import assert from "node:assert/strict";
import {
  activeAsOf,
  activeNow,
  roleHoldersAsOf,
  tenureSpanDays,
  type IntervalRow,
} from "../shared/registerHistory.ts";

type Holder = IntervalRow & { roleType: string; fullName: string };

const closedDirector: Holder = {
  roleType: "director",
  fullName: "Ada Closed",
  startDate: "2020-03-01",
  endDate: "2023-06-15",
};

const openDirector: Holder = {
  roleType: "director",
  fullName: "Olu Open",
  startDate: "2021-09-01",
  endDate: null,
};

const controller: Holder = {
  roleType: "controller",
  fullName: "Cy Controller",
  startDate: "2019-01-01",
  endDate: undefined,
};

const rows: Holder[] = [closedDirector, openDirector, controller];

function has(result: Holder[], name: string): boolean {
  return result.some((r) => r.fullName === name);
}

// Closed director: present asOf within the interval.
assert.ok(has(activeAsOf(rows, "2021-01-01"), "Ada Closed"));
// Absent after the end.
assert.ok(!has(activeAsOf(rows, "2024-01-01"), "Ada Closed"));
// Absent before the start.
assert.ok(!has(activeAsOf(rows, "2019-01-01"), "Ada Closed"));
// Present at the exact start.
assert.ok(has(activeAsOf(rows, "2020-03-01"), "Ada Closed"));
// Absent at the exact end (end is exclusive).
assert.ok(!has(activeAsOf(rows, "2023-06-15"), "Ada Closed"));

// Open-ended director: present at any asOf >= start.
assert.ok(has(activeAsOf(rows, "2021-09-01"), "Olu Open"));
assert.ok(has(activeAsOf(rows, "2030-01-01"), "Olu Open"));
// ...but not before start.
assert.ok(!has(activeAsOf(rows, "2021-08-31"), "Olu Open"));

// activeNow is just activeAsOf with an explicit now.
const nowResult = activeNow(rows, "2099-01-01");
assert.ok(has(nowResult, "Olu Open"));
assert.ok(has(nowResult, "Cy Controller"));
assert.ok(!has(nowResult, "Ada Closed"));

// roleHoldersAsOf filters by roleType.
const directorsNow = roleHoldersAsOf(rows, "2022-01-01", "director");
assert.deepEqual(
  directorsNow.map((r) => r.fullName).sort(),
  ["Ada Closed", "Olu Open"],
);
assert.ok(directorsNow.every((r) => r.roleType === "director"));

const controllersNow = roleHoldersAsOf(rows, "2022-01-01", "controller");
assert.deepEqual(controllersNow.map((r) => r.fullName), ["Cy Controller"]);

// A controller is not returned when asking for directors.
assert.ok(!has(roleHoldersAsOf(rows, "2022-01-01", "director"), "Cy Controller"));

// tenureSpanDays: positive whole day count for a closed interval.
const span = tenureSpanDays(closedDirector);
assert.ok(span !== null && span > 0);
// 2020-03-01 -> 2023-06-15 is 1201 days.
assert.equal(span, 1201);

// Open tenure (no endDate) => null.
assert.equal(tenureSpanDays(openDirector), null);
assert.equal(tenureSpanDays(controller), null);
// Missing startDate => null.
assert.equal(tenureSpanDays({ endDate: "2023-01-01" }), null);

// Custom field names via opts.
const custom: IntervalRow = { from: "2020-01-01", to: "2020-01-11" };
assert.deepEqual(activeAsOf([custom], "2020-01-05", { start: "from", end: "to" }), [custom]);
assert.deepEqual(activeAsOf([custom], "2020-02-01", { start: "from", end: "to" }), []);
assert.equal(tenureSpanDays(custom, { start: "from", end: "to" }), 10);

console.log("OK register-history");
