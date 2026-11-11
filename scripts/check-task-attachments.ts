/**
 * Things attached to a task (convex/taskAttachments.ts,
 * shared/functions/taskAttachments.ts): who may read and change them, workspace
 * isolation, documents the reader may not open, attaching twice, both kinds,
 * the procurement module rule, the activity log, and what deleting a task or
 * a document takes with it.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

// The deployment's procurement connection (opportunities need it); synthetic values only.
for (const key of ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SITE_ID", "DRIVE_ID", "TRANSFER_HOSTS"]) process.env[`PROCUREMENT_SHAREPOINT_${key}`] = "synthetic";
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./taskAttachments.js": () => import("../convex/taskAttachments"),
  "./tasks.js": () => import("../convex/tasks"),
  "./documents.js": () => import("../convex/documents"),
} as Record<string, () => Promise<unknown>>);
const api = anyApi;
const issuer = betterAuthIssuer();
const at = "2026-11-11T00:00:00.000Z";
const ids = await t.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Attachments test", isCharity: false, isMemberFunded: false, updatedAt: 0, disabledModules: ["+procurementReview"] });
  const foreign = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0, disabledModules: ["+procurementReview"] });
  const off = await ctx.db.insert("societies", { name: "Module off", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const people = [["viewer", societyId, "Viewer"], ["director", societyId, "Director"], ["admin", societyId, "Admin"], ["foreign", foreign, "Admin"], ["off", off, "Admin"]] as const;
  for (const [subject, sid, role] of people)
    await ctx.db.insert("users", { societyId: sid, email: `${subject}@example.invalid`, displayName: subject[0].toUpperCase() + subject.slice(1), role, status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: at });
  const task = (sid: typeof societyId, title: string) => ctx.db.insert("tasks", { societyId: sid, title, status: "Todo", priority: "Medium", tags: [], createdAtISO: at });
  const doc = (sid: typeof societyId, title: string, extra: { tags?: string[]; category?: string } = {}) =>
    ctx.db.insert("documents", { societyId: sid, title, category: extra.category ?? "Other", flaggedForDeletion: false, tags: extra.tags ?? [], createdAtISO: at });
  return {
    societyId, foreign, off,
    task: await task(societyId, "Prepare bid"),
    other: await task(societyId, "Second task"),
    foreignTask: await task(foreign, "Foreign task"),
    offTask: await task(off, "Module off task"),
    publicDoc: await doc(societyId, "Public notes", { tags: ["public"] }),
    boardDoc: await doc(societyId, "Board only"),
    foreignDoc: await doc(foreign, "Foreign document", { tags: ["public"] }),
  };
});
const as = (subject: string) => t.withIdentity({ subject, issuer });
const viewer = as("viewer"), director = as("director"), admin = as("admin");
const opportunity = (refKey: string, title = "Bridge 2") => ({ kind: "opportunity", refKey, snapshot: { title, subtitle: "Test City", dueDate: "2026-12-04", dueText: "Dec 4, 2026 2:00 PM (PST)" } });
type Listed = { _id: string; taskId: string; kind: string; refKey: string; title: string; subtitle?: string; dueDate?: string; task?: { title: string; status: string } };
const titles = async (who: ReturnType<typeof as>, taskId = ids.task) =>
  ((await who.query(api.taskAttachments.listForTask, { taskId })) as Listed[]).map((row) => `${row.kind}:${row.title}`);

// Changing needs tasks:write (Admin and up here); reading needs tasks:read.
await assert.rejects(viewer.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "document", refKey: String(ids.publicDoc) }), /Permission/, "A viewer cannot attach");
await assert.rejects(director.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "document", refKey: String(ids.publicDoc) }), /Permission tasks:write/);
await assert.rejects(admin.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "folder", refKey: "x" }), /Invalid attachment/, "Unknown kinds are refused");

// Documents: any number, only the workspace's own, attaching twice changes nothing.
const first = await admin.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "document", refKey: String(ids.publicDoc) });
assert.equal(first.created, true);
assert.deepEqual(await admin.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "document", refKey: String(ids.publicDoc) }), { attachmentId: first.attachmentId, created: false }, "Attaching the same document again is a no-op");
await admin.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "document", refKey: String(ids.boardDoc) });
await assert.rejects(admin.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "document", refKey: String(ids.foreignDoc) }), /not found/i, "Another workspace's document");
await assert.rejects(admin.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "document", refKey: "not-a-document" }), /not found/i);
await assert.rejects(as("foreign").mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "document", refKey: String(ids.foreignDoc) }), /not found|membership|access|bound|Permission/i, "Another workspace's task");
await assert.rejects(as("foreign").query(api.taskAttachments.listForTask, { taskId: ids.task }), /not found|membership|access|bound|Permission/i);
assert.equal((await t.run((ctx) => ctx.db.query("taskAttachments").collect())).length, 2);

// A document the reader may not open is left out, even of the task's list.
assert.deepEqual(await titles(admin), ["document:Public notes", "document:Board only"]);
assert.deepEqual(await titles(director), ["document:Public notes", "document:Board only"]);
assert.deepEqual(await titles(viewer), ["document:Public notes"], "A viewer can't open a board document, so its title isn't shown");
await t.run((ctx) => ctx.db.patch(ids.publicDoc, { title: "Public notes (rev 2)" }));
assert.deepEqual(await titles(viewer), ["document:Public notes (rev 2)"], "A document reads with its current title");

// Opportunities: the module must be on, a valid record key and a title.
await assert.rejects(admin.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "opportunity", refKey: "award:1", snapshot: { title: "Award" } }), /Invalid attachment/);
await assert.rejects(admin.mutation(api.taskAttachments.attach, { taskId: ids.task, kind: "opportunity", refKey: "opportunity:2" }), /needs its title/);
await assert.rejects(admin.mutation(api.taskAttachments.attach, { taskId: ids.task, ...opportunity("opportunity:2"), snapshot: { title: "x", dueDate: "soon" } }), /closing date/);
await assert.rejects(as("off").mutation(api.taskAttachments.attach, { taskId: ids.offTask, ...opportunity("opportunity:2") }), /disabled/, "The procurement module must be on");
await assert.rejects(as("off").query(api.taskAttachments.listByKind, { societyId: ids.off, kind: "opportunity" }), /disabled/);
const op = await admin.mutation(api.taskAttachments.attach, { taskId: ids.task, ...opportunity("opportunity:2") });
assert.equal((await admin.mutation(api.taskAttachments.attach, { taskId: ids.task, ...opportunity("opportunity:2", "Renamed") })).created, false, "Once per task");
await admin.mutation(api.taskAttachments.attach, { taskId: ids.other, ...opportunity("opportunity:2") });
await admin.mutation(api.taskAttachments.attach, { taskId: ids.task, ...opportunity("opportunity:3", "Road 3") });
await as("foreign").mutation(api.taskAttachments.attach, { taskId: ids.foreignTask, ...opportunity("opportunity:2", "Foreign bridge") });
const [opRow] = ((await viewer.query(api.taskAttachments.listForTask, { taskId: ids.task })) as Listed[]).filter((row) => row.refKey === "opportunity:2");
assert.deepEqual({ title: opRow.title, subtitle: opRow.subtitle, dueDate: opRow.dueDate }, { title: "Bridge 2", subtitle: "Test City", dueDate: "2026-12-04" }, "The snapshot as first attached");

// A workspace's opportunities, each with its task: several tasks per opportunity, several opportunities per task, none of another workspace's.
const byKind = ((await viewer.query(api.taskAttachments.listByKind, { societyId: ids.societyId, kind: "opportunity" })) as Listed[])
  .map((row) => `${row.refKey} → ${row.task?.title}`).sort();
assert.deepEqual(byKind, ["opportunity:2 → Prepare bid", "opportunity:2 → Second task", "opportunity:3 → Prepare bid"]);
assert.deepEqual(((await viewer.query(api.taskAttachments.listByKind, { societyId: ids.societyId, kind: "document" })) as Listed[]).map((row) => row.title), ["Public notes (rev 2)"], "The document list applies the same access");
await assert.rejects(viewer.query(api.taskAttachments.listByKind, { societyId: ids.foreign, kind: "opportunity" }), /membership|access|bound|Permission|not found/i);

// Detach: tasks:write, own workspace only.
await assert.rejects(viewer.mutation(api.taskAttachments.detach, { id: op.attachmentId }), /Permission/);
const foreignRow = (await t.run((ctx) => ctx.db.query("taskAttachments").collect())).find((row) => row.societyId === ids.foreign);
await assert.rejects(admin.mutation(api.taskAttachments.detach, { id: foreignRow!._id }), /not found|membership|access|bound|Permission/i);
await admin.mutation(api.taskAttachments.detach, { id: op.attachmentId });
assert.deepEqual(await titles(admin), ["document:Public notes (rev 2)", "document:Board only", "opportunity:Road 3"]);

// Every change is in the task's activity.
const activity = await t.run((ctx) => ctx.db.query("activity").collect());
const forTask = activity.filter((row) => row.subjectId === ids.task).map((row) => row.action);
assert.deepEqual(forTask.filter((action) => action === "attached").length, 4);
assert.deepEqual(forTask.filter((action) => action === "detached").length, 1);
assert.ok(activity.some((row) => row.summary === `Attached opportunity "Road 3" to task "Prepare bid"`));
assert.ok(!activity.some((row) => row.summary?.includes("Board only")), "Activity never names a document, which some readers may not open");

// Deleting a document takes it off its tasks; deleting a task takes its attachments.
await admin.mutation(api.documents.remove, { id: ids.boardDoc });
assert.deepEqual(await titles(admin), ["document:Public notes (rev 2)", "opportunity:Road 3"]);
await admin.mutation(api.tasks.remove, { id: ids.task });
const left = await t.run((ctx) => ctx.db.query("taskAttachments").collect());
assert.deepEqual(left.map((row) => `${String(row.taskId) === String(ids.other) ? "other" : "foreign"}:${row.refKey}`).sort(), ["foreign:opportunity:2", "other:opportunity:2"], "Only the deleted task's attachments go");

console.log("task attachments: ok");
