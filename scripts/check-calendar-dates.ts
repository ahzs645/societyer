import assert from "node:assert/strict";
import { calendarDate, calendarDateKey, calendarWeekDays } from "../src/lib/calendarDates";

for (const timezone of ["America/Vancouver", "America/Toronto", "UTC"]) {
  process.env.TZ = timezone;
  assert.equal(calendarDateKey(calendarDate("2026-03-08")!), "2026-03-08");
  assert.equal(calendarDateKey(calendarDate("2026-03-09T04:30:00Z")!), timezone === "America/Vancouver" ? "2026-03-08" : "2026-03-09");
  assert.equal(calendarDate("2026-02-30"), null);
  assert.equal(calendarDate("invalid"), null);
  const days = calendarWeekDays(calendarDate("2026-03-08")!);
  assert.deepEqual(days.map(calendarDateKey), ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"]);
  assert.equal(calendarWeekDays(calendarDate("2026-03-09")!)[0].getDay(), 1);
  assert.deepEqual(calendarWeekDays(calendarDate("2026-11-01")!).map(calendarDateKey), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
}
console.log("PASS: date-only, offset timestamps and DST week boundaries in Vancouver, Toronto and UTC");
