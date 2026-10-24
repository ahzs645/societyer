import assert from "node:assert/strict";
import {
  parseVacationHours,
  vacationHoursInput,
  vacationHoursLabel,
  vacationTimeCsv,
} from "../src/features/payrollCalculation/payrollLeaveUi";
for (const [value, expected] of [
  ["7:30", 450],
  ["37.5", 2250],
  ["1:20", 80],
  ["0:01", 1],
  ["1.05", 63],
  ["0", 0],
  ["0.1", 6],
] as const)
  assert.equal(parseVacationHours(value, "Leave"), expected);
for (const value of [
  "1.333333",
  "1:60",
  "-1",
  "0.001",
  "1.5e2",
  "",
  "Infinity",
  "900719925474099100:00",
])
  assert.throws(() => parseVacationHours(value, "Leave"));
for (const minutes of [0, 1, 60, 450, 2250, 10080])
  assert.equal(
    parseVacationHours(vacationHoursInput(minutes), "Roundtrip"),
    minutes,
  );
assert.equal(vacationHoursLabel(-61), "−1 h 1 min");
assert.equal(vacationHoursLabel(Number.NaN), "Unknown");
const csv = vacationTimeCsv([
  ["Employee", "Minutes"],
  ["  =SUM(1,2)", 450],
  ["@LINK", -30],
  ['Comma, quote"', 0],
]);
assert.ok(csv.includes('"\'  =SUM(1,2)"'));
assert.ok(csv.includes('"\'@LINK","-30"'));
assert.ok(csv.includes('"Comma, quote""","0"'));
console.log(
  "Vacation UI value checks passed: exact minute conversion, no silent fractional-minute rounding, signed balances and safe CSV.",
);
