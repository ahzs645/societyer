/**
 * Sidebar counts are a live query: creating, completing or removing records
 * must update them without a reload (intake re-test X-03: the Meetings badge
 * stayed at 0 after meetings were created until the page was reloaded).
 */
import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";

const client = new StaticConvexClient({ databaseName: `societyer-nav-counts-${Date.now()}` });
const societyId = String(((await client.query("society:list", {})) as any[])[0]._id);
const watch = (client as any).watchQuery("dashboard:navCounts", { societyId });
const current = () => watch.localQueryResult() as any;
const settle = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (current() && predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${label}: navCounts did not update (last ${JSON.stringify(current())})`);
};
let notified = 0;
const unsubscribe = watch.onUpdate(() => { notified += 1; });
await settle(() => typeof current().meetingsThisYear === "number", "initial load");
const before = current();

const year = new Date().getFullYear();
await client.mutation("meetings:create", { societyId, type: "Board", title: "Synthetic count check", scheduledAt: `${year}-06-15T18:00:00.000Z`, electronic: false });
await settle(() => current().meetingsThisYear === before.meetingsThisYear + 1, "meeting created");
assert.ok(notified > 0, "subscribers are notified");

const tasksBefore = current().openTasks;
await client.mutation("tasks:create", { societyId, title: "Synthetic count task", status: "Todo", priority: "Medium" });
await settle(() => current().openTasks === tasksBefore + 1, "task created");

unsubscribe();
console.log(`PASS: sidebar counts follow new meetings (${before.meetingsThisYear} -> ${current().meetingsThisYear}) and tasks (${tasksBefore} -> ${current().openTasks}) without a reload`);
process.exit(0);
