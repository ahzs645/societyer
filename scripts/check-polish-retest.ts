/**
 * Gate for the final polish retest fixes (MA-6/7/8, A3, A5, A6, A8, FF-2,
 * P-O4, A4). Synthetic data only. Browser behaviour is covered by
 * tests/meetings-editing.spec.ts and tests/interface-polish.spec.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatDueDate } from "../src/lib/format";
import { meetingNotYetHeld } from "../src/features/meetings/lib/noticeWindow";
import { visibleAgendaEntries } from "../src/features/meetings/lib/sourceAgendaNavigation";
import { calendarOpeningDate } from "../src/components/CalendarView";
import { calendarDateKey } from "../src/lib/calendarDates";
import { DETAIL_RECORD_QUERIES, isRecordNotFoundError } from "../src/lib/detailRecordQueries";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// MA-7: ISO days use the app format; free text is kept as written.
assert.equal(formatDueDate("2026-10-20"), "Oct 20, 2026");
assert.equal(formatDueDate("2026-10-20", "MMMM d, yyyy"), "October 20, 2026");
assert.equal(formatDueDate("before the AGM"), "before the AGM");
assert.equal(formatDueDate("2026-02-30"), "2026-02-30", "an impossible day stays as written");
assert.equal(formatDueDate(""), "");
assert.equal(formatDueDate(undefined), "");

// MA-8: only a scheduled meeting on a later day is "not yet held".
const now = new Date("2026-10-07T18:00:00Z");
assert.equal(meetingNotYetHeld({ status: "Scheduled", scheduledAt: "2026-11-06T18:00:00Z" }, now), true);
assert.equal(meetingNotYetHeld({ status: "Held", scheduledAt: "2026-11-06T18:00:00Z" }, now), false);
assert.equal(meetingNotYetHeld({ status: "Scheduled", scheduledAt: "2026-10-01T18:00:00Z" }, now), false, "past scheduled meetings are a record, not a plan");
assert.equal(meetingNotYetHeld({ status: "Scheduled", scheduledAt: "2026-10-07T23:00:00Z" }, now), false, "a meeting today may be running now");
assert.equal(meetingNotYetHeld({ status: "Cancelled", scheduledAt: "2026-11-06T18:00:00Z" }, now), false);
assert.equal(meetingNotYetHeld(null, now), false);

// MA-6: an untouched source-notes dump is not an agenda topic.
const dump = { title: "Source notes awaiting agenda mapping", discussion: "raw", sourceReference: "p1" };
const record = { sectionBaseline: [dump] };
const sections = [{ title: "Finance report" }, dump];
const entries = [{ title: "Finance report" }, { title: "Source notes awaiting agenda mapping" }];
assert.deepEqual(visibleAgendaEntries(entries, sections, record).map((entry) => entry.title), ["Finance report"]);
assert.equal(visibleAgendaEntries(entries, sections, null).length, 2, "without a source baseline nothing is hidden");

// A6: the calendar opens on the records when today's month has none.
const today = new Date(2026, 9, 7);
assert.equal(calendarOpeningDate([], today), null);
assert.equal(calendarOpeningDate(["2026-10-20", "2019-01-02"], today), null, "today's month has a record");
assert.equal(calendarDateKey(calendarOpeningDate(["2008-03-04", "2019-05-14", "2023-09-13"], today)!), "2023-09-13");
assert.equal(calendarDateKey(calendarOpeningDate(["2019-05-14", "2027-02-01"], today)!), "2019-05-14", "most recent past record first");
assert.equal(calendarDateKey(calendarOpeningDate(["2027-02-01", "2028-01-01"], today)!), "2027-02-01", "else the first upcoming one");
const calendarSource = read("src/components/CalendarView.tsx");
assert.match(calendarSource, /Jump to earliest record/);
assert.match(calendarSource, /Jump to latest record/);

// FF-2 / A8: detail and current-user lookups read a missing id as null.
for (const name of ["meetings:get", "committees:detail", "goals:get", "elections:get", "users:get"]) {
  assert.ok(DETAIL_RECORD_QUERIES.has(name), `${name} is a detail record query`);
}
assert.ok(isRecordNotFoundError(new Error("users not found.")));
assert.ok(isRecordNotFoundError(new Error("Record not found.")));
assert.ok(!isRecordNotFoundError(new Error("Society membership not found.")));
for (const path of ["src/pages/MeetingDetail.tsx", "src/features/meetings/pages/MeetingMinutesPreviewPage.tsx", "src/pages/AgmWorkflow.tsx", "src/pages/ElectionDetail.tsx", "src/pages/CommitteeDetail.tsx", "src/pages/GoalDetail.tsx", "src/hooks/useCurrentUser.ts"]) {
  assert.match(read(path), /useRecordQuery/, `${path} reads its record with useRecordQuery`);
}
assert.doesNotMatch(read("src/pages/MeetingDetail.tsx"), /\{ meetingId: id as Id<"meetings"> \}/, "meeting panels wait for the meeting");

// P-O4: a vanished record is not logged as a warning.
assert.match(read("src/lib/portableQueryCache.ts"), /isRecordNotFoundError\(error\)\) console\.debug/);

// A5: counts wait for the local workspace.
const layout = read("src/components/Layout.tsx");
assert.match(layout, /localWorkspaceReady \? rawCounts : undefined/);
assert.match(read("src/components/Layout.internal.tsx"), /loading count/);

// A4: one portable createWorkspace handler.
const manifest = JSON.parse(read("shared/functions/portable-manifest.json"));
assert.equal(manifest.functions.find((fn: { name: string }) => fn.name === "society:createWorkspace")?.classification, "portable");

// A3: the demo's upcoming board meeting is never in the past.
const { demoUpcoming } = await import("../src/lib/staticConvexFixtures");
const shifted = demoUpcoming("2026-04-23T19:00:00.000Z");
assert.ok(Date.parse(shifted) >= Date.now(), `demo board meeting ${shifted} is upcoming`);
assert.equal(new Date(shifted).getUTCDay(), 4, "whole-week shifts keep the weekday");
assert.match(demoUpcoming("2026-04-21"), /^\d{4}-\d{2}-\d{2}$/, "date-only values stay date-only");
assert.match(read("src/lib/staticConvexFixtures.ts"), /scheduledAt: demoUpcoming\("2026-04-23T19:00:00\.000Z"\)/);

console.log("Polish retest checks passed: due dates, expected attendance, agenda topic count, calendar opening month and jumps, detail not-found lookups, quiet vanished records, loading counts, portable workspace creation, upcoming demo meeting.");
