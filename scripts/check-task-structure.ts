/**
 * Task start dates, one-level sub-tasks and manual board order:
 * pure rules (dates, positions, nesting) and the same server rules on hosted
 * Convex and the local portable runtime the demo uses.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { portableTestPrincipal, PORTABLE_TEST_AUTH_SUBJECT } from "./portable-test-fixture";
import {
  TASK_POSITION_MIN_GAP,
  TASK_POSITION_STEP,
  applyTaskPositionWrites,
  assertTaskPosition,
  planTaskMove,
  positionBetween,
  rebalancePositions,
  sortByPosition,
  type TaskPositionItem,
} from "../shared/taskPosition";
import {
  SUBTASK_HAS_CHILDREN,
  SUBTASK_HISTORICAL,
  SUBTASK_NESTED,
  SUBTASK_SELF_PARENT,
  TASK_START_AFTER_DUE,
  TASK_START_DATE_INVALID,
  isCalendarDay,
  subtaskParentProblem,
  subtaskProgress,
  taskScheduleProblem,
} from "../shared/taskSchedule";
import { TASK_CLEARABLE_FIELDS, TASK_STRUCTURE_CLEARABLE_FIELDS, normalizedTaskPatch } from "../shared/taskEditing";
import { nestTasks, withSubtaskInfo } from "../src/features/tasks/taskSubtaskModel";

let checks = 0;
const ok = (label: string) => { checks++; console.log(`✓ ${label}`); };

/* ------------------------------------------------------------ start dates */

for (const day of ["2026-01-31", "2024-02-29", "2026-12-01"]) assert.equal(isCalendarDay(day), true, day);
for (const day of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-01", "Mar 3", "", "2026-01-01T00:00"]) assert.equal(isCalendarDay(day), false, day);
assert.equal(taskScheduleProblem(undefined, "2026-01-01"), null);
assert.equal(taskScheduleProblem("", "2026-01-01"), null);
assert.equal(taskScheduleProblem("2026-01-01", "2026-01-01"), null, "same day is fine");
assert.equal(taskScheduleProblem("2026-01-02", "2026-01-01"), TASK_START_AFTER_DUE);
assert.equal(taskScheduleProblem("2026-02-30", undefined), TASK_START_DATE_INVALID);
assert.equal(taskScheduleProblem("2026-05-01", "end of spring"), null, "a free-text due date is not compared");
assert.ok((TASK_CLEARABLE_FIELDS as readonly string[]).includes("startDate"), "the form can clear a start date");
assert.ok(!(TASK_CLEARABLE_FIELDS as readonly string[]).includes("parentTaskId"), "the form never clears the parent");
assert.deepEqual(normalizedTaskPatch({ clearFields: [...TASK_STRUCTURE_CLEARABLE_FIELDS] }), { parentTaskId: undefined, position: undefined });
ok("start dates: real calendar days, not after a calendar due date");

/* ------------------------------------------------------------ positions */

assert.equal(positionBetween(), TASK_POSITION_STEP, "empty column");
assert.equal(positionBetween(10, 20), 15, "midpoint");
assert.equal(positionBetween(10, undefined), 10 + TASK_POSITION_STEP, "bottom end");
assert.equal(positionBetween(undefined, 10), 10 - TASK_POSITION_STEP, "top end");
assert.equal(positionBetween(1, 1 + TASK_POSITION_MIN_GAP / 2), null, "too close");
assert.equal(positionBetween(5, 5), null, "equal neighbours");
assert.equal(positionBetween(5, 4), null, "out of order");
assert.deepEqual(rebalancePositions(["a", "b"]), [{ id: "a", position: TASK_POSITION_STEP }, { id: "b", position: 2 * TASK_POSITION_STEP }]);
assert.throws(() => assertTaskPosition(Number.NaN));
assert.throws(() => assertTaskPosition(Number.POSITIVE_INFINITY));
assert.throws(() => assertTaskPosition("1"));
assertTaskPosition(-12.5);

const ids = (items: TaskPositionItem[]) => items.map((item) => item.id);
const column: TaskPositionItem[] = [{ id: "u1" }, { id: "p2", position: 20 }, { id: "u2" }, { id: "p1", position: 10 }];
assert.deepEqual(ids(sortByPosition(column)), ["p1", "p2", "u1", "u2"], "positioned first, the rest keep their order");
const shown = sortByPosition(column);

// One drag, one write: between p1 and p2.
assert.deepEqual(planTaskMove([{ id: "a", position: 10 }, { id: "b", position: 20 }, { id: "c", position: 30 }], "c", 1), [{ id: "c", position: 15 }]);
// To the top and to the bottom of a positioned column.
assert.deepEqual(planTaskMove([{ id: "a", position: 10 }, { id: "b", position: 20 }], "b", 0), [{ id: "b", position: 10 - TASK_POSITION_STEP }]);
assert.deepEqual(planTaskMove([{ id: "a", position: 10 }, { id: "b", position: 20 }], "a", 1), [{ id: "a", position: 20 + TASK_POSITION_STEP }]);
// Dropped where it already is: nothing to write.
assert.deepEqual(planTaskMove([{ id: "a", position: 10 }, { id: "b", position: 20 }], "a", 0), []);
assert.deepEqual(planTaskMove([{ id: "a" }, { id: "b" }], "b", 1), []);
// From another column into the middle and onto an empty column.
assert.deepEqual(planTaskMove([{ id: "a", position: 10 }, { id: "b", position: 20 }], "x", 1), [{ id: "x", position: 15 }]);
assert.deepEqual(planTaskMove([], "x", 0), [{ id: "x", position: TASK_POSITION_STEP }]);
// Just below the positioned tasks: still one write, above every unpositioned task.
assert.deepEqual(planTaskMove(shown, "u2", 2), [{ id: "u2", position: 20 + TASK_POSITION_STEP }]);
// Below unpositioned tasks: those above the drop point get positions too, so the order holds.
const deep = planTaskMove([{ id: "a", position: 10 }, { id: "u1" }, { id: "u2" }, { id: "u3" }], "x", 3);
assert.deepEqual(deep, [{ id: "u1", position: 10 + TASK_POSITION_STEP }, { id: "u2", position: 10 + 2 * TASK_POSITION_STEP }, { id: "x", position: 10 + 3 * TASK_POSITION_STEP }]);
assert.deepEqual(ids(applyTaskPositionWrites([{ id: "a", position: 10 }, { id: "u1" }, { id: "u2" }, { id: "u3" }, { id: "x" }], deep)), ["a", "u1", "u2", "x", "u3"]);
// Every task unpositioned: moving the last one to the top writes only it.
assert.deepEqual(planTaskMove([{ id: "a" }, { id: "b" }, { id: "c" }], "c", 0), [{ id: "c", position: TASK_POSITION_STEP }]);
// Too close to split: the positioned part is spaced out again, writing only what changed.
const tight: TaskPositionItem[] = [{ id: "a", position: TASK_POSITION_STEP }, { id: "b", position: TASK_POSITION_STEP + 1e-7 }, { id: "c", position: 3 * TASK_POSITION_STEP }, { id: "u" }];
const rebalanced = planTaskMove(tight, "c", 1);
assert.deepEqual(rebalanced, [{ id: "c", position: 2 * TASK_POSITION_STEP }, { id: "b", position: 3 * TASK_POSITION_STEP }], "a keeps its position; u stays unpositioned");
assert.deepEqual(ids(applyTaskPositionWrites(tight, rebalanced)), ["a", "c", "b", "u"]);
// Repeated midpoints eventually rebalance rather than collide.
let order: TaskPositionItem[] = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];
let rebalances = 0;
for (let round = 0; round < 80; round++) {
  const moving = round % 2 === 0 ? "c" : "b";
  const writes = planTaskMove(order, moving, 1);
  if (writes.length > 1) rebalances++;
  order = applyTaskPositionWrites(order, writes);
  assert.equal(new Set(order.map((item) => item.position)).size, 3, "positions stay distinct");
  assert.equal(order[1].id, moving, `round ${round}: the moved card sits where it was dropped`);
}
assert.ok(rebalances > 0 && rebalances < 10, `rebalanced ${rebalances} times in 80 moves`);
ok("board positions: midpoints, ends, unpositioned tasks, no-ops and rebalance");

/* ------------------------------------------------------------ sub-task rules */

assert.equal(subtaskParentProblem({ id: "a", hasChildren: false, historical: false }, { _id: "a" }), SUBTASK_SELF_PARENT);
assert.equal(subtaskParentProblem({ id: "a", hasChildren: false, historical: false }, { _id: "p", parentTaskId: "q" }), SUBTASK_NESTED);
assert.equal(subtaskParentProblem({ id: "a", hasChildren: true, historical: false }, { _id: "p" }), SUBTASK_HAS_CHILDREN);
assert.equal(subtaskParentProblem({ hasChildren: false, historical: false }, { _id: "p", historical: true }), SUBTASK_HISTORICAL);
assert.equal(subtaskParentProblem({ hasChildren: false, historical: false }, { _id: "p" }), null);
assert.deepEqual(subtaskProgress([{ status: "Done" }, { status: "Todo" }, { status: "Cancelled" }, { status: "Done" }]), { done: 2, total: 3 });

type Row = { _id: string; title: string; status: string; parentTaskId?: string };
const rows: Row[] = [
  { _id: "p", title: "Parent", status: "Todo" },
  { _id: "s1", title: "First", status: "Done", parentTaskId: "p" },
  { _id: "x", title: "Other", status: "Todo" },
  { _id: "s2", title: "Second", status: "Todo", parentTaskId: "p" },
  { _id: "orphan", title: "Orphan", status: "Todo", parentTaskId: "gone" },
];
const info = withSubtaskInfo(rows);
assert.deepEqual(info.find((row) => row._id === "p")?.subtaskProgress, { done: 1, total: 2 });
assert.equal(info.find((row) => row._id === "s2")?.parentTaskTitle, "Parent");
assert.equal(info.find((row) => row._id === "orphan")?.parentTaskTitle, undefined, "a missing parent names nothing");
const nested = nestTasks(info);
assert.deepEqual(nested.map((entry) => [entry.task._id, entry.depth]), [["p", 0], ["s1", 1], ["s2", 1], ["x", 0], ["orphan", 0]]);
assert.equal(nested[0].nested, 2);
assert.deepEqual(nestTasks(info, new Set(["p"])).map((entry) => entry.task._id), ["p", "x", "orphan"], "a folded parent hides its sub-tasks");
// The parent in another group: the sub-task stands alone and names its parent.
const alone = nestTasks(info.filter((row) => row._id !== "p"));
assert.deepEqual(alone.map((entry) => [entry.task._id, entry.depth, entry.parentHint]), [["s1", 0, "Parent"], ["x", 0, undefined], ["s2", 0, "Parent"], ["orphan", 0, undefined]]);
ok("sub-task rules, rollups and the nested list order");

/* ------------------------------------------------------------ server, both runtimes */

const now = "2026-11-11T12:00:00.000Z";
type Db = { insert: (table: string, row: Record<string, unknown>) => Promise<string> };
async function seed(db: Db, issuer: string, subject: string) {
  const societyId = await db.insert("societies", { name: "Synthetic structure tests", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignSocietyId = await db.insert("societies", { name: "Synthetic other workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  await db.insert("users", { societyId, role: "Owner", status: "Active", displayName: "Owner", email: "owner@example.test", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: now });
  const foreignTask = await db.insert("tasks", { societyId: foreignSocietyId, title: "Elsewhere", status: "Todo", priority: "Medium", tags: [], createdAtISO: now });
  const historical = await db.insert("tasks", { societyId, title: "Old action", status: "Unknown", priority: "Medium", tags: ["historical-source-action"], createdAtISO: now });
  return { societyId, foreignTask, historical };
}

const issuer = betterAuthIssuer();
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./tasks.js": () => import("../convex/tasks"),
} as never);
const native = await t.run((ctx) => seed(ctx.db as unknown as Db, issuer, "owner"));
const owner = t.withIdentity({ subject: "owner", issuer });
const localDb = new LocalStoreDb(new MemoryRowStore());
const local = await localDb.transaction(() => seed(localDb as unknown as Db, "https://portable-fixture.test", PORTABLE_TEST_AUTH_SUBJECT));
const rt = new PortableRuntime({ db: localDb, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).registerAll(PORTABLE_FUNCTIONS);

type Runtime = {
  label: string;
  fixture: Awaited<ReturnType<typeof seed>>;
  create: (args: Record<string, unknown>) => Promise<string>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  read: (id: string) => Promise<Record<string, unknown> | null>;
};
const runtimes: Runtime[] = [
  {
    label: "Convex",
    fixture: native,
    create: (args) => owner.mutation(api.tasks.create, args as never) as Promise<string>,
    update: (args) => owner.mutation(api.tasks.update, args as never),
    remove: (id) => owner.mutation(api.tasks.remove, { id } as never),
    read: (id) => t.run((ctx) => ctx.db.get(id as never)) as Promise<Record<string, unknown> | null>,
  },
  {
    label: "local",
    fixture: local,
    create: (args) => rt.runMutation("tasks:create", args) as Promise<string>,
    update: (args) => rt.runMutation("tasks:update", args),
    remove: (id) => rt.runMutation("tasks:remove", { id }),
    read: (id) => localDb.get(id) as Promise<Record<string, unknown> | null>,
  },
];

for (const { label, fixture, create, update, remove, read } of runtimes) {
  const base = { societyId: fixture.societyId, status: "Todo", priority: "Medium", tags: [] as string[] };
  // Start dates.
  const dated = await create({ ...base, title: "Dated", startDate: "2026-11-01", dueDate: "2026-11-30" });
  assert.equal((await read(dated))?.startDate, "2026-11-01");
  await assert.rejects(() => create({ ...base, title: "Bad", startDate: "2026-02-30" }), /real date/);
  await assert.rejects(() => create({ ...base, title: "Backwards", startDate: "2026-12-01", dueDate: "2026-11-30" }), /after the due date/);
  await assert.rejects(() => update({ id: dated, patch: { dueDate: "2026-10-01" } }), /after the due date/, "moving the due date before the start");
  await assert.rejects(() => update({ id: dated, patch: { startDate: "2026-12-05" } }), /after the due date/);
  await update({ id: dated, patch: { clearFields: ["startDate"] } });
  assert.equal((await read(dated))?.startDate, undefined);
  await update({ id: dated, patch: { dueDate: "2026-10-01" } });
  ok(`${label}: start dates validated on create and update, and cleared`);

  // Sub-tasks.
  const parent = await create({ ...base, title: "Parent" });
  const child = await create({ ...base, title: "Child", parentTaskId: parent });
  const other = await create({ ...base, title: "Other" });
  assert.equal((await read(child))?.parentTaskId, parent);
  await assert.rejects(() => create({ ...base, title: "Grandchild", parentTaskId: child }), /sub-tasks of its own/);
  await assert.rejects(() => update({ id: parent, patch: { parentTaskId: other } }), /has sub-tasks/);
  await assert.rejects(() => update({ id: other, patch: { parentTaskId: other } }), /its own sub-task/);
  await assert.rejects(() => update({ id: other, patch: { parentTaskId: child } }), /sub-tasks of its own/, "no cycle through a sub-task");
  await assert.rejects(() => create({ ...base, title: "Foreign parent", parentTaskId: fixture.foreignTask }));
  await assert.rejects(() => update({ id: other, patch: { parentTaskId: fixture.foreignTask } }));
  await assert.rejects(() => create({ ...base, title: "Under history", parentTaskId: fixture.historical }), /Historical/);
  await assert.rejects(() => update({ id: fixture.historical, patch: { parentTaskId: parent } }), /Historical/);
  // Completing a parent leaves its sub-tasks alone.
  await update({ id: parent, patch: { status: "Done" } });
  assert.equal((await read(child))?.status, "Todo");
  // Make a sub-task a separate task, then back again.
  await update({ id: child, patch: { clearFields: ["parentTaskId"] } });
  assert.equal((await read(child))?.parentTaskId, undefined);
  await update({ id: child, patch: { parentTaskId: parent } });
  const second = await create({ ...base, title: "Second child", parentTaskId: parent });
  // Deleting a parent takes its sub-tasks; other tasks stay.
  await remove(parent);
  assert.equal(await read(parent), null);
  assert.equal(await read(child), null);
  assert.equal(await read(second), null);
  assert.ok(await read(other));
  // Deleting a sub-task leaves its parent.
  const keeper = await create({ ...base, title: "Keeper" });
  const leaf = await create({ ...base, title: "Leaf", parentTaskId: keeper });
  await remove(leaf);
  assert.ok(await read(keeper));
  ok(`${label}: sub-task depth, cycles, workspace isolation, history, cascade delete and separation`);

  // Board position.
  await update({ id: other, patch: { position: 1536.5, status: "InProgress" } });
  assert.equal((await read(other))?.position, 1536.5);
  await assert.rejects(() => update({ id: other, patch: { position: Number.MAX_VALUE } }), /finite number/);
  await update({ id: other, patch: { clearFields: ["position"] } });
  assert.equal((await read(other))?.position, undefined);
  ok(`${label}: board positions stored, bounded and cleared`);
}

console.log(`Task structure checks passed (${checks}).`);
