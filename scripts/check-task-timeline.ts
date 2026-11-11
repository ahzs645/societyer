/**
 * Tasks timeline: the pure date maths (day ↔ pixel, scale ticks, fit range,
 * drag / resize / arrow keys to dates, never a start after the due date), the
 * row builder, and the server's start-date rule on Convex and on the local
 * runtime the demo uses. Synthetic data only.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities, type PortableDoc } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { portableTestPrincipal, PORTABLE_TEST_AUTH_SUBJECT } from "./portable-test-fixture";
import { assertTaskSchedule, isIsoDay, isStartAfterDue } from "../shared/taskSchedule";
import {
  DAY_WIDTH,
  dayFromIso,
  dayToX,
  daysFromPixels,
  describeSchedule,
  draggedSchedule,
  fitRange,
  fitScale,
  isWeekend,
  isoFromDay,
  keyboardSchedule,
  monthRangeLabel,
  openEndDays,
  scaleTicks,
  scheduleFromDates,
  schedulePatch,
  startOfWeek,
  taskSpan,
  timelineDomain,
  visibleDayRange,
  visibleRowRange,
  weekdayOf,
  xToDay,
  type TaskSchedule,
  type TaskSpan,
} from "../src/features/tasks/timeline/timelineMath";
import { buildTimelineRows, nestTaskRows } from "../src/features/tasks/timeline/timelineRows";
import type { TaskRecord } from "../src/features/tasks/taskModel";
import type { Id } from "../convex/_generated/dataModel";

let checks = 0;
const ok = () => { checks += 1; };
const day = (iso: string) => {
  const value = dayFromIso(iso);
  assert.notEqual(value, null, iso);
  return value as number;
};

/* ---------------------------------------------------------------- days */

assert.equal(dayFromIso("1970-01-01"), 0);
assert.equal(dayFromIso("2026-03-04"), day("2026-03-03") + 1);
assert.equal(dayFromIso("2026-03-04T10:00:00Z"), day("2026-03-04"), "a timestamp counts as its day");
assert.equal(dayFromIso("2026-02-30"), null, "not a calendar day");
assert.equal(dayFromIso("next week"), null, "free-text due dates are not scheduled");
assert.equal(dayFromIso(undefined), null);
for (const iso of ["2024-02-29", "2026-03-08", "2026-03-09", "2026-11-01", "2026-12-31", "2027-01-01"]) {
  assert.equal(isoFromDay(day(iso)), iso, `${iso} round-trips`);
}
// DST changes (Mar 8 and Nov 1 2026 in North America) never stretch or shrink a day.
assert.equal(day("2026-03-09") - day("2026-03-08"), 1);
assert.equal(day("2026-11-02") - day("2026-11-01"), 1);
assert.equal(weekdayOf(day("2026-11-11")), 3, "2026-11-11 is a Wednesday");
assert.equal(isWeekend(day("2026-11-14")), true);
assert.equal(isWeekend(day("2026-11-13")), false);
assert.equal(isoFromDay(startOfWeek(day("2026-11-15"))), "2026-11-09", "weeks start on Monday");
assert.equal(isoFromDay(startOfWeek(day("2026-11-09"))), "2026-11-09");
ok();

/* ---------------------------------------------------------------- position */

const origin = day("2026-11-01");
for (const scale of ["day", "week", "month"] as const) {
  const width = DAY_WIDTH[scale];
  for (const offset of [-40, -1, 0, 1, 17, 365]) {
    const x = dayToX(origin + offset, origin, width);
    assert.equal(x, offset * width);
    assert.equal(xToDay(x, origin, width), origin + offset, `${scale}: left edge maps back to its day`);
    assert.equal(xToDay(x + width - 0.5, origin, width), origin + offset, `${scale}: anywhere in the column is that day`);
  }
}
assert.equal(daysFromPixels(17, 36), 0, "less than half a day stays put");
assert.equal(daysFromPixels(19, 36), 1);
assert.equal(daysFromPixels(-19, 36), -1);
assert.ok(Object.is(daysFromPixels(-1, 36), 0), "never -0");
assert.deepEqual(visibleDayRange(360, 720, origin, 36, 2), { from: origin + 8, to: origin + 32 });
assert.deepEqual(visibleRowRange(0, 360, 36, 500, 0), { first: 0, end: 10 });
assert.deepEqual(visibleRowRange(3600, 360, 36, 500, 2), { first: 98, end: 112 });
assert.deepEqual(visibleRowRange(0, 360, 36, 4, 6), { first: 0, end: 4 }, "never past the last row");
assert.deepEqual(visibleRowRange(-48, 360, 36, 40, 0), { first: 0, end: 10 }, "a negative offset clamps");
ok();

/* ---------------------------------------------------------------- spans */

const bar = taskSpan(scheduleFromDates("2026-11-02", "2026-11-06"), 3);
assert.deepEqual(bar, { kind: "bar", start: day("2026-11-02"), end: day("2026-11-06") });
assert.deepEqual(taskSpan(scheduleFromDates(undefined, "2026-11-06"), 3), { kind: "milestone", start: day("2026-11-06"), end: day("2026-11-06") });
assert.deepEqual(taskSpan(scheduleFromDates("2026-11-02", undefined), 3), { kind: "open", start: day("2026-11-02"), end: day("2026-11-04") });
assert.deepEqual(taskSpan(scheduleFromDates("2026-11-02", "soon"), openEndDays("week")), { kind: "open", start: day("2026-11-02"), end: day("2026-11-08") });
assert.deepEqual(taskSpan(scheduleFromDates(undefined, undefined), 3), { kind: "none" });
assert.deepEqual(taskSpan(scheduleFromDates("not a day", undefined), 3), { kind: "none" }, "a malformed start is ignored");
assert.equal(taskSpan(scheduleFromDates("2026-11-09", "2026-11-06"), 3).kind, "milestone", "old data with a start after due shows its due date");
assert.deepEqual(taskSpan(scheduleFromDates("2026-11-06", "2026-11-06"), 3), { kind: "bar", start: day("2026-11-06"), end: day("2026-11-06") }, "a one-day bar");
ok();

/* ---------------------------------------------------------------- ticks */

{
  const from = day("2026-11-27");
  const to = day("2026-12-03");
  const dayTicks = scaleTicks("day", from, to, "en-CA");
  assert.equal(dayTicks.minor.length, 7);
  assert.deepEqual(dayTicks.minor.map((tick) => tick.label), ["27", "28", "29", "30", "1", "2", "3"]);
  assert.deepEqual(dayTicks.minor.filter((tick) => tick.weekend).map((tick) => isoFromDay(tick.day)), ["2026-11-28", "2026-11-29"]);
  assert.deepEqual(dayTicks.major.map((tick) => [isoFromDay(tick.day), tick.days]), [["2026-11-01", 30], ["2026-12-01", 31]]);
  assert.match(dayTicks.major[0].label, /November 2026/);

  const weekTicks = scaleTicks("week", from, to, "en-CA");
  assert.deepEqual(weekTicks.minor.map((tick) => isoFromDay(tick.day)), ["2026-11-23", "2026-11-30"], "weeks begin on the Monday on or before the range");
  assert.ok(weekTicks.minor.every((tick) => tick.days === 7));

  const monthTicks = scaleTicks("month", day("2026-11-15"), day("2027-02-10"), "en-CA");
  assert.deepEqual(monthTicks.minor.map((tick) => [isoFromDay(tick.day), tick.days]), [["2026-11-01", 30], ["2026-12-01", 31], ["2027-01-01", 31], ["2027-02-01", 28]]);
  assert.deepEqual(monthTicks.major.map((tick) => tick.label), ["2026", "2027"]);
  assert.deepEqual(scaleTicks("day", to, from), { major: [], minor: [] }, "an empty range has no ticks");
  // Every tick covers its days exactly once: contiguous, no gaps.
  for (const ticks of [dayTicks.minor, weekTicks.minor, monthTicks.minor, monthTicks.major]) {
    for (let index = 1; index < ticks.length; index += 1) assert.equal(ticks[index].day, ticks[index - 1].day + ticks[index - 1].days);
  }
  assert.equal(monthRangeLabel(day("2026-11-02"), day("2026-11-20"), "en-CA"), "November 2026");
  assert.equal(monthRangeLabel(day("2026-11-02"), day("2026-12-20"), "en-CA"), "November – December 2026");
  assert.equal(monthRangeLabel(day("2026-12-20"), day("2027-01-20"), "en-CA"), "December 2026 – January 2027");
}
ok();

/* ---------------------------------------------------------------- fit and domain */

{
  const today = day("2026-11-11");
  const spans: TaskSpan[] = [
    taskSpan(scheduleFromDates("2026-11-02", "2026-11-20"), 3),
    taskSpan(scheduleFromDates(undefined, "2026-12-31"), 3),
    taskSpan(scheduleFromDates(undefined, undefined), 3),
  ];
  const range = fitRange(spans, today);
  assert.ok(range.start < day("2026-11-02") && range.start >= day("2026-11-02") - 5, "a little room before the first task");
  assert.ok(range.end > day("2026-12-31") && range.end <= day("2026-12-31") + 5, "a little room after the last task");
  assert.deepEqual(fitRange([{ kind: "none" }], today), { start: today - 7, end: today + 21 }, "nothing scheduled: the weeks around today");
  const days = range.end - range.start + 1;
  assert.equal(fitScale(range, days * DAY_WIDTH.day), "day", "the most detailed scale that fits");
  assert.equal(fitScale(range, days * DAY_WIDTH.day - 1), "week");
  assert.equal(fitScale(range, days * DAY_WIDTH.week - 1), "month");
  assert.equal(fitScale(range, 10), "month", "too wide for any scale: month");

  const domain = timelineDomain(spans, today);
  assert.equal(isoFromDay(domain.start).slice(8), "01", "the stretch starts on the first of a month");
  assert.ok(domain.start <= today - 365 && domain.end >= today + 365, "a year either side of today");
  const far = timelineDomain([taskSpan(scheduleFromDates("2020-01-15", "2020-02-01"), 3)], today);
  assert.ok(far.start <= day("2020-01-15"), "widened to every task");
}
ok();

/* ---------------------------------------------------------------- edits */

const iso = (schedule: TaskSchedule | null) => schedule && {
  start: schedule.start === null ? null : isoFromDay(schedule.start),
  due: schedule.due === null ? null : isoFromDay(schedule.due),
};
const neverAfterDue = (schedule: TaskSchedule | null) => {
  const dates = iso(schedule);
  assert.equal(isStartAfterDue(dates?.start, dates?.due), false, `start after due: ${JSON.stringify(dates)}`);
};
{
  // Bar 2026-11-02 … 2026-11-06.
  assert.deepEqual(iso(draggedSchedule(bar, "move", 3)), { start: "2026-11-05", due: "2026-11-09" }, "moving keeps the length");
  assert.deepEqual(iso(draggedSchedule(bar, "move", -9)), { start: "2026-10-24", due: "2026-10-28" });
  assert.deepEqual(iso(draggedSchedule(bar, "start", 2)), { start: "2026-11-04", due: "2026-11-06" });
  assert.deepEqual(iso(draggedSchedule(bar, "start", 10)), { start: "2026-11-06", due: "2026-11-06" }, "the start stops at the due date");
  assert.deepEqual(iso(draggedSchedule(bar, "end", -10)), { start: "2026-11-02", due: "2026-11-02" }, "the due date stops at the start");
  assert.deepEqual(iso(draggedSchedule(bar, "end", 4)), { start: "2026-11-02", due: "2026-11-10" });
  for (let delta = -20; delta <= 20; delta += 1) {
    for (const mode of ["move", "start", "end"] as const) neverAfterDue(draggedSchedule(bar, mode, delta));
  }

  const milestone = taskSpan(scheduleFromDates(undefined, "2026-11-06"), 3);
  for (const mode of ["move", "start", "end"] as const) {
    assert.deepEqual(iso(draggedSchedule(milestone, mode, -2)), { start: null, due: "2026-11-04" }, `a milestone only moves (${mode})`);
  }

  const open = taskSpan(scheduleFromDates("2026-11-02", undefined), 3); // drawn to 2026-11-04
  assert.deepEqual(iso(draggedSchedule(open, "move", 1)), { start: "2026-11-03", due: null }, "an open bar moves its start");
  assert.deepEqual(iso(draggedSchedule(open, "start", -1)), { start: "2026-11-01", due: null });
  assert.deepEqual(iso(draggedSchedule(open, "end", 2)), { start: "2026-11-02", due: "2026-11-06" }, "its end edge sets a due date where it lands");
  assert.deepEqual(iso(draggedSchedule(open, "end", -9)), { start: "2026-11-02", due: "2026-11-02" }, "never before the start");
  assert.equal(draggedSchedule({ kind: "none" }, "move", 1), null);

  // Arrow keys: ← / → move, Shift changes the length (the due date).
  assert.deepEqual(iso(keyboardSchedule(bar, 1, false)), { start: "2026-11-03", due: "2026-11-07" });
  assert.deepEqual(iso(keyboardSchedule(bar, -1, true)), { start: "2026-11-02", due: "2026-11-05" });
  assert.deepEqual(iso(keyboardSchedule(bar, 1, true)), { start: "2026-11-02", due: "2026-11-07" });
  const oneDay = taskSpan(scheduleFromDates("2026-11-06", "2026-11-06"), 3);
  assert.equal(keyboardSchedule(oneDay, -1, true), null, "a one-day bar can't get shorter");
  assert.deepEqual(iso(keyboardSchedule(milestone, 1, false)), { start: null, due: "2026-11-07" });
  assert.equal(keyboardSchedule(milestone, 1, true), null, "a milestone has no length");
  assert.deepEqual(iso(keyboardSchedule(open, 1, true)), { start: "2026-11-02", due: "2026-11-05" });
  assert.equal(keyboardSchedule({ kind: "none" }, 1, false), null);

  // Only changed dates are sent; a null leaves a date as it is.
  const current = scheduleFromDates("2026-11-02", "2026-11-06");
  assert.deepEqual(schedulePatch(current, draggedSchedule(bar, "move", 1) as TaskSchedule), { startDate: "2026-11-03", dueDate: "2026-11-07" });
  assert.deepEqual(schedulePatch(current, draggedSchedule(bar, "end", 1) as TaskSchedule), { dueDate: "2026-11-07" });
  assert.deepEqual(schedulePatch(current, { start: null, due: null }), {});
  assert.deepEqual(schedulePatch(current, current), {});
  assert.deepEqual(schedulePatch(scheduleFromDates(undefined, "someday"), { start: null, due: day("2026-11-20") }), { dueDate: "2026-11-20" }, "scheduling an unscheduled task sets its due date");

  assert.equal(describeSchedule(current, 2026, "en-CA"), "Nov 2 – Nov 6");
  assert.equal(describeSchedule(scheduleFromDates(undefined, "2027-01-04"), 2026, "en-CA"), "Due Jan 4, 2027");
  assert.equal(describeSchedule(scheduleFromDates("2026-11-02", undefined), 2026, "en-CA"), "Starts Nov 2");
  assert.equal(describeSchedule({ start: null, due: null }, 2026), "No dates");
}
ok();

/* ---------------------------------------------------------------- rows */

{
  let counter = 0;
  const task = (fields: Partial<Pick<TaskRecord, "title" | "status" | "startDate" | "dueDate">>): TaskRecord => {
    counter += 1;
    // Synthetic ids: the brand is how the app spells a document id.
    const _id = `task${counter}` as Id<"tasks">;
    const societyId = "society1" as Id<"societies">;
    return { _id, _creationTime: counter, societyId, title: `Task ${counter}`, status: "Todo", priority: "Medium", tags: [], createdAtISO: "2026-11-01T00:00:00.000Z", _searchText: "", linkedTo: [], ...fields };
  };
  const late = task({ title: "Late", startDate: "2026-11-20", dueDate: "2026-11-25" });
  const early = task({ title: "Early", dueDate: "2026-11-03" });
  const doneTask = task({ title: "Finished", status: "Done", startDate: "2026-11-01", dueDate: "2026-11-02" });
  const loose = task({ title: "Loose" });
  const freeText = task({ title: "Free text", dueDate: "after the AGM" });
  const tasks = [late, early, doneTask, loose, freeText];
  const now = new Date(2026, 10, 11);

  const byStatus = buildTimelineRows({ tasks, groupBy: "status", toggled: {}, openDays: 3, now });
  assert.deepEqual(byStatus.map((row) => (row.kind === "group" ? `[${row.label}${row.collapsed ? " +" : ""}]` : row.task.title)), [
    "[To do]", "Early", "Late", "[Done +]", "[Not scheduled +]",
  ], "empty groups are left out, Done starts closed, rows run by date, unscheduled tasks wait at the bottom");
  const unscheduledGroup = byStatus.at(-1);
  assert.ok(unscheduledGroup?.kind === "group" && unscheduledGroup.count === 2, "free-text due dates count as not scheduled");

  const opened = buildTimelineRows({ tasks, groupBy: "status", toggled: { "status:Done": false, "timeline:unscheduled": false }, openDays: 3, now });
  assert.deepEqual(opened.filter((row) => row.kind === "task").map((row) => row.kind === "task" && row.task.title), ["Early", "Late", "Finished", "Loose", "Free text"]);
  const lateRow = opened.find((row) => row.kind === "task" && row.task.title === "Late");
  assert.ok(lateRow?.kind === "task" && lateRow.span.kind === "bar" && lateRow.depth === 0);
  const looseRow = opened.find((row) => row.kind === "task" && row.task.title === "Loose");
  assert.ok(looseRow?.kind === "task" && looseRow.span.kind === "none");

  const flat = buildTimelineRows({ tasks, groupBy: "none", toggled: {}, openDays: 3, now });
  assert.deepEqual(flat.map((row) => (row.kind === "group" ? `[${row.label}]` : row.task.title)), ["Finished", "Early", "Late", "[Not scheduled]"], "no grouping: no headers above scheduled tasks");

  const byOwner = buildTimelineRows({ tasks: [early], groupBy: "owner", toggled: {}, openDays: 3, now });
  assert.deepEqual(byOwner.map((row) => (row.kind === "group" ? row.label : row.task.title)), ["No owner", "Early"]);
  assert.deepEqual(buildTimelineRows({ tasks: [], groupBy: "due", toggled: {}, openDays: 3, now }), []);
  assert.deepEqual(nestTaskRows([late, early]).map((entry) => entry.depth), [0, 0], "the sub-task hook keeps every task at depth 0 for now");

  // A few hundred tasks build quickly (the view rebuilds rows on every change).
  const many = Array.from({ length: 600 }, (_, index) => task({ startDate: isoFromDay(day("2026-01-01") + index), dueDate: isoFromDay(day("2026-01-05") + index) }));
  const started = performance.now();
  for (let round = 0; round < 20; round += 1) buildTimelineRows({ tasks: many, groupBy: "due", toggled: {}, openDays: 7, now });
  assert.ok((performance.now() - started) / 20 < 50, "building rows for 600 tasks stays well under a frame budget");
}
ok();

/* ---------------------------------------------------------------- server rule */

assert.equal(isIsoDay("2026-11-11"), true);
assert.equal(isIsoDay("2026-13-01"), false);
assert.equal(isStartAfterDue("2026-11-12", "2026-11-11"), true);
assert.equal(isStartAfterDue("2026-11-11", "2026-11-11"), false, "the same day is fine");
assert.equal(isStartAfterDue("2026-11-12", "after the AGM"), false, "a free-text due date can't be compared");
assert.doesNotThrow(() => assertTaskSchedule(undefined, "2026-11-11"));
assert.doesNotThrow(() => assertTaskSchedule("", "2026-11-11"), "an empty start date counts as none");
assert.throws(() => assertTaskSchedule("2026-11-12", "2026-11-11"), /can't be after the due date/);
assert.throws(() => assertTaskSchedule("12/11/2026", undefined), /must be a date/);
ok();

const now = "2026-11-11T12:00:00.000Z";
const societyFields = { name: "Synthetic timeline workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 };
const ownerFields = { role: "Owner", status: "Active", displayName: "Owner", email: "owner@timeline.example.test", authProvider: "better-auth", createdAtISO: now };
const issuer = betterAuthIssuer();
const backend = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./tasks.js": () => import("../convex/tasks"),
});
const nativeSociety = await backend.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", societyFields);
  await ctx.db.insert("users", { ...ownerFields, societyId, authSubject: "owner", authIssuer: issuer });
  return societyId;
});
const owner = backend.withIdentity({ subject: "owner", issuer });
const localDb = new LocalStoreDb(new MemoryRowStore());
const localSociety = await localDb.transaction(async () => {
  const societyId = await localDb.insert("societies", societyFields);
  await localDb.insert("users", { ...ownerFields, societyId, authSubject: PORTABLE_TEST_AUTH_SUBJECT, authIssuer: "https://portable-fixture.test" });
  return societyId;
});
const runtime = new PortableRuntime({ db: localDb, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).registerAll(PORTABLE_FUNCTIONS);

type DateFields = { startDate?: string; dueDate?: string };
type DatePatchArgs = DateFields & { title?: string; clearFields?: "dueDate"[] };
type Runner<TaskId> = {
  label: string;
  create: (dates: DateFields) => Promise<TaskId>;
  update: (id: TaskId, patch: DatePatchArgs) => Promise<unknown>;
  read: (id: TaskId) => Promise<DateFields | null>;
};
const newTask = { title: "Prepare the board pack", status: "Todo", priority: "Medium", tags: [] };
const convexRunner: Runner<Id<"tasks">> = {
  label: "Convex",
  create: (dates) => owner.mutation(api.tasks.create, { ...newTask, ...dates, societyId: nativeSociety }),
  update: (id, patch) => owner.mutation(api.tasks.update, { id, patch }),
  read: (id) => backend.run((ctx) => ctx.db.get(id)),
};
const localRunner: Runner<string> = {
  label: "local",
  create: (dates) => runtime.runMutation<string>("tasks:create", { ...newTask, ...dates, societyId: localSociety }),
  update: (id, patch) => runtime.runMutation("tasks:update", { id, patch }),
  read: (id) => localDb.get<PortableDoc & DateFields>(id),
};

async function checkStartDateRule<TaskId>({ label, create, update, read }: Runner<TaskId>) {
  const id = await create({ startDate: "2026-11-02", dueDate: "2026-11-06" });
  let stored = await read(id);
  assert.equal(stored?.startDate, "2026-11-02", `${label}: the start date is stored`);
  await assert.rejects(() => create({ startDate: "2026-11-07", dueDate: "2026-11-06" }), /after the due date/, `${label}: create refuses a start after due`);
  await assert.rejects(() => create({ startDate: "Nov 2" }), /must be a date/, `${label}: create refuses a malformed start`);
  // A timeline move sends both dates together.
  await update(id, { startDate: "2026-11-09", dueDate: "2026-11-13" });
  stored = await read(id);
  assert.deepEqual([stored?.startDate, stored?.dueDate], ["2026-11-09", "2026-11-13"], `${label}: a move saves both dates`);
  await assert.rejects(() => update(id, { startDate: "2026-11-14" }), /after the due date/, `${label}: moving the start past the stored due date is refused`);
  await assert.rejects(() => update(id, { dueDate: "2026-11-08" }), /after the due date/, `${label}: moving the due date before the stored start is refused`);
  await update(id, { dueDate: "2026-11-09" });
  assert.equal((await read(id))?.dueDate, "2026-11-09", `${label}: a one-day task is fine`);
  // Undo of "Due date set" clears the due date again; the start date stays.
  await update(id, { clearFields: ["dueDate"] });
  stored = await read(id);
  assert.deepEqual([stored?.startDate, stored?.dueDate], ["2026-11-09", undefined], `${label}: clearing the due date keeps the start`);
  await update(id, { dueDate: "after the AGM" });
  assert.equal((await read(id))?.dueDate, "after the AGM", `${label}: free-text due dates still save beside a start date`);
  await update(id, { title: "Prepare the board pack (final)" });
  assert.equal((await read(id))?.startDate, "2026-11-09", `${label}: other edits leave the start date alone`);
  console.log(`✓ ${label}: start dates save, and a start after the due date is refused on create and update`);
}
await checkStartDateRule(convexRunner);
await checkStartDateRule(localRunner);
ok();

console.log(`Task timeline checks passed (${checks} groups).`);
