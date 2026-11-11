// Task notifications: "assigned to you" on create and update (never to the
// person making the change, nothing on a re-save), "due soon" and "overdue"
// from the alert scan (open operational tasks only, once per due date,
// re-armed by a new due date), in-camera titles withheld from recipients who
// can't read them, workspace isolation, personal switches and the digests.
// Runs the real portable handlers on a MemoryDb.
//
//   npx tsx scripts/check-task-notifications.ts

import assert from "node:assert/strict";
import { MemoryDb, PortableRuntime, makeCapabilities, type PortableDoc, type PortableMutationCtx } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { buildDigestPlan, scanSocietyAlerts } from "../shared/functions/notifications";
import { organizationTodayForTasks, taskNotificationHref } from "../shared/functions/taskNotifications";
import { addIsoDays } from "../shared/taskRecurrence";
import { HISTORICAL_ACTION_TAG } from "../shared/taskStatus";
import { NOTIFICATION_KINDS } from "../shared/notificationCatalog";
import { SECRET, SOCIETY_ID, privacySeed } from "./minutes-privacy-fixture";

const DAY = 86_400_000;
const now = Date.now();
const seed = privacySeed();
const db = new MemoryDb({ seed: {
  societies: [...seed.societies, { _id: "other-society", name: "Other workspace" }],
  users: [...seed.users, { _id: "user_foreign", societyId: "other-society", role: "Owner", status: "Active", displayName: "Foreign owner", email: "foreign@example.invalid" }, { _id: "user_inactive", societyId: SOCIETY_ID, role: "Admin", status: "Inactive", displayName: "Former admin" }],
  meetings: seed.meetings,
  agendas: seed.agendas,
  agendaItems: seed.agendaItems,
  minutes: seed.minutes,
} });
const caps = makeCapabilities({});
const as = (userId: string, societyId = SOCIETY_ID) =>
  new PortableRuntime({
    db,
    capabilities: caps,
    principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `user:${userId}`, userId, societyId }),
  }).registerAll(PORTABLE_FUNCTIONS);
const owner = as("user_Owner");
const admin = as("user_Admin");
const member = as("user_Member");
const viewer = as("user_Viewer");
const foreign = as("user_foreign", "other-society");

/** A system context for the scheduled scan at a chosen time. */
const systemCtx: PortableMutationCtx = {
  db,
  capabilities: caps,
  principal: { kind: "anonymous", runtime: "test", assurance: "none" },
  runQuery: () => Promise.reject(new Error("not used")),
  runMutation: () => Promise.reject(new Error("not used")),
};
const scan = (atMs = now) => scanSocietyAlerts(systemCtx, SOCIETY_ID, atMs);

const notes = async (kind?: string) => ((await db.query("notifications").collect()) as PortableDoc[]).filter((row) => !kind || row.kind === kind);
const forUser = async (userId: string, kind?: string) => (await notes(kind)).filter((row) => row.userId === userId);
const today = organizationTodayForTasks(await db.get(SOCIETY_ID, "societies"), new Date(now).toISOString());
const create = (runtime: PortableRuntime, args: Record<string, unknown>) =>
  runtime.runMutation<string>("tasks:create", { societyId: SOCIETY_ID, status: "Todo", priority: "Medium", tags: [], ...args });

// --- Catalogue -----------------------------------------------------------------------------
for (const id of ["task_assigned", "task_due_soon", "task_overdue"]) {
  const kind = NOTIFICATION_KINDS.find((entry) => entry.id === id);
  assert.ok(kind && kind.group === "tasks" && kind.permission === "tasks:read", `${id} is a tasks kind for anyone who reads tasks`);
}
const memberSettings = await member.runQuery<{ kinds: string[] }>("notifications:settings", { societyId: SOCIETY_ID });
assert.ok(["task_assigned", "task_due_soon", "task_overdue"].every((kind) => memberSettings.kinds.includes(kind)), "the kinds appear in a member's settings");
console.log("✓ catalogue: three task kinds, offered to anyone who can read tasks");

// --- Assigned ------------------------------------------------------------------------------
const taskId = await create(owner, { title: "Renew the hall insurance", dueDate: addIsoDays(today, 30), responsibleUserIds: ["user_Owner", "user_Admin", "user_Member"] });
assert.equal((await forUser("user_Owner", "task_assigned")).length, 0, "the person who assigned it is never told");
const [adminAssigned] = await forUser("user_Admin", "task_assigned");
assert.equal(adminAssigned.title, "Assigned to you: Renew the hall insurance");
assert.equal(adminAssigned.linkHref, taskNotificationHref(taskId));
assert.equal(adminAssigned.linkHref, `/app/tasks?record=${taskId}`);
assert.match(String(adminAssigned.body), /Owner person made you responsible/);
assert.equal((await forUser("user_Member", "task_assigned")).length, 1);
assert.equal((await notes("task_assigned")).length, 2);

await owner.runMutation("tasks:update", { id: taskId, patch: { responsibleUserIds: ["user_Owner", "user_Admin", "user_Member"], title: "Renew the hall insurance" } });
assert.equal((await notes("task_assigned")).length, 2, "re-saving the same owners sends nothing");
await owner.runMutation("tasks:update", { id: taskId, patch: { responsibleUserIds: ["user_Admin"] } });
await owner.runMutation("tasks:update", { id: taskId, patch: { responsibleUserIds: ["user_Admin", "user_Viewer", "user_inactive"] } });
assert.equal((await notes("task_assigned")).length, 3, "only the newly added, active person is told");
assert.equal((await forUser("user_Viewer", "task_assigned")).length, 1);
// The Member re-added by the Admin is told; the Admin, who made the change, isn't.
await admin.runMutation("tasks:update", { id: taskId, patch: { responsibleUserIds: ["user_Admin", "user_Viewer", "user_Member"] } });
assert.equal((await forUser("user_Member", "task_assigned")).length, 2);
assert.equal((await forUser("user_Admin", "task_assigned")).length, 1);

await create(owner, { title: "Old minutes action", tags: [HISTORICAL_ACTION_TAG], status: "Unknown", responsibleUserIds: ["user_Admin"] });
await create(owner, { title: "Already finished", status: "Done", responsibleUserIds: ["user_Admin"] });
assert.equal((await forUser("user_Admin", "task_assigned")).length, 1, "historical actions and closed tasks never notify");
await assert.rejects(create(owner, { title: "Cross-workspace owner", responsibleUserIds: ["user_foreign"] }), /not found|belong|workspace/i, "a user from another workspace can't be made responsible");
console.log("✓ assigned: new owners only, never the actor, nothing on a re-save, no history or closed tasks, workspace-bound");

// --- In camera -----------------------------------------------------------------------------
const secretId = await create(owner, { title: `${SECRET} chair to notify the ED`, meetingId: "meeting_board", minutesSectionIndex: 1, dueDate: addIsoDays(today, 1), responsibleUserIds: ["user_Admin", "user_Member"] });
const memberSecret = (await forUser("user_Member", "task_assigned")).find((row) => row.linkHref === taskNotificationHref(secretId));
const adminSecret = (await forUser("user_Admin", "task_assigned")).find((row) => row.linkHref === taskNotificationHref(secretId));
assert.equal(memberSecret?.title, "Assigned to you: In-camera action", "a member without in-camera access gets the withheld title");
assert.equal(adminSecret?.title, `Assigned to you: ${SECRET} chair to notify the ED`, "an admin with in-camera access sees the task");
console.log("✓ in camera: recipients without access get “In-camera action”");

// --- Inbox isolation -----------------------------------------------------------------------
const memberInbox = await member.runQuery<PortableDoc[]>("notifications:list", { societyId: SOCIETY_ID, limit: 200 });
assert.ok(memberInbox.every((row) => !row.userId || row.userId === "user_Member"), "a person's inbox holds only their own task notices");
assert.ok(memberInbox.some((row) => row.kind === "task_assigned"));
const viewerInbox = await viewer.runQuery<PortableDoc[]>("notifications:list", { societyId: SOCIETY_ID, limit: 200 });
assert.ok(!viewerInbox.some((row) => String(row.title).includes(SECRET)), "nobody else sees the in-camera title");
// (A hosted sign-in from another workspace is refused outright: check-notification-recipient-isolation.)
assert.ok((await notes()).every((row) => row.societyId === SOCIETY_ID), "every task notice so far belongs to this workspace");
await member.runMutation("notifications:setMyPref", { societyId: SOCIETY_ID, channel: "inApp", kind: "task_assigned", enabled: false });
assert.ok(!(await member.runQuery<PortableDoc[]>("notifications:list", { societyId: SOCIETY_ID, limit: 200 })).some((row) => row.kind === "task_assigned"), "the personal in-app switch hides them");
await member.runMutation("notifications:setMyPref", { societyId: SOCIETY_ID, channel: "inApp", kind: "task_assigned", enabled: true });
console.log("✓ inbox: targeted to one person, kept in its workspace, personal switch respected");

// --- Due soon and overdue ------------------------------------------------------------------
await owner.runMutation("notifications:setRule", { societyId: SOCIETY_ID, rule: "deadline_lead", enabled: true, value: 7 });
const soonId = await create(owner, { title: "Send the grant report", dueDate: addIsoDays(today, 3), responsibleUserIds: ["user_Owner", "user_Admin"] });
const lateId = await create(owner, { title: "File the annual return", dueDate: addIsoDays(today, -1), responsibleUserIds: ["user_Admin"] });
const farId = await create(owner, { title: "Plan the AGM", dueDate: addIsoDays(today, 20), responsibleUserIds: ["user_Admin"] });
const orphanId = await create(owner, { title: "Nobody owns this", dueDate: addIsoDays(today, -2) });
await create(owner, { title: "Done already", status: "Done", dueDate: addIsoDays(today, -1), responsibleUserIds: ["user_Admin"] });
const cancelledId = await create(owner, { title: "Called off", dueDate: addIsoDays(today, -1), responsibleUserIds: ["user_Admin"] });
await owner.runMutation("tasks:update", { id: cancelledId, patch: { status: "Cancelled" } });
await db.insert("tasks", { societyId: SOCIETY_ID, title: "Historical action", status: "Todo", priority: "Low", tags: [HISTORICAL_ACTION_TAG], dueDate: addIsoDays(today, -3), responsibleUserIds: ["user_Admin"], createdAtISO: new Date(now).toISOString() });
await db.insert("tasks", { societyId: SOCIETY_ID, title: "Stray owner", status: "Todo", priority: "Low", tags: [], dueDate: addIsoDays(today, 2), responsibleUserIds: ["user_foreign"], createdAtISO: new Date(now).toISOString() });
const otherTask = await foreign.runMutation<string>("tasks:create", { societyId: "other-society", title: "Their deadline", status: "Todo", priority: "Low", tags: [], dueDate: addIsoDays(today, 1), responsibleUserIds: ["user_foreign"] });

await scan();
const dueSoon = await notes("task_due_soon");
const overdue = await notes("task_overdue");
const linkOf = (id: string) => taskNotificationHref(id);
assert.deepEqual(dueSoon.filter((row) => row.linkHref === linkOf(soonId)).map((row) => row.userId).sort(), ["user_Admin", "user_Owner"], "every responsible user is told, including the creator");
assert.equal(overdue.filter((row) => row.linkHref === linkOf(lateId)).length, 1);
assert.equal(dueSoon.filter((row) => row.linkHref === linkOf(lateId)).length, 0, "already overdue: only the overdue alert");
assert.equal((await notes()).filter((row) => row.linkHref === linkOf(farId) && row.kind !== "task_assigned").length, 0, "outside the 7-day lead time");
assert.equal((await notes()).filter((row) => row.linkHref === linkOf(orphanId)).length, 0, "no responsible user, nobody notified");
assert.ok(![...dueSoon, ...overdue].some((row) => ["Done already", "Called off", "Historical action"].some((title) => String(row.title).includes(title))), "done, cancelled and historical tasks never alert");
assert.ok(![...dueSoon, ...overdue].some((row) => row.userId === "user_foreign" || row.societyId !== SOCIETY_ID), "the scan stays in its workspace and ignores foreign users");
assert.equal((await notes()).filter((row) => row.linkHref === linkOf(otherTask) && row.kind !== "task_assigned").length, 0, "another workspace's task is not scanned");
const secretDue = dueSoon.filter((row) => row.linkHref === linkOf(secretId));
assert.equal(secretDue.find((row) => row.userId === "user_Member")?.title, "Task due soon: In-camera action");
assert.equal(secretDue.find((row) => row.userId === "user_Admin")?.title, `Task due soon: ${SECRET} chair to notify the ED`);
assert.ok(overdue.every((row) => row.severity === "err") && dueSoon.every((row) => row.severity === "warn"));
console.log("✓ scan: responsible users of open tasks within the lead time; overdue once; no closed, historical, ownerless or foreign tasks; in-camera titles withheld");

const before = (await notes()).length;
await scan();
await scan(now + 60_000);
assert.equal((await notes()).length, before, "a second scan raises nothing new");

// Moving the due date re-arms; time passing turns due soon into overdue, once.
await owner.runMutation("tasks:update", { id: soonId, patch: { dueDate: addIsoDays(today, 5) } });
await scan();
assert.equal((await notes("task_due_soon")).filter((row) => row.linkHref === linkOf(soonId)).length, 4, "a new due date re-arms the due-soon alert");
await scan(now + 8 * DAY);
await scan(now + 9 * DAY);
assert.equal((await notes("task_overdue")).filter((row) => row.linkHref === linkOf(soonId)).length, 2, "overdue once per person when the date passes");
assert.equal((await notes("task_overdue")).filter((row) => row.linkHref === linkOf(lateId)).length, 1, "an overdue task is not raised again on later days");
await owner.runMutation("tasks:update", { id: lateId, patch: { dueDate: addIsoDays(today, -4) } });
await owner.runMutation("tasks:update", { id: lateId, patch: { status: "Done" } });
await scan(now + 10 * DAY);
assert.equal((await notes("task_overdue")).filter((row) => row.linkHref === linkOf(lateId)).length, 1, "completing the task stops further alerts");
// Lead time switched off: only overdue alerts.
await owner.runMutation("notifications:setRule", { societyId: SOCIETY_ID, rule: "deadline_lead", enabled: false, value: 7 });
const tomorrowId = await create(owner, { title: "Print the agenda", dueDate: addIsoDays(today, 1), responsibleUserIds: ["user_Admin"] });
await scan();
assert.equal((await notes()).filter((row) => row.linkHref === linkOf(tomorrowId) && row.kind !== "task_assigned").length, 0, "with no lead time, nothing is due soon until the day itself");
console.log("✓ once-only: re-scans are quiet, a new due date re-arms, overdue fires once, completion stops alerts");

// --- Digests -------------------------------------------------------------------------------
const daily = await buildDigestPlan(systemCtx, SOCIETY_ID, "daily", now);
const memberDaily = daily.find((row) => row.userId === "user_Member");
assert.ok(memberDaily?.emailLines.some((line) => line.includes("Assigned to you: In-camera action")), "the daily digest carries task notices");
assert.ok(!daily.flatMap((row) => row.userId === "user_Member" || row.userId === "user_Viewer" ? row.emailLines : []).some((line) => line.includes(SECRET)), "the digest withholds in-camera titles too");
await admin.runMutation("notifications:setMyPref", { societyId: SOCIETY_ID, channel: "email", kind: "task_due_soon", enabled: false });
const adminDaily = (await buildDigestPlan(systemCtx, SOCIETY_ID, "daily", now)).find((row) => row.userId === "user_Admin");
assert.ok(adminDaily && !adminDaily.emailLines.some((line) => line.includes("Task due soon")), "the email switch keeps a kind out of the digest");
assert.ok(adminDaily.emailLines.some((line) => line.includes("Task overdue")));

await owner.runMutation("notifications:setRule", { societyId: SOCIETY_ID, rule: "deadline_lead", enabled: true, value: 7 });
await admin.runMutation("notifications:setMyPref", { societyId: SOCIETY_ID, channel: "email", kind: "digest:weekly", enabled: true });
const weekly = await buildDigestPlan(systemCtx, SOCIETY_ID, "weekly", now);
const adminWeekly = weekly.find((row) => row.userId === "user_Admin");
const taskLine = adminWeekly?.emailLines.find((line) => line.includes("of your tasks"));
assert.ok(taskLine, "the weekly summary has a line about the person's own tasks");
assert.equal(taskLine, "3 of your tasks are due in the next 7 days.", "the in-camera action, the agenda and the grant report; the insurance is 30 days out and the return is done");
console.log("✓ digests: daily carries task notices under the email switches; weekly counts your own tasks");

console.log("\nTask notification checks passed.");
