// Repeating tasks: the pure date rules (month ends, leap years, intervals,
// end dates, skipping forward) and the server's next occurrence (created once
// on completion, never on cancel, never past the end date, validated rules).
// Runs the real portable handlers on a MemoryDb, as the server and the
// in-browser workspace do.
//
//   npx tsx scripts/check-task-recurrence.ts

import assert from "node:assert/strict";
import { MemoryDb, PortableRuntime, makeCapabilities, type PortableDoc } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import {
  addIsoDays,
  describeTaskRecurrence,
  isIsoDay,
  nextTaskOccurrence,
  normalizeTaskRecurrence,
  type TaskRecurrence,
} from "../shared/taskRecurrence";
import { organizationTodayForTasks } from "../shared/functions/taskNotifications";

const rule = (frequency: TaskRecurrence["frequency"], interval = 1, extra: Partial<TaskRecurrence> = {}): TaskRecurrence => ({ frequency, interval, ...extra });
const next = (dueDate: string, r: TaskRecurrence, today?: string, startDate?: string) => nextTaskOccurrence({ dueDate, ...(startDate ? { startDate } : {}) }, r, today ? { today } : {});
const chain = (dueDate: string, r: TaskRecurrence, steps: number) => {
  const out: string[] = [];
  let current = dueDate;
  for (let i = 0; i < steps; i++) {
    const result = next(current, r);
    assert.ok(result, `step ${i + 1} from ${current}`);
    current = result.dueDate;
    out.push(current);
  }
  return out;
};

// --- Pure date rules --------------------------------------------------------------------
assert.equal(next("2026-03-10", rule("daily"))?.dueDate, "2026-03-11");
assert.equal(next("2026-12-31", rule("daily"))?.dueDate, "2027-01-01", "daily crosses the year");
assert.equal(next("2026-03-10", rule("daily", 3))?.dueDate, "2026-03-13");
assert.equal(next("2026-03-10", rule("weekly"))?.dueDate, "2026-03-17");
assert.equal(next("2026-03-10", rule("weekly", 2))?.dueDate, "2026-03-24");
assert.equal(next("2026-03-08", rule("weekly"))?.dueDate, "2026-03-15", "weekly is unaffected by a daylight-saving change");
assert.equal(next("2026-01-15", rule("monthly"))?.dueDate, "2026-02-15");
assert.equal(next("2026-11-30", rule("monthly", 3))?.dueDate, "2027-02-28", "every 3 months, clamped to February's end");
console.log("✓ daily, weekly and monthly steps with intervals");

// Month ends stay anchored to the original day.
const jan31 = normalizeTaskRecurrence(rule("monthly"), "2027-01-31");
assert.equal(jan31.anchorDay, 31);
assert.deepEqual(chain("2027-01-31", jan31, 4), ["2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"], "31 Jan → 28 Feb → 31 Mar, not the 28th forever");
assert.deepEqual(chain("2028-01-31", normalizeTaskRecurrence(rule("monthly"), "2028-01-31"), 2), ["2028-02-29", "2028-03-31"], "leap-year February");
assert.deepEqual(chain("2026-08-31", normalizeTaskRecurrence(rule("monthly", 6), "2026-08-31"), 2), ["2027-02-28", "2027-08-31"]);
// Without an anchor the day of the previous due date is used.
assert.equal(next("2027-02-28", rule("monthly"))?.dueDate, "2027-03-28");
console.log("✓ monthly rules stay anchored to the original day across month ends and leap years");

const feb29 = normalizeTaskRecurrence(rule("yearly"), "2028-02-29");
assert.deepEqual(chain("2028-02-29", feb29, 4), ["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"], "29 Feb comes back in leap years");
assert.deepEqual(chain("2028-02-29", normalizeTaskRecurrence(rule("yearly", 4), "2028-02-29"), 1), ["2032-02-29"]);
assert.equal(next("2026-06-30", rule("yearly", 2))?.dueDate, "2028-06-30");
console.log("✓ yearly rules, intervals and 29 February");

// The end date is inclusive; past it the series stops.
assert.equal(next("2026-05-01", rule("weekly", 1, { until: "2026-05-08" }))?.dueDate, "2026-05-08");
assert.equal(next("2026-05-01", rule("weekly", 1, { until: "2026-05-07" })), null);
assert.equal(next("2026-05-01", rule("monthly", 1, { until: "2026-05-31" })), null);
console.log("✓ end date is inclusive and stops the series");

// Skip forward from the previous due date, never counting from today.
assert.equal(next("2026-01-05", rule("weekly"), "2026-03-01")?.dueDate, "2026-03-02", "weekly on Mondays stays on Mondays");
assert.equal(next("2026-01-05", rule("weekly"), "2026-03-02")?.dueDate, "2026-03-02", "today itself is not in the past");
assert.equal(next("2026-01-01", rule("daily", 10), "2026-01-25")?.dueDate, "2026-01-31");
assert.equal(next("2025-01-31", jan31, "2026-04-15")?.dueDate, "2026-04-30", "monthly skips whole months and keeps the anchor");
assert.equal(next("2020-02-29", feb29, "2026-11-11")?.dueDate, "2027-02-28");
assert.equal(next("2026-01-05", rule("weekly", 1, { until: "2026-02-01" }), "2026-03-01"), null, "skipping past the end date ends the series");
assert.equal(next("2026-03-10", rule("weekly"), "2026-03-01")?.dueDate, "2026-03-17", "an early completion still moves one step");
console.log("✓ skips forward so the next one is not in the past");

// A start date keeps its distance before the due date.
assert.deepEqual(next("2026-03-10", rule("weekly"), undefined, "2026-03-07"), { dueDate: "2026-03-17", startDate: "2026-03-14" });
assert.deepEqual(next("2027-01-31", jan31, undefined, "2027-01-25"), { dueDate: "2027-02-28", startDate: "2027-02-22" });
assert.deepEqual(next("2026-03-10", rule("daily")), { dueDate: "2026-03-11" }, "no start date in, none out");
console.log("✓ an optional start date shifts with the due date");

// Validation.
assert.throws(() => normalizeTaskRecurrence(rule("weekly"), undefined), /Add a due date/);
assert.throws(() => normalizeTaskRecurrence(rule("weekly"), "next Friday"), /Add a due date/);
assert.throws(() => normalizeTaskRecurrence(rule("weekly", 0), "2026-03-10"), /whole number/);
assert.throws(() => normalizeTaskRecurrence(rule("weekly", 1.5), "2026-03-10"), /whole number/);
assert.throws(() => normalizeTaskRecurrence({ frequency: "hourly", interval: 1 }, "2026-03-10"), /daily, weekly, monthly or yearly/);
assert.throws(() => normalizeTaskRecurrence(rule("weekly", 1, { until: "2026-03-01" }), "2026-03-10"), /can't be before the due date/);
assert.throws(() => normalizeTaskRecurrence(rule("weekly", 1, { until: "2026-02-30" }), "2026-03-10"), /not a valid date/);
assert.equal(normalizeTaskRecurrence(rule("weekly"), "2026-03-10").anchorDay, undefined, "only monthly and yearly rules keep an anchor");
assert.equal(normalizeTaskRecurrence({ ...rule("monthly"), anchorDay: 3 }, "2027-02-28", { recurrence: { frequency: "monthly", interval: 1, anchorDay: 31 }, dueDate: "2027-02-28" }).anchorDay, 31, "an unchanged due date keeps the series anchor, whatever the client sends");
assert.equal(normalizeTaskRecurrence(rule("monthly"), "2027-03-15", { recurrence: { frequency: "monthly", interval: 1, anchorDay: 31 }, dueDate: "2027-02-28" }).anchorDay, 15, "a new due date re-anchors");
assert.ok(isIsoDay("2028-02-29") && !isIsoDay("2027-02-29"));
assert.equal(describeTaskRecurrence(rule("weekly")), "Weekly");
assert.equal(describeTaskRecurrence(rule("monthly", 3, { until: "2027-06-30" })), "Every 3 months, until 2027-06-30");
console.log("✓ rules are validated with plain messages");

// --- Server: the next occurrence --------------------------------------------------------
const db = new MemoryDb();
const caps = makeCapabilities({});
const as = (userId: string, societyId: string) =>
  new PortableRuntime({
    db,
    capabilities: caps,
    principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `user:${userId}`, userId, societyId }),
  }).registerAll(PORTABLE_FUNCTIONS);

const societyId = await db.insert("societies", { name: "Lakeside Choir" });
const ownerId = await db.insert("users", { societyId, role: "Owner", status: "Active", displayName: "Olive Owner", email: "olive@example.invalid" });
const adminId = await db.insert("users", { societyId, role: "Admin", status: "Active", displayName: "Ari Admin", email: "ari@example.invalid" });
const committeeId = await db.insert("committees", { societyId, name: "Music committee" });
const goalId = await db.insert("goals", { societyId, title: "Grow the choir" });
const owner = as(ownerId, societyId);
const today = organizationTodayForTasks(await db.get(societyId, "societies"), new Date().toISOString());
const tasksOf = async () => (await db.query("tasks").collect()) as PortableDoc[];
const get = async (id: string) => (await db.get(id, "tasks")) as PortableDoc;

await assert.rejects(owner.runMutation("tasks:create", { societyId, title: "No date", status: "Todo", priority: "Low", tags: [], recurrence: rule("weekly") }), /Add a due date/, "a task with no due date can't repeat");

const due = addIsoDays(today, 2);
const repeatingId = await owner.runMutation<string>("tasks:create", {
  societyId, title: "Book the rehearsal hall", description: "Call the parish office.", status: "Todo", priority: "High",
  assignee: "Ari", responsibleUserIds: [ownerId, adminId], committeeId, goalId, dueDate: due, tags: ["venue"],
  checklist: [{ id: "c1", title: "Call", done: true }, { id: "c2", title: "Pay deposit", done: false }],
  recurrence: rule("weekly"),
});
assert.deepEqual((await get(repeatingId)).recurrence, { frequency: "weekly", interval: 1 });

await owner.runMutation("tasks:update", { id: repeatingId, patch: { status: "Done" } });
const afterFirst = await tasksOf();
assert.equal(afterFirst.length, 2, "completing a repeating task creates the next one");
const completed = await get(repeatingId);
const nextTask = afterFirst.find((task) => task._id !== repeatingId)!;
assert.equal(completed.recurrenceNextTaskId, nextTask._id);
assert.equal(nextTask.recurrencePreviousTaskId, repeatingId);
assert.equal(nextTask.dueDate, addIsoDays(due, 7), "due a week after the previous due date, not the completion date");
assert.equal(nextTask.status, "Todo");
assert.equal(nextTask.completedAt, undefined);
for (const field of ["title", "description", "priority", "assignee", "committeeId", "goalId"]) assert.equal(nextTask[field], completed[field], `copies ${field}`);
assert.deepEqual(nextTask.responsibleUserIds, [ownerId, adminId]);
assert.deepEqual(nextTask.tags, ["venue"]);
assert.deepEqual(nextTask.checklist, [{ id: "c1", title: "Call", done: false }, { id: "c2", title: "Pay deposit", done: false }], "the checklist starts unticked");
assert.deepEqual(nextTask.recurrence, { frequency: "weekly", interval: 1 });
assert.equal(nextTask.statusHistory, undefined, "the next one starts with a clean history");

// Reopen and complete again: no second occurrence.
await owner.runMutation("tasks:update", { id: repeatingId, patch: { status: "Todo" } });
await owner.runMutation("tasks:update", { id: repeatingId, patch: { status: "Done" } });
await owner.runMutation("tasks:update", { id: repeatingId, patch: { status: "Done", priority: "Low" } });
assert.equal((await tasksOf()).length, 2, "reopening and completing again does not create another");
console.log("✓ completing creates the next occurrence once, with the right fields and a fresh checklist");

// Overdue when completed: the next one skips forward, counted from the old due date.
const lateId = await owner.runMutation<string>("tasks:create", { societyId, title: "Weekly attendance", status: "Todo", priority: "Medium", dueDate: addIsoDays(today, -15), tags: [], recurrence: rule("weekly") });
await owner.runMutation("tasks:update", { id: lateId, patch: { status: "Done" } });
const lateNext = await get(String((await get(lateId)).recurrenceNextTaskId));
assert.equal(lateNext.dueDate, addIsoDays(today, 6), "15 days late → the first weekly date on or after today (−15 + 21)");

// Monthly anchored on a 31st, through the server.
const monthEndId = await owner.runMutation<string>("tasks:create", { societyId, title: "Reconcile the bank", status: "Todo", priority: "Medium", dueDate: "2099-01-31", tags: [], recurrence: rule("monthly") });
await owner.runMutation("tasks:update", { id: monthEndId, patch: { status: "Done" } });
const feb = await get(String((await get(monthEndId)).recurrenceNextTaskId));
assert.equal(feb.dueDate, "2099-02-28");
await owner.runMutation("tasks:update", { id: String(feb._id), patch: { status: "Done" } });
assert.equal((await get(String((await get(String(feb._id))).recurrenceNextTaskId))).dueDate, "2099-03-31", "the anchor travels with the series");

// Cancelling never creates one; past the end date nothing is created.
const cancelId = await owner.runMutation<string>("tasks:create", { societyId, title: "Order robes", status: "Todo", priority: "Low", dueDate: addIsoDays(today, 3), tags: [], recurrence: rule("daily") });
await owner.runMutation("tasks:update", { id: cancelId, patch: { status: "Cancelled" } });
assert.equal((await get(cancelId)).recurrenceNextTaskId, undefined, "cancelling does not create a next occurrence");
const endingId = await owner.runMutation<string>("tasks:create", { societyId, title: "Spring concert prep", status: "Todo", priority: "Low", dueDate: addIsoDays(today, 3), tags: [], recurrence: rule("weekly", 1, { until: addIsoDays(today, 9) }) });
await owner.runMutation("tasks:update", { id: endingId, patch: { status: "Done" } });
assert.equal((await get(endingId)).recurrenceNextTaskId, undefined, "the next date is past the end date");
const count = (await tasksOf()).length;
console.log("✓ late completions skip forward, month ends hold, cancel and end date create nothing");

// Editing the rule: stop repeating, and no date removal while repeating.
await assert.rejects(owner.runMutation("tasks:update", { id: String(lateNext._id), patch: { clearFields: ["dueDate"] } }), /needs a due date/);
await assert.rejects(owner.runMutation("tasks:update", { id: String(lateNext._id), patch: { dueDate: "" } }), /needs a due date/);
await owner.runMutation("tasks:update", { id: String(lateNext._id), patch: { recurrence: null, clearFields: ["dueDate"] } });
assert.equal((await get(String(lateNext._id))).recurrence, undefined, "null stops the repeat");
await owner.runMutation("tasks:update", { id: String(lateNext._id), patch: { status: "Done" } });
assert.equal((await tasksOf()).length, count, "a task that no longer repeats creates nothing");
await assert.rejects(owner.runMutation("tasks:update", { id: String(lateNext._id), patch: { recurrence: rule("monthly") } }), /Add a due date/);
await owner.runMutation("tasks:update", { id: String(lateNext._id), patch: { dueDate: "2099-05-31", recurrence: rule("monthly", 2) } });
assert.deepEqual((await get(String(lateNext._id))).recurrence, { frequency: "monthly", interval: 2, anchorDay: 31 });
await owner.runMutation("tasks:update", { id: String(lateNext._id), patch: { dueDate: "2099-05-15" } });
assert.equal((await get(String(lateNext._id))).recurrence.anchorDay, 15, "moving the due date re-anchors the rule");
console.log("✓ rule edits: stop repeating, keep a due date while repeating, re-anchor on a new due date");

console.log("\nTask recurrence checks passed.");
