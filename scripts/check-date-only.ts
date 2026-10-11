/**
 * Gate for shared/dateOnly.ts: date-only due dates are compared in the local
 * calendar, never as UTC midnight (ui-governance G-08).
 * Run: TZ=America/Vancouver tsx scripts/check-date-only.ts (the script also
 * switches through other zones itself).
 */
import assert from "node:assert/strict";
import {
  addDaysToDateOnly,
  compareDateOnly,
  daysUntilDate,
  isDateOnly,
  isPastDue,
  parseDateOnly,
  relativeDateOnly,
  toDateOnly,
  todayDateOnly,
} from "../shared/dateOnly";
import { relative } from "../src/lib/format";

assert.equal(process.env.TZ ?? "America/Vancouver", "America/Vancouver", "Run this gate with TZ=America/Vancouver");

// 8 PM in Vancouver on Oct 6 is already Oct 7 in UTC.
process.env.TZ = "America/Vancouver";
{
  const now = new Date("2026-10-07T03:00:00Z");
  assert.equal(now.toISOString().slice(0, 10), "2026-10-07", "fixture: UTC day is already tomorrow");
  assert.equal(todayDateOnly(now), "2026-10-06");
  assert.equal(isPastDue("2026-10-07", now), false, "due tomorrow is not overdue");
  assert.equal(isPastDue("2026-10-06", now), false, "due today is not overdue");
  assert.equal(isPastDue("2026-10-05", now), true, "due yesterday is overdue");
  assert.equal(daysUntilDate("2026-10-07", now), 1);
  assert.equal(daysUntilDate("2026-10-06", now), 0);
  assert.equal(relativeDateOnly("2026-10-06", now), "today");
  assert.equal(relativeDateOnly("2026-10-07", now), "tomorrow");
  assert.equal(relativeDateOnly("2026-10-05", now), "yesterday");
  assert.equal(relativeDateOnly("2026-10-09", now), "in 3 days");
  assert.equal(relativeDateOnly("2026-09-22", now), "2 weeks ago");
  assert.equal(relativeDateOnly("2027-04-06", now), "in 6 months");
  // A timestamp is placed on the local day of its instant.
  assert.equal(toDateOnly("2026-10-07T03:00:00Z"), "2026-10-06");
  assert.equal(toDateOnly("2026-10-07"), "2026-10-07", "date-only strings never shift");
  // Timestamps compare as instants.
  assert.equal(isPastDue("2026-10-07T02:59:00Z", now), true);
  assert.equal(isPastDue("2026-10-07T03:01:00Z", now), false);
  // DST ends Nov 1 2026 (25-hour day) and starts Mar 8 2026 (23-hour day).
  assert.equal(daysUntilDate("2026-11-02", new Date("2026-10-31T19:00:00Z")), 2);
  assert.equal(daysUntilDate("2026-03-09", new Date("2026-03-07T20:00:00Z")), 2);
  assert.equal(addDaysToDateOnly("2026-03-07", 1), "2026-03-08");
  assert.equal(addDaysToDateOnly("2026-03-08", 1), "2026-03-09");
  assert.equal(addDaysToDateOnly("2026-11-01", -14), "2026-10-18");
  assert.equal(addDaysToDateOnly("2026-01-01", -1), "2025-12-31");
  // The app's relative() helper uses calendar wording for date-only values.
  const realNow = Date.now;
  Date.now = () => now.getTime();
  try {
    const realDate = globalThis.Date;
    class FixedDate extends realDate {
      constructor(...args: any[]) {
        if (args.length === 0) super(now.getTime());
        else super(...(args as [any]));
      }
      static now() { return now.getTime(); }
    }
    globalThis.Date = FixedDate as DateConstructor;
    try {
      assert.equal(relative("2026-10-06"), "today", "no more 'Overdue 19 hours ago' for something due today");
      assert.equal(relative("2026-10-07"), "tomorrow");
      assert.equal(relative(new Date(now.getTime() - 5_000).toISOString()), "just now");
    } finally {
      globalThis.Date = realDate;
    }
  } finally {
    Date.now = realNow;
  }
}

// East of UTC the local day runs ahead of UTC.
process.env.TZ = "Pacific/Auckland";
{
  const now = new Date("2026-10-06T19:00:00Z"); // 08:00 Oct 7 in Auckland
  assert.equal(todayDateOnly(now), "2026-10-07");
  assert.equal(isPastDue("2026-10-06", now), true);
  assert.equal(isPastDue("2026-10-07", now), false);
  assert.equal(addDaysToDateOnly("2026-04-05", 1), "2026-04-06", "NZ DST end");
}

process.env.TZ = "UTC";
{
  const now = new Date("2026-10-06T23:59:59Z");
  assert.equal(todayDateOnly(now), "2026-10-06");
  assert.equal(isPastDue("2026-10-06", now), false);
  assert.equal(isPastDue("2026-10-05", now), true);
}

// Validation and ordering are zone independent.
for (const zone of ["America/Vancouver", "Asia/Kolkata", "UTC"]) {
  process.env.TZ = zone;
  assert.equal(isDateOnly("2026-10-06"), true);
  assert.equal(isDateOnly("2026-10-06T00:00:00Z"), false);
  assert.equal(parseDateOnly("2026-02-30"), null);
  assert.equal(parseDateOnly("2026-13-01"), null);
  assert.equal(parseDateOnly("2026-10-06")!.getDate(), 6);
  assert.equal(isPastDue(undefined), false);
  assert.equal(isPastDue("not a date"), false);
  assert.equal(daysUntilDate("garbage"), null);
  assert.equal(compareDateOnly("2026-10-06", "2026-10-07"), -1);
  assert.equal(compareDateOnly("2026-10-07", "2026-10-07"), 0);
}

process.env.TZ = "America/Vancouver";
console.log("PASS: date-only due dates, relative wording and DST arithmetic in Vancouver, Auckland, Kolkata and UTC");
