import assert from "node:assert/strict";
import { legalSourceById } from "../shared/legalSources";
import { earliestPermittedNoticeDate, latestPermittedNoticeDate, NOTICE_CALENDAR_REVIEW_CAVEAT } from "../shared/legalMeetingNotice";
import { assessNoticeWindow, noticeWindowLabel, withinNominalNoticeWindow } from "../src/features/meetings/lib/noticeWindow";

// A Sunday boundary remains nominal. Moving it forward to Monday would
// shorten this BC clear-day notice period and must not happen implicitly.
const society = { noticeRequiresClearDays: true };
assert.equal(latestPermittedNoticeDate("2026-10-26", 7, true), "2026-10-18");
const sunday = assessNoticeWindow("2026-10-18", "2026-10-26", 7, 60, society);
assert.equal(sunday.position, "within_nominal_window");
assert.equal(sunday.calendarReviewStatus, "required");
assert.equal(sunday.legallyVerified, false);
assert.equal(sunday.tone, "info", "A nominal match must not become a green legal notice conclusion");
assert.equal(assessNoticeWindow("2026-10-19", "2026-10-26", 7, 60, society).position, "outside_nominal_window");

// Holiday review must not silently replace BC's two calendar months with a
// fixed day count or mutate the original backward month-end calculation.
const company = { noticeUsesCalendarMonthsMaximum: true };
assert.equal(earliestPermittedNoticeDate("2026-08-31", 62, 2), "2026-06-30");
assert.equal(withinNominalNoticeWindow("2026-06-30", "2026-08-31", 21, 62, company), true);
assert.equal(withinNominalNoticeWindow("2026-06-29", "2026-08-31", 21, 62, company), false);
const monthEnd = assessNoticeWindow("2026-06-30", "2026-08-31", 21, 62, company);
assert.equal(monthEnd.legallyVerified, false);
assert.equal(monthEnd.calendarReviewStatus, "required");
assert.match(noticeWindowLabel(21, 62, company), /nominal.*2 calendar months.*review required/);
assert.match(NOTICE_CALENDAR_REVIEW_CAVEAT, /may move earlier/);

for (const result of [
  assessNoticeWindow("bad-date", "2026-08-31", 21, 60),
  assessNoticeWindow("2026-08-01", "2026-08-31", 21, 60, { governanceAutomationBlocked: true }),
]) {
  assert.equal(result.position, "not_assessed");
  assert.equal(result.legallyVerified, false);
  assert.equal(result.tone, "warn");
}

// The review requirement points to current primary authorities, not a
// guessed calendar or an unrelated registry's weekend practice.
for (const id of ["BC-IA-TIME", "FED-IA-TIME", "ON-LEGISLATION-TIME", "OBCA-TIME"]) {
  const source = legalSourceById.get(id);
  assert.ok(source, `${id} must resolve through the shared registry`);
  assert.equal(source.status, "in_force");
  assert.equal(source.reviewedOn, "2026-10-11");
  assert.match(source.url, /^https:\/\/(www\.bclaws\.gov\.bc\.ca|laws-lois\.justice\.gc\.ca|www\.ontario\.ca)\//);
  assert.ok(source.section && source.fullCitation && source.caveat);
}

console.log("Notice calendar review passed: nominal Sunday/month-end boundaries preserved, no automatic holiday movement, no unqualified legal success, and current primary calendar sources.");
