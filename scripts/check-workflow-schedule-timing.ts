import assert from "node:assert/strict";
import { nextScheduledRunAt, scheduledTriggerSupport } from "../shared/workflows/scheduleTiming";

const next = (cron: string, from: string) => nextScheduledRunAt({ kind: "cron", cron }, Date.parse(from));
assert.equal(next("0 8 * * 1", "2026-10-25T23:00:00.000Z"), "2026-10-26T08:00:00.000Z");
assert.equal(next("0 8 * * 1", "2026-10-26T08:00:00.000Z"), "2026-11-02T08:00:00.000Z");
assert.equal(next("0 8 * * 1", "2026-10-26T08:00:00.001Z"), "2026-11-02T08:00:00.000Z");
assert.equal(next("30 23 * * *", "2026-12-31T23:30:00Z"), "2027-01-01T23:30:00.000Z");
assert.equal(next("15 2 * * *", "2026-03-08T01:00:00Z"), "2026-03-08T02:15:00.000Z");
assert.equal(next("15 2 * * *", "2026-11-01T02:15:00Z"), "2026-11-02T02:15:00.000Z");
assert.equal(next("5,35 8-9 * * 1,3,5", "2026-10-26T08:36:00Z"), "2026-10-26T09:05:00.000Z");
assert.equal(next("*/15 8-17/3 * * 1-5", "2026-10-26T08:45:00Z"), "2026-10-26T11:00:00.000Z");
assert.equal(next("0 8 * * 7", "2026-10-24T23:59:59Z"), "2026-10-25T08:00:00.000Z");
assert.equal(next("0 8 * * 0,7", "2026-10-25T08:00:00Z"), "2026-11-01T08:00:00.000Z");
assert.equal(next("* * * * *", "2026-10-26T08:15:59.999Z"), "2026-10-26T08:16:00.000Z");
// A delayed scan advances from the actual claim time; it does not create one
// job for every missed minute or ignore the configured weekday.
assert.equal(next("0 8 * * 1", "2026-10-28T09:00:00Z"), "2026-11-02T08:00:00.000Z");

for (const cron of ["", "0 8 * *", "0 8 * * * extra", "60 8 * * 1", "0 24 * * 1", "0 8 * * 8", "0 8 * * MON", "0 8 * * 5-1", "*/0 8 * * 1", "0 8 * * ,1", "0 8 1 * *", "0 8 * 1 *", "0 8 * * 1.5", "0 8 * * 1e0", "0 8 * * ?"]) {
  assert.equal(scheduledTriggerSupport({ kind: "cron", cron }).supported, false, cron);
  assert.throws(() => next(cron, "2026-10-26T00:00:00Z"), undefined, cron);
}
for (const trigger of [null, undefined, { kind: "date_offset" }, { kind: "manual" }, { kind: "cron", cron: 42 }]) {
  assert.equal(scheduledTriggerSupport(trigger).supported, false);
}
assert.throws(() => nextScheduledRunAt({ kind: "cron", cron: "0 8 * * *" }, NaN));
assert.throws(() => nextScheduledRunAt({ kind: "cron", cron: "0 8 * * *" }, Number.MAX_VALUE));
console.log("Workflow timing: UTC recurrence, strict boundaries, delayed scans, lists/ranges/steps and invalid trigger guards pass.");
