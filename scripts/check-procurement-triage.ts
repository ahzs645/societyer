/**
 * The workspace's bid triage (convex/procurementTriage.ts): who may read and
 * save it, what it accepts, workspace isolation, clearing, and the action
 * item (a task holding the opportunity as an attachment, only on request; a
 * second one only when asked for). No catalog is loaded: the triage must work
 * whichever catalog the workspace reads.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

for (const key of ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SITE_ID", "DRIVE_ID", "TRANSFER_HOSTS"]) process.env[`PROCUREMENT_SHAREPOINT_${key}`] = "synthetic";
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./procurementTriage.js": () => import("../convex/procurementTriage"),
} as Record<string, () => Promise<unknown>>);
const api = anyApi;
const issuer = betterAuthIssuer();
const ids = await t.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Triage test", isCharity: false, isMemberFunded: false, updatedAt: 0, disabledModules: ["+procurementReview"] });
  const foreign = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0, disabledModules: ["+procurementReview"] });
  const off = await ctx.db.insert("societies", { name: "Module off", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const people = [["viewer", societyId, "Viewer"], ["director", societyId, "Director"], ["admin", societyId, "Admin"], ["foreign", foreign, "Admin"], ["off", off, "Admin"]] as const;
  for (const [subject, sid, role] of people)
    await ctx.db.insert("users", { societyId: sid, email: `${subject}@example.invalid`, displayName: subject[0].toUpperCase() + subject.slice(1), role, status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-11-11" });
  return { societyId, foreign, off };
});
const as = (subject: string) => t.withIdentity({ subject, issuer });
const viewer = as("viewer"), director = as("director"), admin = as("admin");
const triage = (recordKey: string, reviewed: boolean, classification: string, societyId = ids.societyId) => ({ societyId, recordKey, reviewed, classification });
const listed = async (who = viewer, societyId = ids.societyId) =>
  ((await who.query(api.procurementTriage.list, { societyId })) as { recordKey: string; reviewed: boolean; classification: string; updatedBy: string | null }[])
    .map(({ recordKey, reviewed, classification, updatedBy }) => ({ recordKey, reviewed, classification, updatedBy }))
    .sort((a, b) => a.recordKey.localeCompare(b.recordKey));

// Saving: documents:write (Director and up), a known classification, opportunities only, in one's own workspace.
await assert.rejects(viewer.mutation(api.procurementTriage.set, triage("opportunity:1", true, "doable")), /Permission/, "A viewer cannot triage");
await assert.rejects(director.mutation(api.procurementTriage.set, triage("opportunity:1", true, "great")), /Invalid/);
await assert.rejects(director.mutation(api.procurementTriage.set, triage("award:1", true, "doable")), /Invalid/, "Awards aren't triaged");
await assert.rejects(as("foreign").mutation(api.procurementTriage.set, triage("opportunity:1", true, "doable")), /membership|access|workspace|bound|Permission/i);
await assert.rejects(as("off").mutation(api.procurementTriage.set, triage("opportunity:1", true, "doable", ids.off)), /disabled/, "The module must be on");
await assert.rejects(as("off").query(api.procurementTriage.list, { societyId: ids.off }), /disabled/);

for (const [key, reviewed, classification] of [["opportunity:1", false, "doable"], ["opportunity:2", true, "possible"], ["opportunity:3", true, "not_doable"], ["opportunity:4", true, ""]] as const)
  await director.mutation(api.procurementTriage.set, triage(key, reviewed, classification));
await as("foreign").mutation(api.procurementTriage.set, triage("opportunity:1", true, "not_doable", ids.foreign));
assert.deepEqual(await listed(), [
  { recordKey: "opportunity:1", reviewed: false, classification: "doable", updatedBy: "Director" },
  { recordKey: "opportunity:2", reviewed: true, classification: "possible", updatedBy: "Director" },
  { recordKey: "opportunity:3", reviewed: true, classification: "not_doable", updatedBy: "Director" },
  { recordKey: "opportunity:4", reviewed: true, classification: "", updatedBy: "Director" },
], "A viewer reads the whole workspace's triage, and none of another workspace's");
await director.mutation(api.procurementTriage.set, triage("opportunity:4", false, ""));
assert.equal((await listed()).some((row) => row.recordKey === "opportunity:4"), false, "Clearing both removes the row");

// "Create action item": tasks:write (Admin and up), only once reviewed and classified as something to bid on.
const notice = { title: "Bridge 2", buyer: "Test City", closes: "2026-12-04", closesText: "Dec 4, 2026 2:00 PM (PST)", reference: "REF-2" };
const taskOf = (recordKey: string, facts = notice, another?: boolean) => ({ societyId: ids.societyId, recordKey, notice: facts, ...(another ? { another } : {}) });
const holders = async (recordKey: string) =>
  (await t.run((ctx) => ctx.db.query("taskAttachments").withIndex("by_society", (q) => q.eq("societyId", ids.societyId).eq("kind", "opportunity").eq("refKey", recordKey)).collect()))
    .map((row) => String(row.taskId)).sort();
await assert.rejects(director.mutation(api.procurementTriage.createTask, taskOf("opportunity:2")), /Permission tasks:write/, "Triage needs documents:write; a task needs tasks:write too");
await assert.rejects(admin.mutation(api.procurementTriage.createTask, taskOf("opportunity:1")), /Review and classify/, "Classified but not reviewed");
await assert.rejects(admin.mutation(api.procurementTriage.createTask, taskOf("opportunity:3")), /Review and classify/, "Not doable");
await assert.rejects(admin.mutation(api.procurementTriage.createTask, taskOf("opportunity:9")), /Review and classify/, "Never triaged");
await assert.rejects(admin.mutation(api.procurementTriage.createTask, taskOf("opportunity:2", { ...notice, closes: "soon" })), /closing date/);
assert.equal((await t.run((ctx) => ctx.db.query("tasks").collect())).length, 0, "Classifying alone never makes a task");
const made = await admin.mutation(api.procurementTriage.createTask, taskOf("opportunity:2"));
assert.equal(made.created, true);
const tasks = await t.run((ctx) => ctx.db.query("tasks").collect());
assert.deepEqual(tasks.map((row) => [String(row._id), row.title, row.status, row.dueDate, row.tags]), [[made.taskId, "Prepare bid: Bridge 2", "Todo", "2026-12-04", ["procurement"]]]);
assert.match(tasks[0].description ?? "", /Buyer: Test City[\s\S]*Closes: Dec 4, 2026 2:00 PM \(PST\)[\s\S]*Classification: Possible[\s\S]*Reference: REF-2/);
const [attachment] = await t.run((ctx) => ctx.db.query("taskAttachments").collect());
assert.deepEqual(
  { taskId: String(attachment.taskId), kind: attachment.kind, refKey: attachment.refKey, title: attachment.title, subtitle: attachment.subtitle, dueDate: attachment.dueDate, dueText: attachment.dueText, attachedByName: attachment.attachedByName },
  { taskId: made.taskId, kind: "opportunity", refKey: "opportunity:2", title: "Bridge 2", subtitle: "Test City", dueDate: "2026-12-04", dueText: "Dec 4, 2026 2:00 PM (PST)", attachedByName: "Admin" },
  "The action item holds the opportunity, with the notice's facts",
);
assert.deepEqual(await admin.mutation(api.procurementTriage.createTask, taskOf("opportunity:2")), { taskId: made.taskId, created: false }, "Asking again returns the same task");
const second = await admin.mutation(api.procurementTriage.createTask, taskOf("opportunity:2", notice, true));
assert.equal(second.created, true, "A second action item only when asked for");
assert.deepEqual(await holders("opportunity:2"), [made.taskId, second.taskId].sort(), "One opportunity, two action items");
assert.equal((await listed()).some((row) => "taskId" in row), false, "The triage no longer carries a task");
await director.mutation(api.procurementTriage.set, triage("opportunity:2", false, ""));
assert.equal((await listed()).some((row) => row.recordKey === "opportunity:2"), false, "Clearing the triage removes its row");
assert.equal((await holders("opportunity:2")).length, 2, "and keeps its action items");
await director.mutation(api.procurementTriage.set, triage("opportunity:2", true, "doable"));
await t.run(async (ctx) => { for (const task of await ctx.db.query("tasks").collect()) await ctx.db.delete(task._id); });
const again = await admin.mutation(api.procurementTriage.createTask, taskOf("opportunity:2"));
assert.equal(again.created, true, "A deleted task no longer counts: the action item can be made again");

console.log("procurement triage: ok");
